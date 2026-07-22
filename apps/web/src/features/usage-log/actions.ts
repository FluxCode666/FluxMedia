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
import { protectedAction } from "@repo/shared/safe-action";
import { invokeOperation } from "@repo/shared/uol";

import { ensureUolInitialized } from "@/server/uol-init";

/** 读取当前用户的一页使用日志。 */
export const getMyUsageEventsAction = protectedAction
  .metadata({ action: "credits.listMyUsageEvents" })
  .schema(usageLogListInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await ensureUolInitialized();
    const role = await getUserRoleById(ctx.userId);
    return invokeOperation<{
      asOf: string;
      events: UsageEvent[];
      nextCursor: string | null;
    }>("credits.listMyUsageEvents", parsedInput, {
      type: "user",
      userId: ctx.userId,
      role,
    });
  });

/** 按主体绑定的 eventRef 读取当前用户单条详情。 */
export const getMyUsageEventDetailAction = protectedAction
  .metadata({ action: "credits.getMyUsageEventDetail" })
  .schema(usageLogDetailInputSchema)
  .action(async ({ parsedInput, ctx }): Promise<UsageEventDetail> => {
    await ensureUolInitialized();
    const role = await getUserRoleById(ctx.userId);
    return invokeOperation<UsageEventDetail>(
      "credits.getMyUsageEventDetail",
      parsedInput,
      { type: "user", userId: ctx.userId, role }
    );
  });
