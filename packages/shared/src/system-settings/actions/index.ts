"use server";

/**
 * 系统设置 Server Actions。
 *
 * 职责：验证真实管理员会话，把传输输入转换为 UOL 调用，并映射安全的用户反馈。
 * 审核策略写入、事务与审计全部由 moderation operation 和 policy service 持有。
 */

import { z } from "zod";

import type { AppUserRole } from "../../auth/roles";
import {
  destroyGenerationPhotosByMaxCount,
  shouldRunMaxCountCleanupOnSettingsChange,
} from "../../generation-maintenance";
import { logError } from "../../logger";
import {
  type ModerationBlockRiskLevel,
  moderationBlockRiskLevelSchema,
} from "../../moderation/policy-contract";
import { ActionUserError, superAdminAction } from "../../safe-action";
import { invokeOperation, OperationError, type Principal } from "../../uol";
import "../../uol/operations/moderation";
import {
  getAdminSystemSettingsSnapshot,
  importSystemSettingsFromEnv,
  initializeMissingSystemSettingsDefaults,
  setSystemSettings,
} from "../index";

interface ResolvedModerationPolicyActionResult {
  globalDefault: ModerationBlockRiskLevel;
  userOverride: ModerationBlockRiskLevel | null;
  effectiveLevel: ModerationBlockRiskLevel;
  source: "user_override" | "global" | "fallback_high";
}

interface GlobalModerationPolicyWriteActionResult {
  changed: boolean;
  before: unknown;
  after: ModerationBlockRiskLevel;
  auditLogId: string | null;
  updatedAt: Date;
}

const globalModerationPolicyInputSchema = z
  .object({
    level: moderationBlockRiskLevelSchema,
    reason: z
      .string()
      .trim()
      .min(1, "请填写变更原因")
      .max(300, "变更原因最多 300 个字符"),
  })
  .strict();

/** 从已复查数据库角色的 Action 上下文构造可信人工会话 Principal。 */
function createSystemSettingsPrincipal(input: {
  userId: string;
  role: AppUserRole;
}): Principal {
  return { type: "user", userId: input.userId, role: input.role };
}

/** 把 UOL 错误映射为安全中文反馈，不透传 internal_error 内部消息。 */
function throwModerationPolicyActionError(error: unknown): never {
  if (!(error instanceof OperationError)) throw error;
  switch (error.code) {
    case "forbidden":
    case "unauthenticated":
      throw new ActionUserError("无权查看或修改全站审核策略");
    case "validation_error":
      throw new ActionUserError("审核级别或变更原因不合法");
    case "not_found":
      throw new ActionUserError("全站审核策略不存在");
    case "timeout":
    case "not_ready":
      throw new ActionUserError("审核策略服务暂时不可用，请稍后重试");
    default:
      throw new ActionUserError("审核策略操作失败，请稍后重试");
  }
}

const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  clear: z.boolean().optional(),
});

export const getSystemSettingsAction = superAdminAction
  .metadata({ action: "system-settings.get" })
  .action(async () => {
    const settings = await getAdminSystemSettingsSnapshot();
    return { settings };
  });

/** 读取全站审核级别，只负责把真实 super_admin 会话传入 UOL。 */
export const getGlobalModerationPolicyAction = superAdminAction
  .metadata({ action: "system-settings.moderation.getGlobalPolicy" })
  .action(async ({ ctx }) => {
    try {
      const policy =
        await invokeOperation<ResolvedModerationPolicyActionResult>(
          "moderation.getGlobalRiskPolicy",
          {},
          createSystemSettingsPrincipal({
            userId: ctx.userId,
            role: ctx.role,
          })
        );
      return { policy };
    } catch (error) {
      throwModerationPolicyActionError(error);
    }
  });

/** 更新全站审核级别；策略、事务与审计由 UOL 下层统一完成。 */
export const setGlobalModerationPolicyAction = superAdminAction
  .metadata({ action: "system-settings.moderation.setGlobalPolicy" })
  .schema(globalModerationPolicyInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const result =
        await invokeOperation<GlobalModerationPolicyWriteActionResult>(
          "moderation.setGlobalRiskLevel",
          parsedInput,
          createSystemSettingsPrincipal({
            userId: ctx.userId,
            role: ctx.role,
          })
        );
      return {
        success: true,
        ...result,
        message: result.changed
          ? "全站审核级别已更新"
          : "全站审核级别未发生变化",
      };
    } catch (error) {
      throwModerationPolicyActionError(error);
    }
  });

export const updateSystemSettingsAction = superAdminAction
  .metadata({ action: "system-settings.update" })
  .schema(
    z.object({
      settings: z.array(settingUpdateSchema).min(1),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const changedKeys = await setSystemSettings(
      parsedInput.settings.map((setting) => ({
        key: setting.key,
        value: setting.value,
        ...(setting.clear !== undefined ? { clear: setting.clear } : {}),
      })),
      ctx.userId
    );
    // 启用"按最大张数"清理时立即后台执行一次（需求）。判定单点在 shared 纯谓词，
    // 与 UOL 写入口共用以保证行为一致。清空（回退默认）时传 undefined，不误判为启用。
    const modeEntry = parsedInput.settings.find(
      (setting) => setting.key === "GENERATION_IMAGE_RETENTION_MODE"
    );
    const newModeValue =
      modeEntry?.clear === true ? undefined : modeEntry?.value;

    if (shouldRunMaxCountCleanupOnSettingsChange(changedKeys, newModeValue)) {
      // WHY: 清理会删存储对象并扫描，耗时不可控，不能 await 阻塞保存响应（避免
      // server action 超时）。后台 fire-and-forget + 显式 catch 记日志，杜绝未处理
      // 的 promise 拒绝。批量上限与幂等 WHERE 由清理函数自身兜底，与定时任务并发
      // 安全（deleteObject 幂等 + UPDATE 守卫）。超出单批的部分由后续定时任务收敛。
      void destroyGenerationPhotosByMaxCount().catch((error) => {
        logError(error, {
          source: "system-settings.enable-max-count-cleanup",
        });
      });
    }

    return {
      success: true,
      changedKeys,
      message: "系统设置已保存",
    };
  });

export const importSystemSettingsFromEnvAction = superAdminAction
  .metadata({ action: "system-settings.importEnv" })
  .schema(z.object({ overwrite: z.boolean().optional() }).optional())
  .action(async ({ parsedInput, ctx }) => {
    const importedKeys = await importSystemSettingsFromEnv({
      updatedBy: ctx.userId,
      overwrite: parsedInput?.overwrite ?? true,
    });
    return {
      success: true,
      importedKeys,
      message:
        importedKeys.length > 0
          ? `已导入 ${importedKeys.length} 个环境变量配置`
          : "没有可导入的环境变量配置",
    };
  });

export const initializeSystemSettingsDefaultsAction = superAdminAction
  .metadata({ action: "system-settings.initializeDefaults" })
  .action(async ({ ctx }) => {
    const initializedKeys = await initializeMissingSystemSettingsDefaults({
      updatedBy: ctx.userId,
    });
    return {
      success: true,
      initializedKeys,
      message:
        initializedKeys.length > 0
          ? `已初始化 ${initializedKeys.length} 个默认配置`
          : "默认配置已存在，无需初始化",
    };
  });
