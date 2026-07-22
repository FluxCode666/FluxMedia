/**
 * 使用日志的 URL 驱动筛选表单。
 *
 * 使用方：使用日志服务端页面。表单使用 GET 提交，使筛选结果、可分享 URL 和浏览器
 * 前进后退保持一致；提交时未提供 cursor，因此每次调整筛选都会回到 keyset 首屏。
 */
import { Button } from "@repo/ui/components/button";

import type { UsageLogCopy } from "./usage-log-copy";
import type { UsageLogQueryState } from "./usage-log-query";

type UsageLogFiltersProps = {
  copy: UsageLogCopy;
  locale: string;
  state: UsageLogQueryState;
};

/**
 * 渲染可键盘操作的时间、业务类型和状态筛选。
 *
 * @param props 当前规范化 URL 状态和本地化文案。
 * @returns 使用 GET 的受控筛选表单；不执行客户端数据请求。
 * @sideEffects 浏览器提交后导航到当前语言下的使用日志首屏。
 */
export function UsageLogFilters({ copy, locale, state }: UsageLogFiltersProps) {
  return (
    <form
      action={`/${encodeURIComponent(locale)}/dashboard/usage-log`}
      className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
      method="get"
    >
      <label className="grid gap-2 text-sm font-medium">
        <span>{copy.filters.range}</span>
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          defaultValue={state.range.slice(0, -1)}
          name="range"
        >
          <option value="7">{copy.ranges["7d"]}</option>
          <option value="30">{copy.ranges["30d"]}</option>
          <option value="90">{copy.ranges["90d"]}</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">
        <span>{copy.filters.businessType}</span>
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          defaultValue={state.businessType ?? ""}
          name="businessType"
        >
          <option value="">{copy.filters.allTypes}</option>
          <option value="image">{copy.businessTypes.image}</option>
          <option value="video">{copy.businessTypes.video}</option>
          <option value="refund">{copy.businessTypes.refund}</option>
          <option value="historical">{copy.businessTypes.historical}</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">
        <span>{copy.filters.status}</span>
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          defaultValue={state.status ?? ""}
          name="status"
        >
          <option value="">{copy.filters.allStatuses}</option>
          <option value="processing">{copy.statuses.processing}</option>
          <option value="succeeded">{copy.statuses.succeeded}</option>
          <option value="failed">{copy.statuses.failed}</option>
          <option value="refund">{copy.statuses.refund}</option>
          <option value="unknown">{copy.statuses.unknown}</option>
        </select>
      </label>
      <Button type="submit">{copy.filters.apply}</Button>
    </form>
  );
}
