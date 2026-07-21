"use server";

/**
 * 用户控制台统计的 Server Action 传输适配器。
 *
 * 职责仅限读取当前会话、构造本人 Principal 并调用 Analytics UOL；统计查询的
 * readiness、范围校验、用户归属和数据库访问统一由 UOL 绑定与查询服务负责。
 */
import {
  type UsageSummaryOutput,
  type UsageTrendsOutput,
  usageSummaryInputSchema,
  usageTrendsInputSchema,
} from "@repo/shared/analytics/contracts";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { protectedAction } from "@repo/shared/safe-action";
import { invokeOperation } from "@repo/shared/uol";

import { ensureUolInitialized } from "@/server/uol-init";

import {
  type DashboardSnapshot,
  loadDashboardSnapshot,
} from "./dashboard-data";

/** 读取当前用户今日与累计图片、视频和净消耗积分摘要。 */
export const getMyUsageSummaryAction = protectedAction
  .metadata({ action: "analytics.getMyUsageSummary" })
  .schema(usageSummaryInputSchema)
  .action(async ({ parsedInput, ctx }): Promise<UsageSummaryOutput> => {
    await ensureUolInitialized();
    const role = await getUserRoleById(ctx.userId);
    return invokeOperation<UsageSummaryOutput>(
      "analytics.getMyUsageSummary",
      parsedInput,
      { type: "user", userId: ctx.userId, role }
    );
  });

/** 读取当前用户按小时或按天的图片/视频趋势与任务分布。 */
export const getMyUsageTrendsAction = protectedAction
  .metadata({ action: "analytics.getMyUsageTrends" })
  .schema(usageTrendsInputSchema)
  .action(async ({ parsedInput, ctx }): Promise<UsageTrendsOutput> => {
    await ensureUolInitialized();
    const role = await getUserRoleById(ctx.userId);
    return invokeOperation<UsageTrendsOutput>(
      "analytics.getMyUsageTrends",
      parsedInput,
      { type: "user", userId: ctx.userId, role }
    );
  });

/**
 * 按当前已提交筛选刷新摘要、趋势与近期创作。
 * 任一子查询失败时 action 整体失败，客户端不会混用不同时间点的数据。
 */
export const refreshDashboardSnapshotAction = protectedAction
  .metadata({ action: "analytics.refreshDashboardSnapshot" })
  .schema(usageTrendsInputSchema)
  .action(async ({ parsedInput, ctx }): Promise<DashboardSnapshot> => {
    const role = await getUserRoleById(ctx.userId);
    return loadDashboardSnapshot({
      userId: ctx.userId,
      role,
      trendsInput: parsedInput,
    });
  });
