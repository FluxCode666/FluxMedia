/**
 * 使用日志 PostgreSQL 仓储。
 *
 * 使用方：UOL bindings。列表以单条参数化 CTE + UNION ALL 完成四分支有界查询；
 * 详情按签名事件类型执行一次窄查询。禁止把外部输入拼入 sql.raw。
 */

import { db } from "@repo/database";
import { analyticsReadModelState } from "@repo/database/schema";
import {
  usageBusinessTypeSchema,
  usageSourceChannelSchema,
  usageStatusSchema,
} from "@repo/shared/credits/usage-log-contract";
import { eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import type { UsageLogListQuery, UsageLogRepository } from "./service";
import { parseUsageLogStableId, type UsageLogStableId } from "./stable-id";

const HISTORICAL_OPERATION_TYPES = [
  "manual_consumption",
  "admin_credit_adjustment",
  "uol_credit_consumption",
] as const;

const listRowSchema = z.object({
  event_kind: z.enum(["request", "refund"]),
  business_type: usageBusinessTypeSchema,
  related_business_type: usageBusinessTypeSchema.nullable().optional(),
  operation_type: z.string().min(1).max(200),
  fact_kind: z.enum(["request", "refund", "financial"]),
  generation_mode: z.string().min(1).max(100).nullable(),
  source_channel: usageSourceChannelSchema,
  event_at: z.coerce.date(),
  event_kind_rank: z.coerce.number().int().min(0).max(3),
  stable_id: z.string().min(1).max(512),
  status: usageStatusSchema,
  raw_status: z.string().min(1).max(100).nullable(),
  gross_consumed: z.coerce.number().nonnegative(),
  refund_amount: z.coerce.number().nonnegative(),
});

const requestDetailRowSchema = z.object({
  business_type: z.enum(["image", "video", "historical"]),
  request_id: z.string().min(1).max(512),
  source_channel: usageSourceChannelSchema,
  status: z.enum(["processing", "succeeded", "failed", "unknown"]),
  raw_status: z.string().min(1).max(100).nullable(),
  model_or_endpoint: z.string().min(1).max(240).nullable(),
  actual_usage_value: z.coerce.number().nonnegative().nullable(),
  gross_consumed: z.coerce.number().nonnegative(),
  refunded: z.coerce.number().nonnegative(),
  created_at: z.coerce.date(),
  completed_at: z.coerce.date().nullable(),
  raw_error: z.string().nullable(),
  has_resource: z.boolean(),
});

const refundDetailRowSchema = z.object({
  refund_id: z.string().min(1).max(512),
  original_stable_id: z.string().min(1).max(512).nullable(),
  original_business_type: usageBusinessTypeSchema.nullable(),
  original_request_label: z.string().min(1).max(240),
  source_channel: usageSourceChannelSchema,
  refunded: z.coerce.number().positive(),
  created_at: z.coerce.date(),
  resource_kind: z.enum(["image", "video"]).nullable(),
  resource_id: z.string().min(1).max(512).nullable(),
});

/** Drizzle PostgreSQL execute 在 node/neon driver 下分别返回 rows 或数组。 */
function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

type StableKind = UsageLogStableId[0];

const STABLE_KIND_ORDER: Record<StableKind, number> = {
  generation: 0,
  operation: 1,
  refund: 2,
  video: 3,
};

interface BranchStableKey {
  kind: StableKind;
  first: SQL;
  second?: SQL;
}

/** 返回 SQL 字面量，避免可选筛选的 OR 参数阻断复合索引前缀。 */
function booleanSql(value: boolean): SQL {
  return value ? sql`true` : sql`false`;
}

/** 将全局稳定键比较收窄到分支原始主键，保留索引可用性。 */
function buildStableTiePredicate(
  input: UsageLogListQuery,
  branch: BranchStableKey
): SQL {
  const cursorKey = input.cursor?.stableKey;
  if (!cursorKey) return sql`true`;
  if (branch.kind !== cursorKey[0]) {
    return booleanSql(
      STABLE_KIND_ORDER[branch.kind] < STABLE_KIND_ORDER[cursorKey[0]]
    );
  }
  if (branch.kind === "operation" && cursorKey[0] === "operation") {
    if (!branch.second) return sql`false`;
    return sql`(
      ${branch.first} < ${cursorKey[1]}
      OR (${branch.first} = ${cursorKey[1]} AND ${branch.second} < ${cursorKey[2]})
    )`;
  }
  return sql`${branch.first} < ${cursorKey[1]}`;
}

/** 创建直接比较原始时间、rank 和主键的分支 keyset 谓词。 */
function buildBranchKeysetPredicate(
  input: UsageLogListQuery,
  eventAt: SQL,
  eventKindRank: number,
  stableKey: BranchStableKey
): SQL {
  if (!input.cursor) return sql`true`;
  const rankPredicate =
    eventKindRank < input.cursor.eventKindRank
      ? sql`true`
      : eventKindRank > input.cursor.eventKindRank
        ? sql`false`
        : buildStableTiePredicate(input, stableKey);
  return sql`(
    ${eventAt} < ${input.cursor.eventAt}
    OR (${eventAt} = ${input.cursor.eventAt} AND ${rankPredicate})
  )`;
}

/** 把用户状态筛选映射为图片原始枚举谓词，以命中 status 复合索引。 */
function buildImageStatusPredicate(
  status: UsageLogListQuery["status"],
  column: SQL
): SQL {
  if (status === null) return sql`true`;
  if (status === "processing") return sql`${column} = 'pending'`;
  if (status === "succeeded") return sql`${column} = 'completed'`;
  if (status === "failed") return sql`${column} = 'failed'`;
  return sql`false`;
}

/** 把用户状态筛选映射为视频原始状态谓词。 */
function buildVideoStatusPredicate(
  status: UsageLogListQuery["status"],
  column: SQL
): SQL {
  if (status === null) return sql`true`;
  if (status === "processing") return sql`${column} in ('pending', 'running')`;
  if (status === "succeeded") return sql`${column} = 'completed'`;
  if (status === "failed") return sql`${column} = 'failed'`;
  if (status === "unknown") {
    return sql`${column} not in ('pending', 'running', 'completed', 'failed')`;
  }
  return sql`false`;
}

/** 批次投影只作索引入口，来源裁决仍读取同 operation 的消费账本 metadata。 */
function buildOperationApiEvidencePredicate(
  userId: string,
  operationType: SQL,
  operationId: SQL
): SQL {
  return sql`exists (
    select 1
    from credit_usage_projection_entry p
    join credits_transaction c on c.id = p.transaction_id
      and c.user_id = p.user_id
      and c.type = 'consumption'
    where p.user_id = ${userId}
      and p.operation_type = ${operationType}
      and p.operation_id = ${operationId}
      and p.contribution_kind = 'consumption'
      and nullif(c.metadata->>'externalApiKeyId', '') is not null
  )`;
}

/**
 * 构造四分支单次主查询。
 *
 * WHY：每个 CTE 都先应用本人、时间、隐私、筛选、cursor 和 limit+1，再归并；
 * relay 行不会影响页长或 nextCursor，也不会出现无界历史排序。
 */
export function buildUsageLogListSql(input: UsageLogListQuery): SQL {
  const generationStableId = sql`json_build_array('generation', g.id)::text`;
  const videoStableId = sql`json_build_array('video', v.id)::text`;
  const operationStableId = sql`json_build_array('operation', u.operation_type, u.operation_id)::text`;
  const refundStableId = sql`json_build_array('refund', t.id)::text`;
  const imageGenerationMode = sql`coalesce(nullif(lower(btrim(g.metadata->>'mode')), ''), 'generate')`;
  const imageStatus = sql`case
    when g.status = 'pending' then 'processing'
    when g.status = 'completed' then 'succeeded'
    when g.status = 'failed' then 'failed'
    else 'unknown'
  end`;
  const videoStatus = sql`case
    when v.status in ('pending', 'running') then 'processing'
    when v.status = 'completed' then 'succeeded'
    when v.status = 'failed' then 'failed'
    else 'unknown'
  end`;
  const historicalAllowlist = sql.join(
    HISTORICAL_OPERATION_TYPES.map((value) => sql`${value}`),
    sql`, `
  );
  return sql`
    with image_rows as (
      select
        'request'::text as event_kind,
        'image'::text as business_type,
        null::text as related_business_type,
        case when nullif(g.metadata->>'externalApiKeyId', '') is not null then 'api'
          when g.usage_log_visible is true then 'web'
          else 'unknown' end::text as source_channel,
        'image_generation'::text as operation_type,
        g.id::text as operation_id,
        'request'::text as fact_kind,
        ${imageGenerationMode}::text as generation_mode,
        g.created_at as event_at,
        3::integer as event_kind_rank,
        ${generationStableId} as stable_id,
        ${imageStatus}::text as status,
        g.status::text as raw_status,
        coalesce(u.gross_consumed, 0)::numeric as gross_consumed,
        0::numeric as refund_amount
      from generation g
      left join credit_usage_operation u
        on u.user_id = g.user_id
        and u.operation_type = 'image_generation'
        and u.operation_id = g.id
      where g.user_id = ${input.userId}
        and g.created_at >= ${input.start}
        and g.created_at < ${input.end}
        and g.created_at <= ${input.asOf}
        and ${imageGenerationMode} in ('generate', 'edit')
        and ${booleanSql(
          input.businessType === null || input.businessType === "image"
        )}
        and ${buildImageStatusPredicate(input.status, sql`g.status`)}
        and ${buildBranchKeysetPredicate(input, sql`g.created_at`, 3, {
          kind: "generation",
          first: sql`g.id`,
        })}
      order by g.created_at desc, g.id desc
      limit ${input.branchLimit}
    ), retired_image_rows as (
      select
        'request'::text as event_kind,
        'historical'::text as business_type,
        null::text as related_business_type,
        case when nullif(g.metadata->>'externalApiKeyId', '') is not null then 'api'
          when g.usage_log_visible is true then 'web'
          else 'unknown' end::text as source_channel,
        'image_generation'::text as operation_type,
        g.id::text as operation_id,
        'request'::text as fact_kind,
        ${imageGenerationMode}::text as generation_mode,
        g.created_at as event_at,
        1::integer as event_kind_rank,
        ${generationStableId} as stable_id,
        ${imageStatus}::text as status,
        g.status::text as raw_status,
        u.gross_consumed::numeric as gross_consumed,
        0::numeric as refund_amount
      from generation g
      join credit_usage_operation u
        on u.user_id = g.user_id
        and u.operation_type = 'image_generation'
        and u.operation_id = g.id
        and u.gross_consumed > 0
      where g.user_id = ${input.userId}
        and g.created_at >= ${input.start}
        and g.created_at < ${input.end}
        and g.created_at <= ${input.asOf}
        and ${imageGenerationMode} not in ('generate', 'edit')
        and ${booleanSql(
          input.businessType === null || input.businessType === "historical"
        )}
        and ${buildImageStatusPredicate(input.status, sql`g.status`)}
        and ${buildBranchKeysetPredicate(input, sql`g.created_at`, 1, {
          kind: "generation",
          first: sql`g.id`,
        })}
      order by g.created_at desc, g.id desc
      limit ${input.branchLimit}
    ), video_rows as (
      select
        'request'::text as event_kind,
        'video'::text as business_type,
        null::text as related_business_type,
        case when v.api_key_id is null then 'web' else 'api' end::text as source_channel,
        'video_generation'::text as operation_type,
        v.id::text as operation_id,
        'request'::text as fact_kind,
        null::text as generation_mode,
        v.created_at as event_at,
        2::integer as event_kind_rank,
        ${videoStableId} as stable_id,
        ${videoStatus}::text as status,
        v.status::text as raw_status,
        coalesce(u.gross_consumed, 0)::numeric as gross_consumed,
        0::numeric as refund_amount
      from video_generation v
      left join credit_usage_operation u
        on u.user_id = v.user_id
        and u.operation_type = 'video_generation'
        and u.operation_id = v.id
      where v.user_id = ${input.userId}
        and v.created_at >= ${input.start}
        and v.created_at < ${input.end}
        and v.created_at <= ${input.asOf}
        and (v.usage_log_visible is true or v.api_key_id is null)
        and ${booleanSql(
          input.businessType === null || input.businessType === "video"
        )}
        and ${buildVideoStatusPredicate(input.status, sql`v.status`)}
        and ${buildBranchKeysetPredicate(input, sql`v.created_at`, 2, {
          kind: "video",
          first: sql`v.id`,
        })}
      order by v.created_at desc, v.id desc
      limit ${input.branchLimit}
    ), historical_rows as (
      select
        'request'::text as event_kind,
        'historical'::text as business_type,
        null::text as related_business_type,
        'web'::text as source_channel,
        u.operation_type::text as operation_type,
        u.operation_id::text as operation_id,
        'financial'::text as fact_kind,
        null::text as generation_mode,
        u.operation_created_at as event_at,
        1::integer as event_kind_rank,
        ${operationStableId} as stable_id,
        'unknown'::text as status,
        null::text as raw_status,
        u.gross_consumed::numeric as gross_consumed,
        0::numeric as refund_amount
      from credit_usage_operation u
      where u.user_id = ${input.userId}
        and u.operation_type in (${historicalAllowlist})
        and u.gross_consumed > 0
        and u.operation_created_at >= ${input.start}
        and u.operation_created_at < ${input.end}
        and u.operation_created_at <= ${input.asOf}
        and ${booleanSql(
          input.businessType === null || input.businessType === "historical"
        )}
        and ${booleanSql(input.status === null || input.status === "unknown")}
        and ${buildBranchKeysetPredicate(
          input,
          sql`u.operation_created_at`,
          1,
          {
            kind: "operation",
            first: sql`u.operation_type`,
            second: sql`u.operation_id`,
          }
        )}
      order by u.operation_created_at desc, u.operation_type desc, u.operation_id desc
      limit ${input.branchLimit}
    ), refund_rows as (
      select
        'refund'::text as event_kind,
        'refund'::text as business_type,
        case
          when g.id is not null
            and coalesce(nullif(lower(btrim(g.metadata->>'mode')), ''), 'generate') in ('generate', 'edit')
            then 'image'
          when v.id is not null then 'video'
          else 'historical'
        end::text as related_business_type,
        case
          when v.api_key_id is not null or nullif(g.metadata->>'externalApiKeyId', '') is not null then 'api'
          when v.id is not null or g.usage_log_visible is true
            or t.operation_type in (${historicalAllowlist}) then 'web'
          else 'unknown'
        end::text as source_channel,
        t.operation_type::text as operation_type,
        t.operation_id::text as operation_id,
        'refund'::text as fact_kind,
        null::text as generation_mode,
        t.created_at as event_at,
        0::integer as event_kind_rank,
        ${refundStableId} as stable_id,
        'refund'::text as status,
        null::text as raw_status,
        0::numeric as gross_consumed,
        t.amount::numeric as refund_amount
      from credits_transaction t
      left join generation g
        on t.operation_type = 'image_generation'
        and g.user_id = t.user_id
        and g.id = t.operation_id
      left join video_generation v
        on t.operation_type = 'video_generation'
        and v.user_id = t.user_id
        and v.id = t.operation_id
        and (v.usage_log_visible is true or v.api_key_id is null)
      where t.user_id = ${input.userId}
        and t.type = 'refund'
        and t.created_at >= ${input.start}
        and t.created_at < ${input.end}
        and t.created_at <= ${input.asOf}
        and (g.id is not null or v.id is not null or t.operation_type in (${historicalAllowlist}))
        and ${booleanSql(
          input.businessType === null || input.businessType === "refund"
        )}
        and ${booleanSql(input.status === null || input.status === "refund")}
        and ${buildBranchKeysetPredicate(input, sql`t.created_at`, 0, {
          kind: "refund",
          first: sql`t.id`,
        })}
      order by t.created_at desc, t.id desc
      limit ${input.branchLimit}
    ), merged_events as (
      select * from image_rows
      union all select * from retired_image_rows
      union all select * from video_rows
      union all select * from historical_rows
      union all select * from refund_rows
    ), limited_events as (
      select *
      from merged_events
      order by event_at desc, event_kind_rank desc, stable_id desc
      limit ${input.branchLimit}
    ), candidate_operation_keys as (
      select distinct operation_type, operation_id
      from limited_events
    ), api_evidence as (
      select distinct p.operation_type, p.operation_id
      from candidate_operation_keys k
      join credit_usage_projection_entry p
        on p.user_id = ${input.userId}
        and p.operation_type = k.operation_type
        and p.operation_id = k.operation_id
        and p.contribution_kind = 'consumption'
      join credits_transaction c
        on c.id = p.transaction_id
        and c.user_id = p.user_id
        and c.type = 'consumption'
      where nullif(c.metadata->>'externalApiKeyId', '') is not null
    )
    select
      e.event_kind,
      e.business_type,
      e.related_business_type,
      e.operation_type,
      e.fact_kind,
      e.generation_mode,
      case when a.operation_id is not null then 'api'
        else e.source_channel end::text as source_channel,
      e.event_at,
      e.event_kind_rank,
      e.stable_id,
      e.status,
      e.raw_status,
      e.gross_consumed,
      e.refund_amount
    from limited_events e
    left join api_evidence a
      on a.operation_type = e.operation_type
      and a.operation_id = e.operation_id
    order by e.event_at desc, e.event_kind_rank desc, e.stable_id desc
  `;
}

/** 数据库 usage-log 仓储实现。 */
export const databaseUsageLogRepository: UsageLogRepository = {
  async readCreditUsageState() {
    const [row] = await db
      .select({
        version: analyticsReadModelState.version,
        status: analyticsReadModelState.status,
      })
      .from(analyticsReadModelState)
      .where(eq(analyticsReadModelState.readModel, "credit_usage"))
      .limit(1);
    return row ?? null;
  },

  async readListRows(query) {
    const result = await db.execute(buildUsageLogListSql(query));
    return z
      .array(listRowSchema)
      .parse(extractRows(result))
      .map((row) => ({
        eventKind: row.event_kind,
        businessType: row.business_type,
        relatedBusinessType: row.related_business_type ?? null,
        operationType: row.operation_type,
        factKind: row.fact_kind,
        generationMode: row.generation_mode,
        sourceChannel: row.source_channel,
        eventAt: row.event_at,
        eventKindRank: row.event_kind_rank,
        stableId: row.stable_id,
        status: row.status,
        rawStatus: row.raw_status,
        grossConsumed: row.gross_consumed,
        refundAmount: row.refund_amount,
      }));
  },

  async readRequestDetail(input) {
    const stableId = parseUsageLogStableId(input.stableId);
    if (!stableId || stableId[0] === "refund") return null;
    let query: SQL;
    if (stableId[0] === "generation") {
      if (
        input.businessType !== "image" &&
        input.businessType !== "historical"
      ) {
        return null;
      }
      const expectedMode = input.businessType === "image";
      query = sql`
        select
          ${input.businessType}::text as business_type,
          g.id as request_id,
          case when nullif(g.metadata->>'externalApiKeyId', '') is not null
              or ${buildOperationApiEvidencePredicate(
                input.userId,
                sql`'image_generation'`,
                sql`g.id`
              )} then 'api'
            when g.usage_log_visible is true then 'web'
            else 'unknown' end::text as source_channel,
          case when g.status = 'pending' then 'processing' when g.status = 'completed' then 'succeeded'
            when g.status = 'failed' then 'failed' else 'unknown' end::text as status,
          g.status::text as raw_status,
          ${input.businessType === "image" ? sql`g.model` : sql`null`}::text as model_or_endpoint,
          ${input.businessType === "image" ? sql`o.image_count` : sql`null`}::numeric as actual_usage_value,
          coalesce(u.gross_consumed, 0)::numeric as gross_consumed,
          coalesce(u.refunded, 0)::numeric as refunded,
          g.created_at,
          g.completed_at,
          ${input.businessType === "image" ? sql`g.error` : sql`null`}::text as raw_error,
          false as has_resource
        from generation g
        left join credit_usage_operation u on u.user_id = g.user_id
          and u.operation_type = 'image_generation' and u.operation_id = g.id
        left join user_output_usage_event o on o.user_id = g.user_id
          and o.output_kind = 'image' and o.source_task_id = g.id
        where g.user_id = ${input.userId} and g.id = ${stableId[1]}
          and (${expectedMode} = (
            coalesce(nullif(lower(btrim(g.metadata->>'mode')), ''), 'generate') in ('generate', 'edit')
          ))
          and (${expectedMode} or coalesce(u.gross_consumed, 0) > 0)
        limit 1
      `;
    } else if (stableId[0] === "video") {
      if (input.businessType !== "video") return null;
      query = sql`
        select
          'video'::text as business_type,
          v.id as request_id,
          case when v.api_key_id is null then 'web' else 'api' end::text as source_channel,
          case when v.status in ('pending', 'running') then 'processing' when v.status = 'completed' then 'succeeded'
            when v.status = 'failed' then 'failed' else 'unknown' end::text as status,
          v.status::text as raw_status,
          v.model as model_or_endpoint,
          o.video_seconds::numeric as actual_usage_value,
          coalesce(u.gross_consumed, 0)::numeric as gross_consumed,
          coalesce(u.refunded, 0)::numeric as refunded,
          v.created_at,
          v.completed_at,
          v.error as raw_error,
          false as has_resource
        from video_generation v
        left join credit_usage_operation u on u.user_id = v.user_id
          and u.operation_type = 'video_generation' and u.operation_id = v.id
        left join user_output_usage_event o on o.user_id = v.user_id
          and o.output_kind = 'video' and o.source_task_id = v.id
        where v.user_id = ${input.userId} and v.id = ${stableId[1]}
          and (v.usage_log_visible is true or v.api_key_id is null)
        limit 1
      `;
    } else {
      if (
        input.businessType !== "historical" ||
        !HISTORICAL_OPERATION_TYPES.includes(
          stableId[1] as (typeof HISTORICAL_OPERATION_TYPES)[number]
        )
      ) {
        return null;
      }
      query = sql`
        select
          'historical'::text as business_type,
          u.operation_id as request_id,
          'web'::text as source_channel,
          'unknown'::text as status,
          null::text as raw_status,
          null::text as model_or_endpoint,
          null::numeric as actual_usage_value,
          u.gross_consumed::numeric as gross_consumed,
          u.refunded::numeric as refunded,
          u.operation_created_at as created_at,
          null::timestamptz as completed_at,
          null::text as raw_error,
          false as has_resource
        from credit_usage_operation u
        where u.user_id = ${input.userId} and u.operation_type = ${stableId[1]}
          and u.operation_id = ${stableId[2]} and u.gross_consumed > 0
        limit 1
      `;
    }
    const rows = extractRows(await db.execute(query));
    const row = rows[0] ? requestDetailRowSchema.parse(rows[0]) : null;
    return row
      ? {
          businessType: row.business_type,
          requestId: row.request_id,
          sourceChannel: row.source_channel,
          status: row.status,
          rawStatus: row.raw_status,
          modelOrEndpoint: row.model_or_endpoint,
          actualUsageValue: row.actual_usage_value,
          grossConsumed: row.gross_consumed,
          refunded: row.refunded,
          createdAt: row.created_at,
          completedAt: row.completed_at,
          rawError: row.raw_error,
          hasResource: row.has_resource,
        }
      : null;
  },

  async readRefundDetail(input) {
    const stableId = parseUsageLogStableId(input.stableId);
    if (stableId?.[0] !== "refund") return null;
    const historicalAllowlist = sql.join(
      HISTORICAL_OPERATION_TYPES.map((value) => sql`${value}`),
      sql`, `
    );
    const result = await db.execute(sql`
      select
        t.id as refund_id,
        case
          when g.id is not null then json_build_array('generation', g.id)::text
          when v.id is not null then json_build_array('video', v.id)::text
          when t.operation_type in (${historicalAllowlist}) and u.operation_id is not null
            then json_build_array('operation', t.operation_type, t.operation_id)::text
          else null
        end as original_stable_id,
        case
          when g.id is not null
            and coalesce(nullif(lower(btrim(g.metadata->>'mode')), ''), 'generate') in ('generate', 'edit')
            then 'image'
          when g.id is not null then 'historical'
          when v.id is not null then 'video'
          when t.operation_type in (${historicalAllowlist}) and u.operation_id is not null
            then 'historical'
          else null
        end::text as original_business_type,
        case
          when g.id is not null
            and coalesce(nullif(lower(btrim(g.metadata->>'mode')), ''), 'generate') in ('generate', 'edit')
            then 'Image generation'
          when g.id is not null then 'Historical usage'
          when v.id is not null then 'Video generation'
          else 'Unlinked historical record' end::text as original_request_label,
        case when v.api_key_id is not null
            or nullif(g.metadata->>'externalApiKeyId', '') is not null
            or ${buildOperationApiEvidencePredicate(
              input.userId,
              sql`t.operation_type`,
              sql`t.operation_id`
            )} then 'api'
          when v.id is not null or g.usage_log_visible is true
            or t.operation_type in (${historicalAllowlist}) then 'web'
          else 'unknown' end::text as source_channel,
        t.amount::numeric as refunded,
        t.created_at,
        null::text as resource_kind,
        null::text as resource_id
      from credits_transaction t
      left join generation g on t.operation_type = 'image_generation'
        and g.user_id = t.user_id and g.id = t.operation_id
      left join video_generation v on t.operation_type = 'video_generation'
        and v.user_id = t.user_id and v.id = t.operation_id
        and (v.usage_log_visible is true or v.api_key_id is null)
      left join credit_usage_operation u on u.user_id = t.user_id
        and u.operation_type = t.operation_type and u.operation_id = t.operation_id
      where t.user_id = ${input.userId} and t.type = 'refund' and t.id = ${stableId[1]}
        and (g.id is not null or v.id is not null or t.operation_type in (${historicalAllowlist}))
      limit 1
    `);
    const rows = extractRows(result);
    const row = rows[0] ? refundDetailRowSchema.parse(rows[0]) : null;
    return row
      ? {
          refundId: row.refund_id,
          originalStableId: row.original_stable_id,
          originalBusinessType: row.original_business_type,
          originalRequestLabel: row.original_request_label,
          sourceChannel: row.source_channel,
          refunded: row.refunded,
          createdAt: row.created_at,
          resourceKind: row.resource_kind,
          resourceId: row.resource_id,
        }
      : null;
  },
};
