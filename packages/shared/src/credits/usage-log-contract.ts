/**
 * 钱包使用日志的共享机器契约与纯映射规则。
 *
 * 使用方：UOL 操作、服务端读模型和 Web 展示适配器。所有跨 UOL 边界的时间
 * 均为 ISO 8601 字符串；本文件不依赖数据库，保证分类和脱敏 schema 可测试。
 */

import { z } from "zod";

/** 日志自然日范围；具体时区边界由服务层解析。 */
export const usageLogRangeSchema = z.enum(["7d", "30d", "90d"]);

/** 首期稳定业务类型；API 只属于来源渠道。 */
export const usageBusinessTypeSchema = z.enum([
  "image",
  "video",
  "refund",
  "historical",
]);

/** 请求来源渠道；无法可靠识别时必须保持 unknown。 */
export const usageSourceChannelSchema = z.enum(["web", "api", "unknown"]);

/** 面向用户的稳定状态，不直接暴露底层任务状态。 */
export const usageStatusSchema = z.enum([
  "processing",
  "succeeded",
  "failed",
  "refund",
  "unknown",
]);

/** 服务端允许返回的失败码；原始第三方错误不得进入接口。 */
export const usageFailureCodeSchema = z.enum([
  "moderation_blocked",
  "provider_unavailable",
  "timeout",
  "processing_failed",
]);

/** 使用量采用带单位的联合类型，避免图片数与视频秒数混用。 */
export const usageActualUsageSchema = z.discriminatedUnion("unit", [
  z.object({
    unit: z.literal("images"),
    value: z.number().int().nonnegative(),
  }),
  z.object({ unit: z.literal("seconds"), value: z.number().nonnegative() }),
]);

/** cursor 必须绑定的规范化筛选集合。 */
export const usageLogCursorFiltersSchema = z
  .object({
    range: usageLogRangeSchema,
    businessType: usageBusinessTypeSchema.nullable().default(null),
    status: usageStatusSchema.nullable().default(null),
  })
  .strict();

