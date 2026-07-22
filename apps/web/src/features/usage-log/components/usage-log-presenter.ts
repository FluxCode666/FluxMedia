/**
 * 使用日志详情的纯展示适配器。
 *
 * 使用方：展开详情行。它把 request/refund 联合类型映射为不同字段集，避免退款
 * 出现模型、实际用量或净消耗等不适用占位，并且只解释服务端安全失败码。
 */

import { formatCredits } from "@repo/shared/credits/format";
import type { UsageEventDetail } from "@repo/shared/credits/usage-log-contract";

import type { UsageLogCopy } from "./usage-log-copy";

/** 展开详情中的单个标签和值。 */
export type UsageLogDetailItem = {
  label: string;
  value: string;
};

/**
 * 在用户时区格式化契约时间。
 *
 * @param value ISO 8601 时间。
 * @param locale 当前语言。
 * @param timeZone 用户的应用时区。
 * @param fallback 非法时间的安全占位文案。
 * @returns 本地化时间；不抛出格式化异常。
 * @sideEffects 无。
 */
export function formatUsageLogTime(
  value: string,
  locale: string,
  timeZone: string,
  fallback: string
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone,
    }).format(date);
  } catch {
    return fallback;
  }
}

/**
 * 把结构化实际用量转成带单位文本。
 *
 * @param detail 已收窄为 request 的详情。
 * @param copy 页面文案。
 * @returns 无实际用量时返回 null。
 * @sideEffects 无。
 */
function formatActualUsage(
  detail: Extract<UsageEventDetail, { kind: "request" }>,
  copy: UsageLogCopy
): string | null {
  if (!detail.actualUsage) return null;
  const unit =
    detail.actualUsage.unit === "images"
      ? copy.detail.images
      : copy.detail.seconds;
  return `${detail.actualUsage.value} ${unit}`;
}

/**
 * 构造请求或退款详情的可见字段。
 *
 * @param detail UOL 返回的安全详情联合。
 * @param context 文案、语言和应用时区。
 * @returns 仅包含当前详情类型适用字段的标签值列表，包括用户核对所需的请求 ID。
 * @sideEffects 无；不会返回签名 eventRef 或底层原始错误。
 */
export function buildUsageLogDetailItems(
  detail: UsageEventDetail,
  context: { copy: UsageLogCopy; locale: string; timeZone: string }
): UsageLogDetailItem[] {
  const { copy, locale, timeZone } = context;
  if (detail.kind === "refund") {
    return [
      {
        label: copy.detail.fields.refundId,
        value: detail.refundId,
      },
      {
        label: copy.detail.fields.originalRequest,
        value: detail.originalRequestLabel,
      },
      {
        label: copy.detail.fields.source,
        value: copy.sourceChannels[detail.sourceChannel],
      },
      {
        label: copy.detail.fields.refunded,
        value: `+${formatCredits(detail.refunded)}`,
      },
      {
        label: copy.detail.createdAt,
        value: formatUsageLogTime(
          detail.createdAt,
          locale,
          timeZone,
          copy.unknownTime
        ),
      },
    ];
  }

  const actualUsage = formatActualUsage(detail, copy);
  const items: UsageLogDetailItem[] = [
    {
      label: copy.detail.fields.requestId,
      value: detail.requestId,
    },
    {
      label: copy.detail.fields.status,
      value: copy.statuses[detail.status],
    },
    {
      label: copy.detail.fields.source,
      value: copy.sourceChannels[detail.sourceChannel],
    },
  ];
  if (detail.modelOrEndpoint) {
    items.push({
      label: copy.detail.fields.modelOrEndpoint,
      value: detail.modelOrEndpoint,
    });
  }
  if (actualUsage) {
    items.push({ label: copy.detail.actualUsage, value: actualUsage });
  }
  items.push(
    {
      label: copy.detail.fields.grossConsumed,
      value: formatCredits(detail.grossConsumed),
    },
    {
      label: copy.detail.fields.refunded,
      value: formatCredits(detail.refunded),
    },
    {
      label: copy.detail.fields.netConsumed,
      value: formatCredits(detail.netConsumed),
    },
    {
      label: copy.detail.createdAt,
      value: formatUsageLogTime(
        detail.createdAt,
        locale,
        timeZone,
        copy.unknownTime
      ),
    }
  );
  if (detail.completedAt) {
    items.push({
      label: copy.detail.completedAt,
      value: formatUsageLogTime(
        detail.completedAt,
        locale,
        timeZone,
        copy.unknownTime
      ),
    });
  }
  if (detail.status === "failed" && detail.failureCode) {
    items.push({
      label: copy.detail.failure,
      value: copy.failureCodes[detail.failureCode],
    });
  }
  return items;
}
