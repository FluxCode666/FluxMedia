/**
 * 使用日志页面 URL 状态解析与构造器。
 *
 * 使用方：服务端页面和客户端筛选/分页组件。它只接受公开的筛选枚举，cursor
 * 保持不透明；非法或数组查询值回退到首页默认值，不能进入 Action。
 */

import {
  type UsageBusinessType,
  type UsageLogRange,
  type UsageStatus,
  usageBusinessTypeSchema,
  usageStatusSchema,
} from "@repo/shared/credits/usage-log-contract";

const PUBLIC_TO_CONTRACT_RANGE = {
  "7": "7d",
  "30": "30d",
  "90": "90d",
} as const satisfies Record<string, UsageLogRange>;

/** Next.js 页面可接收的查询参数形状。 */
export type UsageLogSearchParams = Record<
  string,
  string | string[] | undefined
>;

/** 页面使用的规范化筛选和 cursor。 */
export type UsageLogQueryState = {
  businessType: UsageBusinessType | null;
  cursor: string | null;
  range: UsageLogRange;
  status: UsageStatus | null;
};

/** 仅接受单个、非空且有界的字符串查询值。 */
function getScalarQueryValue(
  value: string | string[] | undefined,
  maxLength = 240
): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length <= maxLength ? value : null;
}

/**
 * 将公开 URL 参数收窄为 UOL 列表输入。
 *
 * @param searchParams Next.js 原始查询参数。
 * @returns 默认最近 7 天的规范化状态；非法筛选和 cursor 均被忽略。
 * @sideEffects 无。
 */
export function parseUsageLogSearchParams(
  searchParams: UsageLogSearchParams
): UsageLogQueryState {
  const publicRange = getScalarQueryValue(searchParams.range);
  const businessType = getScalarQueryValue(searchParams.businessType);
  const status = getScalarQueryValue(searchParams.status);
  const cursor = getScalarQueryValue(searchParams.cursor, 4096);
  const parsedBusinessType = usageBusinessTypeSchema.safeParse(businessType);
  const parsedStatus = usageStatusSchema.safeParse(status);

  return {
    businessType: parsedBusinessType.success ? parsedBusinessType.data : null,
    cursor,
    range:
      PUBLIC_TO_CONTRACT_RANGE[
        publicRange as keyof typeof PUBLIC_TO_CONTRACT_RANGE
      ] ?? "7d",
    status: parsedStatus.success ? parsedStatus.data : null,
  };
}

/**
 * 构造交给 next-intl 导航层的同源使用日志 URL。
 *
 * @param state 要持久化的筛选与可选 cursor；筛选变化方传入 null cursor。
 * @returns 不带 locale 前缀、只包含公开白名单参数的相对 URL。
 * @sideEffects 无。
 */
export function buildUsageLogHref(state: UsageLogQueryState): string {
  const searchParams = new URLSearchParams();
  searchParams.set("range", state.range.slice(0, -1));
  if (state.businessType) {
    searchParams.set("businessType", state.businessType);
  }
  if (state.status) searchParams.set("status", state.status);
  if (state.cursor) searchParams.set("cursor", state.cursor);
  return `/dashboard/usage-log?${searchParams.toString()}`;
}
