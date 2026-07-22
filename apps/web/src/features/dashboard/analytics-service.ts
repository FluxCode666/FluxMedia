/**
 * 控制台成功产出统计查询服务。
 *
 * 在线路径只读取窄型产物事件、每用户累计汇总和 readiness；摘要用固定滚动 24 小时
 * 聚合产出、积分与模型分布，保留的 MCP 趋势查询复用 shared 契约补齐连续零桶。
 */
import { db } from "@repo/database";
import {
  analyticsReadModelState,
  creditUsageOperation,
  generation,
  userOutputUsageEvent,
  userUsageSummary,
  videoGeneration,
} from "@repo/database/schema";
import type {
  AnalyticsGranularity,
  AnalyticsMetric,
  ModelUsageDistribution,
  UsageSeriesBucket,
} from "@repo/shared/analytics/contracts";
import type { ResolvedUsageTimeRange } from "@repo/shared/analytics/range";
import {
  buildUsageBuckets,
  fillUsageSeries,
} from "@repo/shared/analytics/series";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";

type OutputUsageTotals = {
  imageCount: number;
  videoSeconds: number;
};

/** 积分读模型摘要；只保存净消耗，退款不会制造负展示值。 */
type CreditUsageTotals = { creditsConsumed: number };

type ReadRangeAggregatesInput = {
  userId: string;
  start: Date;
  end: Date;
  granularity: AnalyticsGranularity;
  metric: AnalyticsMetric;
  timeZone: string;
};

type OutputUsageAggregateRow = {
  bucketKey: number | string;
  metricValue: number;
  imageTasks: number;
  videoTasks: number;
};

type ModelUsageRow = {
  model: string;
  taskCount: number;
};

/** 查询服务依赖的最小仓储，测试可在 DB-free 环境注入。 */
export interface OutputUsageAnalyticsRepository {
  readRangeTotals: (input: {
    userId: string;
    start: Date;
    end: Date;
  }) => Promise<OutputUsageTotals | null>;
  readLifetimeTotals: (userId: string) => Promise<OutputUsageTotals | null>;
  readModelUsage: (input: {
    userId: string;
    start: Date;
    end: Date;
  }) => Promise<ModelUsageRow[]>;
  readRangeAggregates: (
    input: ReadRangeAggregatesInput
  ) => Promise<OutputUsageAggregateRow[]>;
}

/** 积分摘要仓储；实现必须限定 userId 并只读 operation/余额窄列。 */
export interface CreditUsageAnalyticsRepository {
  readRangeCredits: (input: {
    userId: string;
    start: Date;
    end: Date;
  }) => Promise<CreditUsageTotals | null>;
  readLifetimeCredits: (userId: string) => Promise<CreditUsageTotals | null>;
}

/**
 * 构造线上趋势查询唯一允许使用的用户半开范围谓词。
 *
 * @param input Principal 用户与已验证 UTC 边界。
 * @returns 同时包含 userId、`>= start` 和 `< end` 的 SQL，防止越权和相邻桶重复。
 */
export function buildOutputUsageRangePredicate(input: {
  userId: string;
  start: Date;
  end: Date;
}): SQL {
  const predicate = and(
    eq(userOutputUsageEvent.userId, input.userId),
    gte(userOutputUsageEvent.operationCreatedAt, input.start),
    lt(userOutputUsageEvent.operationCreatedAt, input.end)
  );
  if (!predicate) throw new Error("无法构造产物用量范围条件");
  return predicate;
}

/**
 * 构造固定 60 分钟桶序号表达式，并强制使用数据库 timestamp 列编码器。
 *
 * @param start 已验证 UTC 半开范围起点。
 * @returns 相对 start 的非负小时桶序号 SQL；调用方的范围谓词负责排除负值。
 */
export function buildHourlyOutputUsageBucketKey(start: Date): SQL<number> {
  // 原始 sql 插值不会自动采用 timestamp 列编码器，Date 会被 node-postgres 按本地墙上
  // 时间序列化，非 UTC 服务器会产生时区偏移。显式绑定列编码器以保持 UTC 桶起点。
  const encodedStart = sql.param(
    start,
    userOutputUsageEvent.operationCreatedAt
  );
  return sql<number>`floor(extract(epoch from (${userOutputUsageEvent.operationCreatedAt} - ${encodedStart})) / 3600)::integer`.mapWith(
    Number
  );
}