/** 使用日志列表输入；身份只来自 Principal，调用方不能传 userId。 */
export const usageLogListInputSchema = z
  .object({
    range: usageLogRangeSchema.default("7d"),
    businessType: usageBusinessTypeSchema.nullable().default(null),
    status: usageStatusSchema.nullable().default(null),
    cursor: z.string().min(1).max(4096).nullable().default(null),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

/** 使用日志详情输入；eventRef 是主体绑定的签名引用。 */
export const usageLogDetailInputSchema = z
  .object({ eventRef: z.string().min(1).max(4096) })
  .strict();

const isoDateTimeSchema = z.string().datetime({ offset: true });
const summarySchema = z.string().trim().min(1).max(240);
const creditsDeltaSchema = z.number().finite();
const nonnegativeCreditsSchema = z.number().finite().nonnegative();

/** 折叠态请求行，只包含列表所需的安全摘要。 */
export const usageRequestEventSchema = z.object({
  kind: z.literal("request"),
  eventRef: z.string().min(1).max(4096),
  eventAt: isoDateTimeSchema,
  businessType: z.enum(["image", "video", "historical"]),
  sourceChannel: usageSourceChannelSchema,
  summary: summarySchema,
  status: z.enum(["processing", "succeeded", "failed", "unknown"]),
  creditsDelta: creditsDeltaSchema.refine((value) => value <= 0),
});

/** 折叠态退款行；退款必须独立成行并以正向积分表示。 */
export const usageRefundEventSchema = z.object({
  kind: z.literal("refund"),
  eventRef: z.string().min(1).max(4096),
  eventAt: isoDateTimeSchema,
  businessType: z.literal("refund"),
  sourceChannel: usageSourceChannelSchema,
  summary: summarySchema,
  status: z.literal("refund"),
  creditsDelta: creditsDeltaSchema.positive(),
});

/** 列表事件联合；kind 保证请求与退款字段互斥。 */
export const usageEventSchema = z.discriminatedUnion("kind", [
  usageRequestEventSchema,
  usageRefundEventSchema,
]);

/** 有界 keyset 列表输出，不包含昂贵总数。 */
export const usageEventListOutputSchema = z.object({
  asOf: isoDateTimeSchema,
  events: z.array(usageEventSchema).max(50),
  nextCursor: z.string().min(1).max(4096).nullable(),
});

/** 受控业务入口引用；Web 必须通过 route resolver 转成实际 URL。 */
export const usageResourceRefSchema = z
  .object({
    kind: z.enum(["image", "video"]),
    id: z.string().trim().min(1).max(512),
  })
  .nullable();

/** 展开态请求详情；只接受安全错误码和结构化用量。 */
export const usageRequestDetailSchema = z.object({
  kind: z.literal("request"),
  requestId: z.string().trim().min(1).max(512),
  businessType: z.enum(["image", "video", "historical"]),
  sourceChannel: usageSourceChannelSchema,
  status: z.enum(["processing", "succeeded", "failed", "unknown"]),
  modelOrEndpoint: z.string().trim().min(1).max(240).nullable(),
  actualUsage: usageActualUsageSchema.nullable(),
  grossConsumed: nonnegativeCreditsSchema,
  refunded: nonnegativeCreditsSchema,
  netConsumed: nonnegativeCreditsSchema,
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  failureCode: usageFailureCodeSchema.nullable().default(null),
  resourceRef: usageResourceRefSchema.default(null),
});

/** 展开态退款详情，不携带请求专属的模型、用量或净消耗占位字段。 */
export const usageRefundDetailSchema = z.object({
  kind: z.literal("refund"),
  refundId: z.string().trim().min(1).max(512),
  originalRequestRef: z.string().min(1).max(4096).nullable(),
  originalRequestLabel: summarySchema,
  sourceChannel: usageSourceChannelSchema,
  refunded: nonnegativeCreditsSchema.positive(),
  createdAt: isoDateTimeSchema,
  resourceRef: usageResourceRefSchema.default(null),
});

/** 展开详情联合；调用方必须根据 kind 收窄字段。 */
export const usageEventDetailSchema = z.discriminatedUnion("kind", [
  usageRequestDetailSchema,
  usageRefundDetailSchema,
]);

export type UsageLogRange = z.infer<typeof usageLogRangeSchema>;
export type UsageBusinessType = z.infer<typeof usageBusinessTypeSchema>;
export type UsageSourceChannel = z.infer<typeof usageSourceChannelSchema>;
export type UsageStatus = z.infer<typeof usageStatusSchema>;
export type UsageFailureCode = z.infer<typeof usageFailureCodeSchema>;
export type UsageLogCursorFilters = z.infer<typeof usageLogCursorFiltersSchema>;
export type UsageEvent = z.infer<typeof usageEventSchema>;
export type UsageEventDetail = z.infer<typeof usageEventDetailSchema>;

export type UsageFactKind = "request" | "refund" | "financial";

/** 分类器输入；hasFinancialFact 阻止零扣费待退役链路形成 historical 行。 */
export interface ClassifyUsageBusinessTypeInput {
  operationType: string;
  factKind: UsageFactKind;
  hasFinancialFact: boolean;
}

/**
 * 把权威任务或账本事实映射为唯一业务类型。
 *
 * @param input 业务 operation、事实来源和财务事实存在性。
 * @returns 首期业务类型；不应形成日志行时返回 null。
 * @sideEffects 无。
 */
export function classifyUsageBusinessType(
  input: ClassifyUsageBusinessTypeInput
): UsageBusinessType | null {
  if (input.factKind === "refund") return "refund";
  const operationType = input.operationType.trim().toLowerCase();
  if (operationType === "image_generation") return "image";
  if (operationType === "video_generation") return "video";
  if (input.factKind === "financial" && input.hasFinancialFact) {
    return "historical";
  }
  return null;
}

/** 状态映射输入；退款业务类型始终覆盖底层状态。 */
export interface MapUsageStatusInput {
  businessType: UsageBusinessType;
  status: string | null | undefined;
}

/**
 * 把图片、视频或历史状态归一为稳定机器值。
 *
 * @param input 已分类业务类型和底层状态。
 * @returns 稳定展示状态；未知值 fail closed 为 unknown。
 * @sideEffects 无。
 */
export function mapUsageStatus(input: MapUsageStatusInput): UsageStatus {
  if (input.businessType === "refund") return "refund";
  const status = input.status?.trim().toLowerCase();
  if (["pending", "running", "processing"].includes(status ?? "")) {
    return "processing";
  }
  if (["completed", "succeeded", "success"].includes(status ?? "")) {
    return "succeeded";
  }
  if (["failed", "error"].includes(status ?? "")) return "failed";
  return "unknown";
}

/**
 * 将原始失败文本收窄为可本地化的安全错误码。
 *
 * @param rawError 只允许在服务端短暂传入的原始错误。
 * @returns 不含原文的稳定失败码；无法识别时返回 processing_failed。
 * @sideEffects 无；调用方不得记录或返回 rawError。
 */
export function mapUsageFailureCode(
  rawError: string | null | undefined
): UsageFailureCode {
  const normalized = rawError?.toLowerCase() ?? "";
  if (/moderation|safety|content policy/.test(normalized)) {
    return "moderation_blocked";
  }
  if (/timeout|timed out|deadline/.test(normalized)) return "timeout";
  if (/unavailable|overload|rate.?limit/.test(normalized)) {
    return "provider_unavailable";
  }
  return "processing_failed";
}
