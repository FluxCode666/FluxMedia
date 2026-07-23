"use client";

/**
 * 官网首页运行时模型目录渐进增强组件。
 *
 * 使用方：首页连续内容；同一 `HomepageModelCatalogState` 同时驱动速览带和完整三分类，
 * SSR 直接输出全部模型与空状态，hydration 后才增强为可访问分类 tabs。
 */
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type {
  HomepageModelCatalogState,
  HomepageModelItem,
} from "./homepage-page-data";

/** 模型分类的稳定键。 */
export type HomepageModelCategory = "image" | "video" | "conversation";

/** 单个模型分类的本地化可见文案。 */
export type HomepageModelCategoryCopy = {
  label: string;
  description: string;
  empty: string;
};

/** 模型目录区的完整本地化文案。 */
export type HomepageModelCatalogCopy = {
  eyebrow: string;
  title: string;
  description: string;
  previewLabel: string;
  countLabel: string;
  unavailable: string;
  supportedLabel: string;
  categories: Record<HomepageModelCategory, HomepageModelCategoryCopy>;
};

const MODEL_CATEGORIES: readonly HomepageModelCategory[] = [
  "image",
  "video",
  "conversation",
];

/** tabs 支持的方向键与边界键。 */
export type HomepageModelTabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/**
 * 计算键盘操作后的模型分类，左右方向循环，Home/End 跳到边界。
 *
 * @param current - 当前选中的分类。
 * @param key - 已收窄的 tabs 导航键。
 * @returns 下一分类；无副作用，供客户端事件和 DB-free 测试共用。
 */
export function getNextHomepageModelTab(
  current: HomepageModelCategory,
  key: HomepageModelTabKey
): HomepageModelCategory {
  if (key === "Home") return "image";
  if (key === "End") return "conversation";
  const currentIndex = MODEL_CATEGORIES.indexOf(current);
  const offset = key === "ArrowRight" ? 1 : -1;
  const nextIndex =
    (currentIndex + offset + MODEL_CATEGORIES.length) % MODEL_CATEGORIES.length;
  return MODEL_CATEGORIES[nextIndex] ?? current;
}

/** 将任意键盘值收窄为本组件支持的导航键。 */
function isHomepageModelTabKey(key: string): key is HomepageModelTabKey {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "Home" ||
    key === "End"
  );
}

/** 从目录状态读取指定分类；失败态不会伪装成空数组。 */
function getCategoryModels(
  catalog: HomepageModelCatalogState,
  category: HomepageModelCategory
): readonly HomepageModelItem[] | null {
  return catalog.status === "ready" ? catalog[category] : null;
}

/** 渲染完整分类中的模型卡或对应诚实状态。 */
function ModelCategory({
  category,
  catalog,
  copy,
  hidden,
}: {
  category: HomepageModelCategory;
  catalog: HomepageModelCatalogState;
  copy: HomepageModelCatalogCopy;
  hidden: boolean;
}) {
  const models = getCategoryModels(catalog, category);
  const categoryCopy = copy.categories[category];

  return (
    <article
      aria-labelledby={`homepage-model-tab-${category}`}
      className="border-t border-border py-8 first:border-t-0 lg:grid lg:grid-cols-[0.62fr_1.38fr] lg:gap-12"
      data-model-category={category}
      hidden={hidden}
      id={`homepage-model-panel-${category}`}
      role="tabpanel"
    >
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="font-serif text-2xl font-medium">
            {categoryCopy.label}
          </h3>
          {models && (
            <span className="font-mono text-xs text-muted-foreground">
              {models.length} {copy.countLabel}
            </span>
          )}
        </div>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          {categoryCopy.description}
        </p>
      </div>

      <div className="mt-6 lg:mt-0">
        {models === null ? (
          <p className="border-l-2 border-destructive/70 py-2 pl-4 text-sm text-muted-foreground">
            {copy.unavailable}
          </p>
        ) : models.length === 0 ? (
          <p className="border-l-2 border-border py-2 pl-4 text-sm text-muted-foreground">
            {categoryCopy.empty}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {models.map((model) => (
              <li
                className="flex min-w-0 items-center justify-between gap-3 border border-border bg-background px-4 py-3"
                key={model.id}
              >
                <code className="min-w-0 break-all font-mono text-sm">
                  {model.id}
                </code>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-destructive">
                  {copy.supportedLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/**
 * 服务端渲染模型速览和完整三分类。
 *
 * @param props - 同一运行时目录状态与双语文案。
 * @returns 无 JavaScript 也含 image/video/conversation 分类和全部模型的 HTML。
 */
export function HomepageModelCatalog({
  catalog,
  copy,
}: {
  catalog: HomepageModelCatalogState;
  copy: HomepageModelCatalogCopy;
}) {
  const [enhanced, setEnhanced] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<HomepageModelCategory>("image");
  const tabButtonRefs = useRef<
    Partial<Record<HomepageModelCategory, HTMLButtonElement | null>>
  >({});

  useEffect(() => {
    setEnhanced(true);
  }, []);

  /** 更新分类并通过组件局部 ref 聚焦对应 tab，不查询全局 DOM。 */
  const selectAndFocus = (category: HomepageModelCategory) => {
    setSelectedCategory(category);
    tabButtonRefs.current[category]?.focus();
  };

  /** 处理 ARIA tabs 的循环方向键与 Home/End 导航。 */
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    category: HomepageModelCategory
  ) => {
    if (!isHomepageModelTabKey(event.key)) return;
    event.preventDefault();
    selectAndFocus(getNextHomepageModelTab(category, event.key));
  };

  return (
    <section
      aria-labelledby="homepage-models-title"
      className="scroll-mt-24 border-y border-border bg-muted/15"
      id="models"
    >
      <div className="border-b border-border px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {copy.previewLabel}
          </p>
          <div
            aria-label={copy.previewLabel}
            className="flex flex-wrap gap-2"
            role="tablist"
          >
            {MODEL_CATEGORIES.map((category) => {
              const models = getCategoryModels(catalog, category);
              const selected = selectedCategory === category;
              return (
                <button
                  aria-controls={`homepage-model-panel-${category}`}
                  aria-selected={selected}
                  className="inline-flex items-baseline gap-2 border border-border bg-background px-3 py-2 text-left transition-colors hover:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-selected:border-foreground aria-selected:text-foreground"
                  data-model-preview={category}
                  id={`homepage-model-tab-${category}`}
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  onKeyDown={(event) => handleTabKeyDown(event, category)}
                  ref={(node) => {
                    tabButtonRefs.current[category] = node;
                  }}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  <span className="text-sm">
                    {copy.categories[category].label}
                  </span>
                  <span className="font-mono text-xs text-destructive">
                    {models === null ? "—" : models.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {copy.eyebrow}
          </p>
          <h2
            className="mt-4 font-serif text-3xl font-medium tracking-tight sm:text-5xl"
            id="homepage-models-title"
          >
            {copy.title}
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            {copy.description}
          </p>
        </div>

        <div className="mt-14">
          {MODEL_CATEGORIES.map((category) => (
            <ModelCategory
              catalog={catalog}
              category={category}
              copy={copy}
              hidden={enhanced && selectedCategory !== category}
              key={category}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