/**
 * 构造一次范围聚合共用的指标与任务分布表达式。
 *
 * @param metric 当前折线指标。
 * @returns Drizzle select 字段；window 聚合让每个桶携带同一次扫描的任务总数。
 */
function buildRangeAggregateFields(metric: AnalyticsMetric) {
  const metricValue =
    metric === "imageCount"
      ? sql<number>`coalesce(sum(case when ${userOutputUsageEvent.outputKind} = 'image' then ${userOutputUsageEvent.imageCount} else 0 end), 0)`.mapWith(
          Number
        )
      : sql<number>`coalesce(sum(case when ${userOutputUsageEvent.outputKind} = 'video' then ${userOutputUsageEvent.videoSeconds} else 0 end), 0)`.mapWith(
          Number
        );
  return {
    metricValue,
    imageTasks:
      sql<number>`sum(count(*) filter (where ${userOutputUsageEvent.outputKind} = 'image')) over ()`.mapWith(
        Number
      ),
    videoTasks:
      sql<number>`sum(count(*) filter (where ${userOutputUsageEvent.outputKind} = 'video')) over ()`.mapWith(
        Number
      ),
  };
}

/**
 * 从事件窄表查询指定范围内的图片数与视频秒数。
 *
 * @param input 当前用户和已验证 UTC 半开区间。
 * @returns 无事件时仍返回零聚合；只扫描该用户 `[start,end)`。
 */
async function readRangeTotals(input: {
  userId: string;
  start: Date;
  end: Date;
}): Promise<OutputUsageTotals> {
  const [row] = await db
    .select({
      imageCount:
        sql<number>`coalesce(sum(${userOutputUsageEvent.imageCount}), 0)`.mapWith(
          Number
        ),
      videoSeconds:
        sql<number>`coalesce(sum(${userOutputUsageEvent.videoSeconds}), 0)`.mapWith(
          Number
        ),
    })
    .from(userOutputUsageEvent)
    .where(buildOutputUsageRangePredicate(input));
  return row ?? { imageCount: 0, videoSeconds: 0 };
}

/**
 * 在固定范围内按实际模型聚合成功任务。
 *
 * @param input 当前 Principal 用户和 UTC 半开区间。
 * @returns 每个模型的成功任务数；图片和视频使用同一事件范围扫描，缺失源行归为 unknown。
 */
async function readModelUsage(input: {
  userId: string;
  start: Date;
  end: Date;
}): Promise<ModelUsageRow[]> {
  const model = sql<string>`coalesce(
    nullif(trim(${generation.model}), ''),
    nullif(trim(${videoGeneration.model}), ''),
    'unknown'
  )`;
  const taskCount = sql<number>`count(*)`.mapWith(Number);
  return db
    .select({ model, taskCount })
    .from(userOutputUsageEvent)
    .leftJoin(
      generation,
      and(
        eq(userOutputUsageEvent.outputKind, "image"),
        eq(userOutputUsageEvent.sourceTaskId, generation.id),
        eq(userOutputUsageEvent.userId, generation.userId)
      )
    )
    .leftJoin(
      videoGeneration,
      and(
        eq(userOutputUsageEvent.outputKind, "video"),
        eq(userOutputUsageEvent.sourceTaskId, videoGeneration.id),
        eq(userOutputUsageEvent.userId, videoGeneration.userId)
      )
    )
    .where(buildOutputUsageRangePredicate(input))
    .groupBy(sql.raw("1"));
}

/**
 * 从每用户单行汇总读取完整历史累计。
 *
 * @param userId 当前 Principal 派生的用户 ID。
 * @returns 无汇总行时为 null，由服务层归零；不扫描事件历史。
 */
async function readLifetimeTotals(
  userId: string
): Promise<OutputUsageTotals | null> {
  const [row] = await db
    .select({
      imageCount: userUsageSummary.totalImageCount,
      videoSeconds: userUsageSummary.totalVideoSeconds,
    })
    .from(userUsageSummary)
    .where(eq(userUsageSummary.userId, userId))
    .limit(1);
  return row ?? null;
}

