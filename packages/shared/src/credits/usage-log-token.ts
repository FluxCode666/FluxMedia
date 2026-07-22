/**
 * 使用日志 cursor 与 eventRef 的版本化 HMAC 令牌。
 *
 * 使用方：使用日志读服务。令牌分别绑定域、主体、筛选、快照和排序键；解析
 * 失败只返回统一安全错误，令牌及业务标识不得进入错误消息或日志。
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  type UsageBusinessType,
  type UsageLogCursorFilters,
  usageBusinessTypeSchema,
  usageLogCursorFiltersSchema,
} from "./usage-log-contract";

const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 4096;
const CURSOR_DOMAIN = "fluxmedia:usage-log:cursor:v1";
const EVENT_REF_DOMAIN = "fluxmedia:usage-log:event-ref:v1";
const FILTER_DOMAIN = "fluxmedia:usage-log:filters:v1";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const isoDateTimeSchema = z.string().datetime({ offset: true });
const cursorSortKeySchema = z
  .object({
    eventAt: isoDateTimeSchema,
    eventKindRank: z.number().int().min(0).max(3),
    stableId: z.string().trim().min(1).max(512),
  })
  .strict();

const cursorPayloadSchema = z
  .object({
    v: z.literal(TOKEN_VERSION),
    sub: z.string().trim().min(1).max(512),
    filter: z.string().length(43),
    asOf: isoDateTimeSchema,
    sortKey: cursorSortKeySchema,
  })
  .strict();

const eventRefPayloadSchema = z
  .object({
    v: z.literal(TOKEN_VERSION),
    sub: z.string().trim().min(1).max(512),
    eventKind: z.enum(["request", "refund"]),
    businessType: usageBusinessTypeSchema,
    stableId: z.string().trim().min(1).max(512),
  })
  .strict()
  .refine(
    (value) =>
      (value.eventKind === "refund") === (value.businessType === "refund")
  );

export interface UsageLogCursorSortKey {
  eventAt: string;
  eventKindRank: number;
  stableId: string;
}

export interface EncodeUsageLogCursorInput {
  userId: string;
  filters: UsageLogCursorFilters;
  asOf: string;
  sortKey: UsageLogCursorSortKey;
}

export interface DecodeUsageLogCursorExpected {
  userId: string;
  filters: UsageLogCursorFilters;
  asOfNotAfter?: string;
}

export interface EncodeUsageEventRefInput {
  userId: string;
  eventKind: "request" | "refund";
  businessType: UsageBusinessType;
  stableId: string;
}

/** 令牌验证统一错误；不携带原 token、业务 ID 或具体失败阶段。 */
export class UsageLogTokenError extends Error {
  readonly code = "validation_error" as const;

  /** 创建固定消息的安全错误。 */
  constructor() {
    super("Invalid usage log token");
    this.name = "UsageLogTokenError";
  }
}

/** 读取显式 secret 或 BETTER_AUTH_SECRET；空值属于服务端配置错误。 */
function resolveSecret(secret: string | undefined): string {
  const resolved = secret ?? process.env.BETTER_AUTH_SECRET;
  if (!resolved?.trim()) {
    throw new Error("BETTER_AUTH_SECRET is required for usage log tokens");
  }
  return resolved;
}

/** 对规范化筛选生成固定长度指纹，避免把筛选 JSON 塞入 cursor。 */
function fingerprintFilters(
  filters: UsageLogCursorFilters,
  secret: string
): string {
  const normalized = usageLogCursorFiltersSchema.parse(filters);
  const canonical = JSON.stringify({
    range: normalized.range,
    businessType: normalized.businessType,
    status: normalized.status,
  });
  return createHmac("sha256", secret)
    .update(FILTER_DOMAIN)
    .update("\0")
    .update(canonical)
    .digest("base64url");
}

/** 使用域标签签名 payload，防止 cursor 与 eventRef 相互替换。 */
function signPayload(payload: string, domain: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(domain)
    .update("\0")
    .update(payload)
    .digest();
}

/** 编码已通过 schema 校验的 payload。 */
function encodeToken(payload: unknown, domain: string, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = signPayload(encodedPayload, domain, secret).toString(
    "base64url"
  );
  return `${encodedPayload}.${signature}`;
}

/** 先做长度、格式和常量时间签名校验，再解析 JSON。 */
function decodeToken(token: string, domain: string, secret: string): unknown {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw new UsageLogTokenError();
  }
  const parts = token.split(".");
  if (parts.length !== 2) throw new UsageLogTokenError();
  const [payload, signature] = parts;
  if (
    !payload ||
    !signature ||
    !BASE64URL_PATTERN.test(payload) ||
    !BASE64URL_PATTERN.test(signature)
  ) {
    throw new UsageLogTokenError();
  }

  let signatureBytes: Buffer;
  let payloadBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature, "base64url");
    payloadBytes = Buffer.from(payload, "base64url");
  } catch {
    throw new UsageLogTokenError();
  }
  if (
    signatureBytes.toString("base64url") !== signature ||
    payloadBytes.toString("base64url") !== payload
  ) {
    throw new UsageLogTokenError();
  }
  const expected = signPayload(payload, domain, secret);
  if (
    signatureBytes.length !== expected.length ||
    !timingSafeEqual(signatureBytes, expected)
  ) {
    throw new UsageLogTokenError();
  }
  try {
    return JSON.parse(payloadBytes.toString("utf8")) as unknown;
  } catch {
    throw new UsageLogTokenError();
  }
}

