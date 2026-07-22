"use client";

/**
 * 使用日志请求/退款混合表。
 *
 * 使用方：usage-log 页面容器。折叠态只显示安全列表字段；每行展开控制独立于
 * 摘要和未来业务详情链接，不响应整行点击，并通过 aria 属性关联详情区域。
 */

import type { UsageEvent } from "@repo/shared/credits/usage-log-contract";
import { useEffect, useState } from "react";

import type { UsageLogCopy } from "./usage-log-copy";
import { UsageLogDetailRow } from "./usage-log-detail-row";

type UsageLogTableProps = {
  copy: UsageLogCopy;
  events: UsageEvent[];
  locale: string;
  timeZone: string;
};

/** 把可序列化文案模板格式化为当前结果数的辅助技术播报。 */
function formatResultAnnouncement(copy: UsageLogCopy, count: number): string {
  return copy.resultAnnouncement.replace("{count}", String(count));
}

/**
 * 渲染默认折叠的可访问混合表。
 *
 * @param props 当前页面事件、文案及语言时区。
 * @returns 横向可滚动表格；展开详情使用额外表格行。
 * @sideEffects 事件页变化时关闭全部详情并向 live region 宣布结果数。
 */
export function UsageLogTable({
  copy,
  events,
  locale,
  timeZone,
}: UsageLogTableProps) {
  const [expandedRefs, setExpandedRefs] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [announcement, setAnnouncement] = useState(
    formatResultAnnouncement(copy, events.length)
  );

  useEffect(() => {
    setExpandedRefs((previous) => (previous.size === 0 ? previous : new Set()));
    setAnnouncement(formatResultAnnouncement(copy, events.length));
  }, [copy, events]);

  /** 只更新目标行的展开状态，并输出不含 eventRef 的辅助技术提示。 */
  function setEventExpanded(event: UsageEvent, expanded: boolean): void {
    setExpandedRefs((previous) => {
      const next = new Set(previous);
      if (expanded) next.add(event.eventRef);
      else next.delete(event.eventRef);
      return next;
    });
    setAnnouncement(expanded ? copy.detail.show : copy.detail.hide);
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <h2 className="sr-only" id="usage-log-results-title" tabIndex={-1}>
        {copy.table.title}
      </h2>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium" scope="col">
                {copy.table.time}
              </th>
              <th className="px-4 py-3 font-medium" scope="col">
                {copy.table.businessType}
              </th>
              <th className="px-4 py-3 font-medium" scope="col">
                {copy.table.summary}
              </th>
              <th className="px-4 py-3 font-medium" scope="col">
                {copy.table.status}
              </th>
              <th className="px-4 py-3 text-right font-medium" scope="col">
                {copy.table.credits}
              </th>
              <th className="w-14 px-4 py-3" scope="col">
                <span className="sr-only">{copy.detail.show}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => {
              const detailId = `usage-log-detail-${index}`;
              const isExpanded = expandedRefs.has(event.eventRef);
              return (
                <UsageLogDetailRow
                  copy={copy}
                  detailId={detailId}
                  event={event}
                  isExpanded={isExpanded}
                  key={event.eventRef}
                  locale={locale}
                  onExpandedChange={(expanded) =>
                    setEventExpanded(event, expanded)
                  }
                  timeZone={timeZone}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
