"use server";

/**
 * 首页 SLA 展示开关的 Server Action 薄适配器。
 *
 * 使用方：首页管理员 client island；只解析布尔输入、构造真实用户 Principal、调用
 * UOL 并映射安全反馈，权限与设置写入由统一操作层负责。
 */
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { logger } from "@repo/shared/logger";
import { ActionUserError, protectedAction } from "@repo/shared/safe-action";
import { invokeOperation, OperationError } from "@repo/shared/uol";
import { z } from "zod";
import { ensureUolInitialized } from "@/server/uol-init";

/** 解析管理员的开关请求并转交统一操作层。 */
export const updateMarketingSlaStatusVisibilityAction = protectedAction
  .metadata({ action: "marketing.slaStatus.visibility" })
  .schema(z.object({ enabled: z.boolean() }).strict())
  .action(async ({ parsedInput, ctx }) => {
    try {
      await ensureUolInitialized();
      const role = await getUserRoleById(ctx.userId);
      return await invokeOperation<{ enabled: boolean }>(
        "settings.setMarketingSlaVisibility",
        parsedInput,
        { type: "user", userId: ctx.userId, role }
      );
    } catch (error) {
      const safeCode =
        error instanceof OperationError ? error.code : "unexpected_failure";
      logger.error(
        {
          event: "marketing_sla_visibility_update_failed",
          safeCode,
        },
        "Homepage SLA visibility update failed"
      );
      if (
        error instanceof OperationError &&
        (error.code === "forbidden" || error.code === "unauthenticated")
      ) {
        throw new ActionUserError("此操作需要管理员权限");
      }
      throw new ActionUserError("更新首页 SLA 展示失败，请稍后重试");
    }
  });
