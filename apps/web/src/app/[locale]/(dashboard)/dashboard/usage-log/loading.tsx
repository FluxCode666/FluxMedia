/** 使用日志路由的加载骨架，仅表现列表结构，不虚构请求、积分或退款。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-28 rounded bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted" />
      </div>
      <div className="h-28 rounded-xl bg-muted" />
      <div className="h-72 rounded-xl bg-muted" />
      <div className="h-20 rounded-xl bg-muted" />
    </div>
  );
}
