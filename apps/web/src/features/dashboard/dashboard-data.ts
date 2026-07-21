/**
 * 用户控制台首页的统一服务端数据装配器。
 *
 * 首屏 Server Component 与刷新 Server Action 共用本模块，确保摘要、趋势和近期创作
 * 采用同一用户 Principal；筛选请求仍单独调用趋势 operation，避免重复查询摘要。
 */
import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import type {
  UsageSummaryOutput,
  UsageTrendsInput,
  UsageTrendsOutput,
} from "@repo/shared/analytics/contracts";
import type { AppUserRole } from "@repo/shared/auth/roles";
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

const defaultSnapshotDependencies: DashboardSnapshotDependencies = {
  ensureInitialized: ensureUolInitialized,
  loadSummary: loadSummaryThroughUol,
  loadTrends: loadTrendsThroughUol,
  loadRecentCreations: loadRecentDashboardCreations,
};

/**
 * 原子装配控制台首屏或刷新快照。
 *
 * @param input 当前用户、角色和已经过共享 schema 约束的趋势筛选。
 * @returns 摘要、趋势和近期创作；任一查询失败则整体拒绝，调用方保留旧快照。
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
  const [summary, trends, recentCreations] = await Promise.all([
    dependencies.loadSummary({ userId: input.userId, role: input.role }),
    dependencies.loadTrends(input),
    dependencies.loadRecentCreations(input.userId),
  ]);
  return { summary, trends, recentCreations };
}
