"use server";

/**
 * 使用日志 Server Action 薄传输适配器。
 *
 * 职责仅限校验输入、读取当前会话角色并调用 UOL；readiness、数据库查询、
 * relay 隐私和本人隔离全部由统一接口层绑定与服务负责。
 */

import { getUserRoleById } from "@repo/shared/auth/role-server";
import {
  type UsageEvent,
  type UsageEventDetail,
  usageLogDetailInputSchema,
  usageLogListInputSchema,
} from "@repo/shared/credits/usage-log-contract";
import { ActionUserError, protectedAction } from "@repo/shared/safe-action";
import { invokeOperation, OperationError } from "@repo/shared/uol";

import { ensureUolInitialized } from "@/server/uol-init";
import { USAGE_LOG_NOT_READY_MESSAGE } from "./action-errors";

/**
 * 将 UOL readiness 错误变为生产环境仍可识别的安全用户错误。
 *
 * @param error UOL 调用抛出的未知错误。
 * @throws not_ready 转为 ActionUserError；其他错误保持原对象上抛。
 */
function rethrowUsageLogActionError(error: unknown): never {
  if (error instanceof OperationError && error.code === "not_ready") {
    throw new ActionUserError(USAGE_LOG_NOT_READY_MESSAGE);
  }
  throw error;
}

/** 读取当前用户的一页使用日志。 */
export const getMyUsageEventsAction = protectedAction
  .metadata({ action: "credits.listMyUsageEvents" })
  .schema(usageLogListInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      await ensureUolInitialized();
      const role = await getUserRoleById(ctx.userId);
      return await invokeOperation<{
        asOf: string;
        events: UsageEvent[];
        nextCursor: string | null;
      }>("credits.listMyUsageEvents", parsedInput, {
        type: "user",
        userId: ctx.userId,
        role,
      });
    } catch (error) {
      rethrowUsageLogActionError(error);
    }
  });

/** 按主体绑定的 eventRef 读取当前用户单条详情。 */
export const getMyUsageEventDetailAction = protectedAction
  .metadata({ action: "credits.getMyUsageEventDetail" })
  .schema(usageLogDetailInputSchema)
  .action(async ({ parsedInput, ctx }): Promise<UsageEventDetail> => {
    try {
      await ensureUolInitialized();
      const role = await getUserRoleById(ctx.userId);
      return await invokeOperation<UsageEventDetail>(
        "credits.getMyUsageEventDetail",
        parsedInput,
        { type: "user", userId: ctx.userId, role }
      );
    } catch (error) {
      rethrowUsageLogActionError(error);
    }
  });
