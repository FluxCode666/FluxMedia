/**
 * 路由级加载骨架:提供 Suspense 边界,避免软导航在服务端组件 resolve 前阻塞
 * (否则切到本 tab 时会卡住、点其他 tab 无响应)。
 */
export default function Loading() {
  return (
    <div className="container mx-auto max-w-5xl animate-pulse px-4 py-8 md:px-6 md:py-12">
      <div className="mb-8 space-y-2">
        <div className="h-9 w-48 rounded bg-muted" />
        <div className="h-4 w-80 max-w-full rounded bg-muted" />
      </div>
      <div className="mb-6 flex gap-2 border-b border-border/60 pb-2">
        <div className="h-9 w-20 rounded-md bg-muted" />
        <div className="h-9 w-20 rounded-md bg-muted" />
      </div>
      <div className="space-y-6">
        <div className="h-44 w-full rounded-md bg-muted" />
        <div className="h-[340px] w-full rounded-md bg-muted" />
      </div>
    </div>
  );
}
