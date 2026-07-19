/**
 * 创作页加载骨架屏。
 *
 * 使用方：Next.js App Router 在创作页服务端内容就绪前自动渲染本组件。
 * 结构与创作页的标题、输入区和六个模型入口保持一致。
 */
const MODEL_SKELETON_KEYS = [
  "model-one",
  "model-two",
  "model-three",
  "model-four",
  "model-five",
  "model-six",
];

/**
 * 渲染创作页加载占位。
 *
 * @returns 静态骨架元素；无外部副作用且不会失败。
 */
export default function CreateLoading() {
  return (
    <div className="container mx-auto max-w-5xl animate-pulse motion-reduce:animate-none px-4 py-8 md:px-6 md:py-12">
      <div className="mb-8 space-y-2">
        <div className="h-9 w-40 rounded-md bg-muted" />
        <div className="h-4 w-72 rounded-md bg-muted" />
      </div>

      <div className="mb-10 space-y-4">
        <div className="h-32 w-full rounded-md bg-muted" />
        <div className="flex items-center justify-between">
          <div className="h-9 w-40 rounded-md bg-muted" />
          <div className="h-9 w-32 rounded-md bg-muted" />
        </div>
      </div>

      <div className="space-y-4">
        <div className="h-6 w-24 rounded-md bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {MODEL_SKELETON_KEYS.map((key) => (
            <div key={key} className="aspect-square rounded-md bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
