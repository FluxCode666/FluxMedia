"use client";

/**
 * 使用日志单行按需详情。
 *
 * 使用方：混合日志表。组件只在用户展开时调用详情 Action，缓存当前页面会话结果；
 * 请求失败仅替换当前详情区域并提供重试，不清空列表或输出服务端错误原文。
 */

import { formatCredits } from "@repo/shared/credits/format";
import type {
  UsageEvent,
  UsageEventDetail,
  UsageStatus,
} from "@repo/shared/credits/usage-log-contract";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

import { getMyUsageEventDetailAction } from "../actions";
import type { UsageLogCopy } from "./usage-log-copy";
import {
  buildUsageLogDetailItems,
  formatUsageLogTime,
} from "./usage-log-presenter";

type DetailLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { detail: UsageEventDetail; kind: "ready" }
  | { kind: "error" };

type UsageLogDetailRowProps = {
  copy: UsageLogCopy;
  detailId: string;
  event: UsageEvent;
  isExpanded: boolean;
  locale: string;
  onExpandedChange: (expanded: boolean) => void;
  timeZone: string;
};

/** 根据稳定状态选择 Badge 外观；文字仍始终显式展示状态。 */
function getStatusVariant(
  status: UsageStatus
): "default" | "destructive" | "outline" | "secondary" {
  if (status === "failed") return "destructive";
  if (status === "succeeded") return "default";
  if (status === "processing") return "secondary";
  return "outline";
}

/**
 * 格式化积分方向，不只用颜色传递消费或退款语义。
 *
 * @param event 当前请求或退款列表事件。
 * @param copy 页面文案。
 * @returns 带正负号、积分值和方向文本的可见字符串。
 * @sideEffects 无。
 */
function formatCreditDelta(event: UsageEvent, copy: UsageLogCopy): string {
  const sign = event.creditsDelta > 0 ? "+" : "";
  const direction =
    event.kind === "refund"
      ? copy.table.refundDirection
      : copy.table.spendDirection;
  return `${sign}${formatCredits(event.creditsDelta)} · ${direction}`;
}

/**
 * 渲染独立展开按钮和对应详情区域。
 *
 * @param props 列表事件、稳定 DOM id、语言时区和受控展开状态。
 * @returns 一条摘要表格行；展开后追加跨全表宽度的详情行。
 * @sideEffects 首次展开或重试时调用本人详情 Server Action。
 */
export function UsageLogDetailRow({
  copy,
  detailId,
  event,
  isExpanded,
  locale,
  onExpandedChange,
  timeZone,
}: UsageLogDetailRowProps) {
  const [loadState, setLoadState] = useState<DetailLoadState>({ kind: "idle" });

  /** 请求当前事件的安全详情；错误不保留服务端消息。 */
  async function loadDetail(): Promise<void> {
    setLoadState({ kind: "loading" });
    try {
      const result = await getMyUsageEventDetailAction({
        eventRef: event.eventRef,
      });
      if (result?.data) {
        setLoadState({ detail: result.data, kind: "ready" });
        return;
      }
      setLoadState({ kind: "error" });
    } catch {
      setLoadState({ kind: "error" });
    }
  }

  /** 切换展开状态，并只在首次展开时读取详情。 */
  function toggleExpanded(): void {
    const nextExpanded = !isExpanded;
    onExpandedChange(nextExpanded);
    if (nextExpanded && loadState.kind === "idle") {
      void loadDetail();
    }
  }

  const items =
    loadState.kind === "ready"
      ? buildUsageLogDetailItems(loadState.detail, {
          copy,
          locale,
          timeZone,
        })
      : [];

  return (
    <Fragment>
      <tr className="border-t align-top">
        <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
          {formatUsageLogTime(
            event.eventAt,
            locale,
            timeZone,
            copy.unknownTime
          )}
        </td>
        <td className="px-4 py-4">
          <span className="font-medium">
            {copy.businessTypes[event.businessType]}
          </span>
        </td>
        <td className="max-w-sm px-4 py-4">
          <p className="break-words font-medium">{event.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.table.source}: {copy.sourceChannels[event.sourceChannel]}
          </p>
        </td>
        <td className="px-4 py-4">
          <Badge variant={getStatusVariant(event.status)}>
            {copy.statuses[event.status]}
          </Badge>
        </td>
        <td
          className={`whitespace-nowrap px-4 py-4 text-right font-semibold ${
            event.creditsDelta > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-foreground"
          }`}
        >
          {formatCreditDelta(event, copy)}
        </td>
        <td className="px-4 py-3">
          <Button
            aria-controls={detailId}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? copy.detail.hide : copy.detail.show}
            onClick={toggleExpanded}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        </td>
      </tr>
      {isExpanded ? (
        <tr className="border-t bg-muted/20">
          <td className="px-4 py-5" colSpan={6}>
            <div
              aria-busy={loadState.kind === "loading"}
              className="text-left"
              id={detailId}
            >
              {loadState.kind === "loading" || loadState.kind === "idle" ? (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {copy.detail.loading}
                </p>
              ) : null}
              {loadState.kind === "error" ? (
                <div className="space-y-2" role="alert">
                  <p className="text-sm text-destructive">
                    {copy.detail.loadError}
                  </p>
                  <Button
                    onClick={() => void loadDetail()}
                    size="sm"
                    type="button"
                  >
                    {copy.detail.retry}
                  </Button>
                </div>
              ) : null}
              {loadState.kind === "ready" ? (
                <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item) => (
                    <div className="min-w-0" key={item.label}>
                      <dt className="text-xs text-muted-foreground">
                        {item.label}
                      </dt>
                      <dd className="mt-1 break-words text-sm font-medium">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