/** 读取范围内净积分消耗；operation_created_at 是业务操作时间而非退款发生时间。 */
async function readRangeCredits(input: {
  userId: string;
  start: Date;
  end: Date;
}): Promise<CreditUsageTotals> {
  const [row] = await db
    .select({
      creditsConsumed:
        sql<number>`coalesce(sum(${creditUsageOperation.netConsumed}), 0)`.mapWith(
          Number
        ),
    })
    .from(creditUsageOperation)
    .where(
      and(
        eq(creditUsageOperation.userId, input.userId),
        gte(creditUsageOperation.operationCreatedAt, input.start),
        lt(creditUsageOperation.operationCreatedAt, input.end)
      )
    );
  return row ?? { creditsConsumed: 0 };
}

/** 读取用户累计净消耗；避免扫描完整 credits_transaction 历史。 */
async function readLifetimeCredits(
  userId: string
): Promise<CreditUsageTotals | null> {
  const [row] = await db
    .select({
      creditsConsumed:
        sql<number>`coalesce(sum(${creditUsageOperation.netConsumed}), 0)`.mapWith(
          Number
        ),
    })
    .from(creditUsageOperation)
    .where(eq(creditUsageOperation.userId, userId));
  return row ?? null;
}

const creditDatabaseRepository: CreditUsageAnalyticsRepository = {
  readRangeCredits,
  readLifetimeCredits,
};

/**
 * 以一次有界 SQL 聚合小时趋势和两类任务总数。
 *
 * @param input 已验证用户、半开范围、指标和时区。
 * @returns 稀疏桶；bucketKey 是从范围起点开始的固定 60 分钟序号。
 */
async function readHourlyRangeAggregates(
  input: ReadRangeAggregatesInput
): Promise<OutputUsageAggregateRow[]> {
  const bucketKey = buildHourlyOutputUsageBucketKey(input.start);
  const rows = await db
    .select({ bucketKey, ...buildRangeAggregateFields(input.metric) })
    .from(userOutputUsageEvent)
    .where(buildOutputUsageRangePredicate(input))
    // Drizzle 会为同一个 Date 在 SELECT/GROUP BY/ORDER BY 分配不同参数编号，
    // PostgreSQL 因而无法证明三段表达式相同。按第一个投影列分组和排序可复用
    // 已计算的 bucketKey，也避免重复时间表达式和参数绑定。
    .groupBy(sql.raw("1"))
    .orderBy(sql.raw("1"));
  return rows;
}

/**
 * 以一次有界 SQL 聚合应用时区自然日趋势和两类任务总数。
 *
 * @param input 已验证用户、半开范围、指标和 IANA 时区。
 * @returns 稀疏桶；bucketKey 为应用时区中的 `YYYY-MM-DD`。
 */
async function readDailyRangeAggregates(
  input: ReadRangeAggregatesInput
): Promise<OutputUsageAggregateRow[]> {
  // operation_created_at 是存储 UTC 瞬间的 timestamp without time zone；先按 UTC
  // 解释再转换为应用时区，避免数据库 session timezone 改变自然日归属。
  const bucketKey = sql<string>`to_char((${userOutputUsageEvent.operationCreatedAt} at time zone 'UTC') at time zone ${input.timeZone}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ bucketKey, ...buildRangeAggregateFields(input.metric) })
    .from(userOutputUsageEvent)
    .where(buildOutputUsageRangePredicate(input))
    .groupBy(sql.raw("1"))
    .orderBy(sql.raw("1"));
  return rows;
}

/**
 * 生产仓储：所有查询限定当前用户，范围查询只执行一次聚合扫描。
 */
const databaseRepository: OutputUsageAnalyticsRepository = {
  readRangeTotals,
  readLifetimeTotals,
  readModelUsage,
  readRangeAggregates(input) {
    return input.granularity === "hour"
      ? readHourlyRangeAggregates(input)
      : readDailyRangeAggregates(input);
  },
};

/**
 * 防御性验证数据库聚合值，避免损坏的读模型被静默映射为图表数据。
 *
 * @param value 数据库返回的累计或桶值。
 * @param fieldName 错误定位字段。
 * @returns 同一非负安全整数。
 * @throws RangeError 当值越界或不是整数。
 */
function requireNonnegativeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName}必须是非负安全整数`);
  }
  return value;
}

/**
 * 将可空仓储累计规范化为安全非负整数。
 *
 * @param totals 近 24 小时或完整历史累计。
 * @returns 缺行补零后的图片数与视频秒数。
 */