/** 常量时间比较两个已规范化的固定长度筛选指纹。 */
function fingerprintsEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

/**
 * 创建主体、筛选、快照和完整排序键绑定的列表 cursor。
 *
 * @param input 当前分页会话与最后一行排序键。
 * @param secret 测试可显式注入；生产默认复用 BETTER_AUTH_SECRET。
 * @returns 版本化 base64url HMAC token。
 */
export function encodeUsageLogCursor(
  input: EncodeUsageLogCursorInput,
  secret?: string
): string {
  const resolvedSecret = resolveSecret(secret);
  const payload = cursorPayloadSchema.parse({
    v: TOKEN_VERSION,
    sub: input.userId,
    filter: fingerprintFilters(input.filters, resolvedSecret),
    asOf: input.asOf,
    sortKey: input.sortKey,
  });
  return encodeToken(payload, CURSOR_DOMAIN, resolvedSecret);
}

/**
 * 验证并解析列表 cursor。
 *
 * @param token 不可信 cursor 字符串。
 * @param expected 当前 Principal、筛选及可选服务端快照上限。
 * @param secret 测试可显式注入；生产默认复用 BETTER_AUTH_SECRET。
 * @returns SQL keyset 所需的 asOf 与完整排序键。
 * @throws UsageLogTokenError 任一验证失败，且不区分具体原因。
 */
export function decodeUsageLogCursor(
  token: string,
  expected: DecodeUsageLogCursorExpected,
  secret?: string
): { asOf: string; sortKey: UsageLogCursorSortKey } {
  try {
    const resolvedSecret = resolveSecret(secret);
    const parsed = cursorPayloadSchema.parse(
      decodeToken(token, CURSOR_DOMAIN, resolvedSecret)
    );
    const filter = fingerprintFilters(expected.filters, resolvedSecret);
    const maxAsOf = expected.asOfNotAfter
      ? Date.parse(expected.asOfNotAfter)
      : null;
    if (
      parsed.sub !== expected.userId ||
      !fingerprintsEqual(parsed.filter, filter) ||
      (maxAsOf !== null &&
        (!Number.isFinite(maxAsOf) || Date.parse(parsed.asOf) > maxAsOf))
    ) {
      throw new UsageLogTokenError();
    }
    return { asOf: parsed.asOf, sortKey: parsed.sortKey };
  } catch (error) {
    if (error instanceof UsageLogTokenError) throw error;
    throw new UsageLogTokenError();
  }
}

/**
 * 创建主体和事件身份绑定的详情引用。
 *
 * @param input 当前用户与事件分支所需的最小稳定身份。
 * @param secret 测试可显式注入；生产默认复用 BETTER_AUTH_SECRET。
 * @returns 与 cursor 不同签名域的 eventRef。
 */
export function encodeUsageEventRef(
  input: EncodeUsageEventRefInput,
  secret?: string
): string {
  const resolvedSecret = resolveSecret(secret);
  const payload = eventRefPayloadSchema.parse({
    v: TOKEN_VERSION,
    sub: input.userId,
    eventKind: input.eventKind,
    businessType: input.businessType,
    stableId: input.stableId,
  });
  return encodeToken(payload, EVENT_REF_DOMAIN, resolvedSecret);
}

/**
 * 验证并解析详情引用；跨用户复用与资源不存在由上层统一为 not_found。
 *
 * @param token 不可信 eventRef。
 * @param expected 当前 Principal 身份。
 * @param secret 测试可显式注入；生产默认复用 BETTER_AUTH_SECRET。
 * @returns 详情查询分支和稳定 ID。
 * @throws UsageLogTokenError 签名、版本、schema 或主体不匹配。
 */
export function decodeUsageEventRef(
  token: string,
  expected: { userId: string },
  secret?: string
): {
  eventKind: "request" | "refund";
  businessType: UsageBusinessType;
  stableId: string;
} {
  try {
    const resolvedSecret = resolveSecret(secret);
    const parsed = eventRefPayloadSchema.parse(
      decodeToken(token, EVENT_REF_DOMAIN, resolvedSecret)
    );
    if (parsed.sub !== expected.userId) throw new UsageLogTokenError();
    return {
      eventKind: parsed.eventKind,
      businessType: parsed.businessType,
      stableId: parsed.stableId,
    };
  } catch (error) {
    if (error instanceof UsageLogTokenError) throw error;
    throw new UsageLogTokenError();
  }
}
