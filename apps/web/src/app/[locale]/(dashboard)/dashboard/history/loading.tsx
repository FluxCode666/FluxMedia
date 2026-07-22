/**
 * 使用记录路由的加载骨架。
 *
 * 结构与最终页面的标题、筛选栏和日期优先混合记录列表一致，不虚构业务数据。
 */

/** 返回尊重减弱动态设置的使用记录加载状态。 */
export default function HistoryLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading usage records"
      className="container mx-auto space-y-8 px-4 py-6 md:px-6"
      role="status"
    >
      <div className="animate-pulse space-y-6 motion-reduce:animate-none">
        <div className="space-y-2">
          <div className="h-7 w-32 rounded-sm bg-muted" />
          <div className="h-4 w-72 max-w-full rounded-sm bg-muted" />
        </div>

        <div className="grid gap-3 rounded-lg border border-border bg-background p-4 md:grid-cols-2 xl:grid-cols-[minmax(280px,1.4fr)_minmax(190px,1fr)_150px_140px_auto]">
          <div className="space-y-2">
            <div className="h-3 w-20 rounded-sm bg-muted" />
            <div className="h-10 rounded-md bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-14 rounded-sm bg-muted" />
            <div className="h-9 rounded-md bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-12 rounded-sm bg-muted" />
            <div className="h-9 rounded-md bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-10 rounded-sm bg-muted" />
            <div className="h-9 rounded-md bg-muted" />
          </div>
          <div className="h-9 rounded-md bg-muted xl:self-end" />
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="overflow-x-auto">
            <div className="lg:min-w-[1180px]">
              <div className="hidden border-b border-border bg-muted/30 px-4 py-3 lg:block">
                <div className="h-3.5 w-full max-w-xl rounded-sm bg-muted" />
              </div>
              <div className="divide-y divide-border">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3 px-4 py-3.5 lg:grid-cols-[228px_64px_minmax(220px,1fr)_76px_160px_124px_104px_96px] lg:items-center"
                    key={`history-skeleton-${index.toString()}`}
                  >
                    <div className="col-span-2 h-3 w-44 rounded-sm bg-muted lg:col-span-1" />
                    <div className="size-12 rounded-sm bg-muted lg:size-14" />
                    <div className="space-y-2">
                      <div className="h-3 w-3/4 rounded-sm bg-muted" />
                      <div className="h-3 w-1/2 rounded-sm bg-muted" />
                    </div>
                    <div className="hidden h-3 w-10 rounded-sm bg-muted lg:block" />
                    <div className="hidden h-3 w-28 rounded-sm bg-muted lg:block" />
                    <div className="hidden h-3 w-20 rounded-sm bg-muted lg:block" />
                    <div className="hidden h-3 w-14 rounded-sm bg-muted lg:block" />
                    <div className="hidden h-5 w-16 rounded-full bg-muted lg:block" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