function normalizeOutputUsageTotals(
  totals: OutputUsageTotals | null
): OutputUsageTotals {
  return {
    imageCount: requireNonnegativeInteger(totals?.imageCount ?? 0, "图片累计"),
    videoSeconds: requireNonnegativeInteger(
      totals?.videoSeconds ?? 0,
      "视频秒数累计"
    ),
  };
}

/** 防止投影损坏或退款竞态把负值送到页面。 */
function normalizeCreditTotals(
  totals: CreditUsageTotals | null
): CreditUsageTotals {
  const value = totals?.creditsConsumed ?? 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("积分净消耗必须是非负有限数字");
  }
  return { creditsConsumed: value };
}

/**
 * 合并图片与视频可能重复的模型名称，并生成稳定降序分布。
 *
 * @param rows 数据库模型聚合行；重复模型会安全相加。
 * @returns 可直接通过共享契约校验的模型任务分布。
 * @throws RangeError 当数据库返回负数、非整数或合计超过安全整数。
 */
function normalizeModelUsage(
  rows: readonly ModelUsageRow[]
): ModelUsageDistribution {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const model = row.model.trim() || "unknown";
    const taskCount = requireNonnegativeInteger(row.taskCount, "模型任务数");
    const nextCount = (totals.get(model) ?? 0) + taskCount;
    totals.set(model, requireNonnegativeInteger(nextCount, "模型任务数合计"));
  }
  const models = [...totals.entries()]
    .map(([model, taskCount]) => ({ model, taskCount }))
    .sort(
      (left, right) =>
        right.taskCount - left.taskCount ||
        left.model.localeCompare(right.model)
    );
  const totalTasks = requireNonnegativeInteger(
    models.reduce((sum, item) => sum + item.taskCount, 0),
    "模型总任务数"
  );
  return { models, totalTasks };
}

/**
 * 加载近 24 小时和累计成功产出摘要。
 *
 * @param input 当前用户与滚动 24 小时半开区间。
 * @param repository 可替换仓储；生产默认读取事件窄表和用户汇总单行。
 * @returns 图片数、视频秒数、积分及同范围模型分布；缺行统一为 0。
 */
export async function loadOutputUsageSummary(
  input: {
    userId: string;
    last24HoursRange: { start: Date; end: Date };
  },
  repository: OutputUsageAnalyticsRepository = databaseRepository,
  creditRepository: CreditUsageAnalyticsRepository = creditDatabaseRepository
): Promise<{
  last24Hours: OutputUsageTotals & CreditUsageTotals;
  modelDistribution: ModelUsageDistribution;
  lifetime: OutputUsageTotals & CreditUsageTotals;
}> {
  const [recent, lifetime, recentCredits, lifetimeCredits, modelUsage] =
    await Promise.all([
      repository.readRangeTotals({
        userId: input.userId,
        start: input.last24HoursRange.start,
        end: input.last24HoursRange.end,
      }),
      repository.readLifetimeTotals(input.userId),
      creditRepository.readRangeCredits({
        userId: input.userId,
        start: input.last24HoursRange.start,
        end: input.last24HoursRange.end,
      }),
      creditRepository.readLifetimeCredits(input.userId),
      repository.readModelUsage({
        userId: input.userId,
        start: input.last24HoursRange.start,
        end: input.last24HoursRange.end,
      }),
    ]);
  return {
    last24Hours: {
      ...normalizeOutputUsageTotals(recent),
      ...normalizeCreditTotals(recentCredits),
    },
    modelDistribution: normalizeModelUsage(modelUsage),
    lifetime: {
      ...normalizeOutputUsageTotals(lifetime),
      ...normalizeCreditTotals(lifetimeCredits),
    },
  };
}

/**
 * 将 SQL bucketKey 映射到 shared 规范桶起点。
 *
 * @param row SQL 稀疏聚合行。
 * @param range 已解析时间范围。
 * @param buckets shared 构造的连续桶。
 * @returns 可交给 fillUsageSeries 的稳定起点和值。
 * @throws RangeError 当数据库返回范围外或非法桶键。
 */
