/**
 * 官网首页图像模型目录。
 *
 * 使用方：首页连续内容；把完整运行时目录投影为官网当前公开的图像模型，并以编辑式
 * 大卡片展示。视频、对话与 Firefly 前缀只在展示层隐藏，不修改系统运行时配置。
 */
import { isFireflyModel } from "@/features/image-generation/resolution";

import type {
  HomepageModelCatalogState,
  HomepageModelItem,
} from "./homepage-page-data";

/** 首页公开展示所需的最小目录状态。 */
export type HomepageVisibleModelCatalogState =
  | { status: "ready"; image: HomepageModelItem[] }
  | { status: "unavailable" };

/** 首页图像模型区的本地化文案。 */
export type HomepageModelCatalogCopy = {
  eyebrow: string;
  title: string;
  description: string;
  previewLabel: string;
  countLabel: string;
  unavailable: string;
  supportedLabel: string;
  image: {
    label: string;
    description: string;
    empty: string;
  };
};

/**
 * 将完整运行时目录投影为官网可见图像目录。
 *
 * @param catalog - 已由首页数据层校验的完整运行时目录。
 * @returns 仅含非 Firefly 图像模型的目录；依赖失败状态原样保留。
 * @sideEffects 无；不会修改传入数组或底层运行时配置。
 */
export function getHomepageVisibleModelCatalog(
  catalog: HomepageModelCatalogState
): HomepageVisibleModelCatalogState {
  if (catalog.status === "unavailable") return catalog;

  return {
    status: "ready",
    image: catalog.image
      .map((model) => ({ id: model.id.trim() }))
      .filter((model) => model.id && !isFireflyModel(model.id)),
  };
}

/**
 * 渲染单一图像模型目录与诚实降级状态。
 *
 * @param props - 已投影的可见目录和双语文案。
 * @returns 无 JavaScript 也完整可读的图像模型大卡片网格。
 */
export function HomepageModelCatalog({
  catalog,
  copy,
}: {
  catalog: HomepageVisibleModelCatalogState;
  copy: HomepageModelCatalogCopy;
}) {
  const models = catalog.status === "ready" ? catalog.image : null;

  return (
    <section
      aria-labelledby="homepage-models-title"
      className="scroll-mt-24 bg-background px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
      id="models"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="grid gap-8 border-b border-foreground/70 pb-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
              {copy.eyebrow}
            </p>
            <h2
              className="mt-4 max-w-4xl font-serif text-4xl font-medium leading-[1.04] tracking-[-0.025em] sm:text-5xl"
              id="homepage-models-title"
            >
              {copy.title}
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-muted-foreground lg:justify-self-end">
            {copy.description}
          </p>
        </div>

        <div className="mt-8 flex items-center justify-between gap-6">
          <div className="inline-flex items-baseline gap-3 rounded-full border border-foreground bg-foreground px-4 py-2 text-background">
            <span className="text-sm">{copy.image.label}</span>
            <span className="font-mono text-xs">
              {models === null ? "—" : `${models.length} ${copy.countLabel}`}
            </span>
          </div>
          <p className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
            {copy.previewLabel}
          </p>
        </div>

        <article
          aria-labelledby="homepage-models-title"
          className="mt-5"
          data-model-category="image"
        >
          {models === null ? (
            <p className="rounded-md border border-destructive/25 bg-destructive/5 px-5 py-4 text-sm text-muted-foreground">
              {copy.unavailable}
            </p>
          ) : models.length === 0 ? (
            <p className="rounded-md border border-border bg-background px-5 py-4 text-sm text-muted-foreground">
              {copy.image.empty}
            </p>
          ) : (
            <ul
              className={
                models.length === 1
                  ? "overflow-hidden rounded-lg border border-border bg-background"
                  : "grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3"
              }
            >
              {models.map((model, index) => (
                <li
                  className="group flex min-h-64 min-w-0 flex-col justify-between bg-background p-5 transition-colors duration-300 hover:bg-muted/35 motion-reduce:transition-none sm:p-6"
                  key={model.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")} / {copy.image.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className="size-5 rotate-45 border border-muted-foreground/60 transition-transform duration-300 group-hover:rotate-90 motion-reduce:transition-none"
                    />
                  </div>
                  <div>
                    <code className="block break-words font-serif text-2xl leading-tight tracking-[-0.02em] sm:text-3xl">
                      {model.id}
                    </code>
                    <div className="mt-6 flex items-center justify-between gap-4 border-t border-border pt-4">
                      <span className="text-xs text-muted-foreground">
                        {copy.image.description}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-destructive">
                        {copy.supportedLabel}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
