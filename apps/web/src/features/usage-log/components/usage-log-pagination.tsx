/**
 * 使用日志 keyset 分页控制。
 *
 * 使用方：使用日志服务端页面。下一页只使用 UOL 返回的不透明 cursor；返回按钮清除
 * cursor 回到最新一页，避免把 offset 或未验证的时间戳带入查询。
 */
import { Link } from "@/i18n/routing";

import type { UsageLogCopy } from "./usage-log-copy";
import { buildUsageLogHref, type UsageLogQueryState } from "./usage-log-query";

type UsageLogPaginationProps = {
  copy: UsageLogCopy;
  nextCursor: string | null;
  state: UsageLogQueryState;
};

const paginationLinkClass =
  "inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/**
 * 渲染稳定、有界的 keyset 翻页入口。
 *
 * @param props 当前筛选状态和下一页 cursor。
 * @returns 在有上页位置或下一页 cursor 时显示的链接组。
 * @sideEffects 无；链接导航后由服务器重新执行同一 UOL 查询。
 */
export function UsageLogPagination({
  copy,
  nextCursor,
  state,
}: UsageLogPaginationProps) {
  if (!state.cursor && !nextCursor) return null;
  const firstPageHref = buildUsageLogHref({
    ...state,
    cursor: null,
  });
  const nextPageHref = nextCursor
    ? buildUsageLogHref({ ...state, cursor: nextCursor })
    : null;

  return (
    <nav aria-label={copy.table.title} className="flex flex-wrap gap-3">
      {state.cursor ? (
        <Link className={paginationLinkClass} href={firstPageHref}>
          {copy.pagination.back}
        </Link>
      ) : null}
      {nextPageHref ? (
        <Link className={paginationLinkClass} href={nextPageHref}>
          {copy.pagination.next}
        </Link>
      ) : null}
    </nav>
  );
}