function mapAggregateRowToPoint(
  row: OutputUsageAggregateRow,
  range: ResolvedUsageTimeRange,
  buckets: readonly UsageSeriesBucket[]
): { bucketStart: string; value: number } {
  const bucket =
    range.granularity === "hour"
      ? typeof row.bucketKey === "number" &&
        Number.isInteger(row.bucketKey) &&
        row.bucketKey >= 0
        ? buckets[row.bucketKey]
        : undefined
      : typeof row.bucketKey === "string"
        ? buckets.find((item) => item.label === row.bucketKey)
        : undefined;
  if (!bucket) {
    throw new RangeError(`SQL 返回了范围外时间桶：${String(row.bucketKey)}`);
  }
  return {
    bucketStart: bucket.start,
    value: requireNonnegativeInteger(row.metricValue, "趋势桶值"),
  };
}

/**
 * 加载单指标趋势和同范围任务类型分布。
 *
 * @param input 当前用户和 shared 已解析范围。
 * @param repository 可替换仓储；生产仅执行一次事件范围聚合。
 * @returns 连续补零桶与图片/视频任务数。
 */
export async function loadOutputUsageTrends(
  input: { userId: string; range: ResolvedUsageTimeRange },
  repository: OutputUsageAnalyticsRepository = databaseRepository
): Promise<{
  buckets: UsageSeriesBucket[];
  distribution: {
    imageTasks: number;
    videoTasks: number;
    totalTasks: number;
  };
}> {
  const buckets = buildUsageBuckets(input.range);
  const rows = await repository.readRangeAggregates({
    userId: input.userId,
    start: input.range.start,
    end: input.range.end,
    granularity: input.range.granularity,
    metric: input.range.metric,
    timeZone: input.range.timeZone,
  });
  const points = rows.map((row) =>
    mapAggregateRowToPoint(row, input.range, buckets)
  );
  const first = rows[0];
  const imageTasks = requireNonnegativeInteger(
    first?.imageTasks ?? 0,
    "图片任务数"
  );
  const videoTasks = requireNonnegativeInteger(
    first?.videoTasks ?? 0,
    "视频任务数"
  );
  for (const row of rows) {
    if (row.imageTasks !== imageTasks || row.videoTasks !== videoTasks) {
      throw new RangeError("同一次范围聚合返回了不一致的任务分布");
    }
  }
  return {
    buckets: fillUsageSeries(buckets, points),
    distribution: {
      imageTasks,
      videoTasks,
      totalTasks: requireNonnegativeInteger(
        imageTasks + videoTasks,
        "任务总数"
      ),
    },
  };
}

/** 单个统计读模型的版本、状态和最近对账时间。 */
export type AnalyticsReadModelState = {
  version: number;
  status: (typeof analyticsReadModelState.$inferSelect)["status"];
  lastReconciledAt: Date | null;
} | null;

/**
 * 读取输出用量读模型状态，供 UOL 绑定在查询前执行 readiness 门禁。
 *
 * @returns 当前版本、状态和最近对账时间；迁移未种子化时返回 null。
 */
export async function readOutputUsageReadModelState(): Promise<AnalyticsReadModelState> {
  const [row] = await db
    .select({
      version: analyticsReadModelState.version,
      status: analyticsReadModelState.status,
      lastReconciledAt: analyticsReadModelState.lastReconciledAt,
    })
    .from(analyticsReadModelState)
    .where(eq(analyticsReadModelState.readModel, "output_usage"))
    .limit(1);
  return row ?? null;
}

/**
 * 读取控制台统计依赖的全部读模型状态。
 *
 * 产出事件和积分净消耗分别回填、分别对账；只有两者都 ready 才能向用户返回
 * 完整摘要，避免出现图片/视频已可见而积分仍在构建中的口径漂移。
 */
export async function readAnalyticsReadModelStates(): Promise<{
  outputUsage: AnalyticsReadModelState;
  creditUsage: AnalyticsReadModelState;
}> {
  const rows = await db
    .select({
      readModel: analyticsReadModelState.readModel,
      version: analyticsReadModelState.version,
      status: analyticsReadModelState.status,
      lastReconciledAt: analyticsReadModelState.lastReconciledAt,
    })
    .from(analyticsReadModelState)
    .where(
      sql`${analyticsReadModelState.readModel} in ('output_usage', 'credit_usage')`
    );
  const byName = new Map(rows.map((row) => [row.readModel, row]));
  return {
    outputUsage: byName.get("output_usage") ?? null,
    creditUsage: byName.get("credit_usage") ?? null,
  };
}
