/**
 * 用户控制台首页的统一服务端数据装配器。
 *
 * 首屏 Server Component 与刷新 Server Action 共用本模块，确保摘要、趋势和近期创作
 * 采用同一用户 Principal；筛选请求仍单独调用趋势 operation，避免重复查询摘要。
 */
import { db } from "@repo/database";
import {
  type SafePostgresPoolError,
  sanitizePostgresPoolError,
} from "@repo/database/pool";
import { generation } from "@repo/database/schema";
import type {
  UsageSummaryOutput,
  UsageTrendsInput,
  UsageTrendsOutput,
} from "@repo/shared/analytics/contracts";
import type { AppUserRole } from "@repo/shared/auth/roles";
import { logError } from "@repo/shared/logger";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { invokeOperation } from "@repo/shared/uol";
import { and, desc, eq } from "drizzle-orm";

import type { RecentCreation } from "@/features/image-generation/components/recent-creations-client";
import { hasLayeredMeta } from "@/features/psd-export/layered-meta";
import { ensureUolInitialized } from "@/server/uol-init";

export type DashboardSnapshot = {
  summary: UsageSummaryOutput;
  trends: UsageTrendsOutput;
  recentCreations: RecentCreation[];
};

type DashboardSnapshotDependencies = {
  ensureInitialized: () => Promise<void>;
  loadSummary: (input: {
    userId: string;
    role: AppUserRole;
  }) => Promise<UsageSummaryOutput>;
  loadTrends: (input: {
    userId: string;
    role: AppUserRole;
    trendsInput: UsageTrendsInput;
  }) => Promise<UsageTrendsOutput>;
  loadRecentCreations: (userId: string) => Promise<RecentCreation[]>;
  reportRecentCreationsError: (error: SafePostgresPoolError) => void;
};

/**
 * 读取当前用户最近四项已完成图片创作。
 *
 * @param userId 当前会话 Principal 的用户 ID。
 * @returns 可直接交给 RecentCreationsClient 的签名 URL 数据；无记录时返回空数组。
 */
export async function loadRecentDashboardCreations(
  userId: string
): Promise<RecentCreation[]> {
  const rows = await db
    .select({
      id: generation.id,
      prompt: generation.prompt,
      revisedPrompt: generation.revisedPrompt,
      model: generation.model,
      size: generation.size,
      status: generation.status,
      creditsConsumed: generation.creditsConsumed,
      storageKey: generation.storageKey,
      storageBucket: generation.storageBucket,
      metadata: generation.metadata,
      createdAt: generation.createdAt,
    })
    .from(generation)
    .where(
      and(eq(generation.userId, userId), eq(generation.status, "completed"))
    )
    .orderBy(desc(generation.createdAt))
    .limit(4);

  return rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    revisedPrompt: row.revisedPrompt,
    model: row.model,
    size: row.size,
    status: row.status,
    creditsConsumed: row.creditsConsumed,
    storageKey: row.storageKey,
    storageBucket: row.storageBucket,
    imageUrl: buildSignedStorageImageUrl(row.storageKey, row.storageBucket),
    isLayered: hasLayeredMeta(row.metadata),
    createdAt: row.createdAt.toISOString(),
  }));
}

/** 通过 Analytics UOL 读取本人摘要，身份只来自服务端 Principal。 */
async function loadSummaryThroughUol(input: {
  userId: string;
  role: AppUserRole;
}): Promise<UsageSummaryOutput> {
  return invokeOperation<UsageSummaryOutput>(
    "analytics.getMyUsageSummary",
    {},
    { type: "user", userId: input.userId, role: input.role }
  );
}

/** 通过 Analytics UOL 读取本人趋势与活动分布。 */
async function loadTrendsThroughUol(input: {
  userId: string;
  role: AppUserRole;
  trendsInput: UsageTrendsInput;
}): Promise<UsageTrendsOutput> {
  return invokeOperation<UsageTrendsOutput>(
    "analytics.getMyUsageTrends",
    input.trendsInput,
    { type: "user", userId: input.userId, role: input.role }
  );
}

/**
 * 从 Drizzle 包装错误中提取安全的数据库根因字段。
 *
 * 外层错误包含完整 SQL 和绑定参数，不能直接进入日志；若根因缺失则只记录通用消息。
 */
function sanitizeRecentCreationsError(error: unknown): SafePostgresPoolError {
  const cause =
    error instanceof Error && "cause" in error ? error.cause : undefined;
  return sanitizePostgresPoolError(
    cause ?? new Error("Recent creations query failed")
  );
}

/** 记录脱敏后的近期创作降级原因，但不让非关键画廊预览拖垮控制台主体。 */
function reportRecentCreationsError(error: SafePostgresPoolError): void {
  logError(new Error("Dashboard recent creations are unavailable"), {
    source: "dashboard-recent-creations",
    databaseError: error,
  });
}

const defaultSnapshotDependencies: DashboardSnapshotDependencies = {
  ensureInitialized: ensureUolInitialized,
  loadSummary: loadSummaryThroughUol,
  loadTrends: loadTrendsThroughUol,
  loadRecentCreations: loadRecentDashboardCreations,
  reportRecentCreationsError,
};

/**
 * 装配控制台首屏或刷新快照。
 *
 * @param input 当前用户、角色和已经过共享 schema 约束的趋势筛选。
 * @returns 摘要、趋势和近期创作；近期创作失败时降级为空，核心统计失败时整体拒绝。
 */
export async function loadDashboardSnapshot(
  input: {
    userId: string;
    role: AppUserRole;
    trendsInput: UsageTrendsInput;
  },
  dependencies: DashboardSnapshotDependencies = defaultSnapshotDependencies
): Promise<DashboardSnapshot> {
  await dependencies.ensureInitialized();
  const recentCreationsPromise = dependencies
    .loadRecentCreations(input.userId)
    .catch((error: unknown) => {
      dependencies.reportRecentCreationsError(
        sanitizeRecentCreationsError(error)
      );
      return [];
    });
  const [summary, trends, recentCreations] = await Promise.all([
    dependencies.loadSummary({ userId: input.userId, role: input.role }),
    dependencies.loadTrends(input),
    recentCreationsPromise,
  ]);
  return { summary, trends, recentCreations };
}
