/**
 * 管理端全局使用记录页的加载骨架。
 *
 * 使用方：管理端路由 Suspense 边界。结构保留用户邮箱筛选与全局表格宽度，避免加载时
 * 错误暗示不存在的业务数据。
 */

const FILTER_SKELETON_KEYS = [
  "date",
  "model",
  "user",
  "status",
  "type",
  "actions",
] as const;

const ROW_SKELETON_KEYS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
] as const;

const CELL_SKELETON_KEYS = [
  "email",
  "user-id",
  "date",
  "preview",
  "prompt",
  "type",
  "model",
  "specification",
  "credits",
  "status",
] as const;

/** 返回尊重减弱动态设置的全局使用记录加载状态。 */
export default function AdminHistoryLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading global usage records"
      className="container mx-auto space-y-8 px-4 py-6 md:px-6"
      role="status"
    >
      <div className="animate-pulse space-y-6 motion-reduce:animate-none">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-sm bg-muted" />
          <div className="h-4 w-96 max-w-full rounded-sm bg-muted" />
        </div>
        <div className="grid gap-3 rounded-lg border border-border bg-background p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_minmax(190px,1fr)_minmax(220px,1fr)_150px_140px_auto]">
          {FILTER_SKELETON_KEYS.map((key) => (
            <div className="space-y-2" key={key}>
              <div className="h-3 w-20 rounded-sm bg-muted" />
              <div className="h-10 rounded-md bg-muted" />
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="overflow-x-auto">
            <div className="lg:min-w-[1550px]">
              <div className="hidden border-b border-border bg-muted/30 px-4 py-3 lg:block">
                <div className="h-3.5 w-full max-w-3xl rounded-sm bg-muted" />
              </div>
              <div className="divide-y divide-border">
                {ROW_SKELETON_KEYS.map((rowKey) => (
                  <div
                    className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-3 px-4 py-3.5 lg:grid-cols-[minmax(200px,1fr)_minmax(160px,0.8fr)_228px_64px_minmax(220px,1fr)_76px_160px_124px_104px_96px] lg:items-center"
                    key={rowKey}
                  >
                    {CELL_SKELETON_KEYS.map((cellKey) => (
                      <div
                        className="hidden h-3 rounded-sm bg-muted lg:block"
                        key={cellKey}
                      />
                    ))}
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
