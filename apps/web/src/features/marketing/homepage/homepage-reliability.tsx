/**
 * 官网首页可靠性事实区。
 *
 * 使用方：首页连续内容；只展示统计服务可验证的数据，配置关闭、零样本和读取失败均
 * 使用不同完成态。管理员开关由最小 client island 承担。
 */
import type { HomepageReliabilityState } from "./homepage-page-data";
import { HomepageSlaToggle } from "./homepage-sla-toggle";

/** 首页可靠性区的双语文案。 */
export type HomepageReliabilityCopy = {
  eyebrow: string;
  title: string;
  description: string;
  availability: string;
  sample: string;
  completed: string;
  platformErrors: string;
  insufficient: string;
  unavailable: string;
  hiddenTitle: string;
  hiddenDescription: string;
};

/** 按当前语言格式化整数，不改变统计事实。 */
function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** 按当前语言格式化两位百分比，不为失败或零样本生成固定数字。 */
function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * 服务端渲染可靠性完成态。
 *
 * @param props - 独立配置/统计状态、管理员布尔值、当前语言与可见文案。
 * @returns 可验证统计、诚实不可用态、管理员隐藏态，或访客关闭时的 null。
 */
export function HomepageReliability({
  state,
  canToggle,
  locale,
  copy,
}: {
  state: HomepageReliabilityState;
  canToggle: boolean;
  locale: string;
  copy: HomepageReliabilityCopy;
}) {
  if (state.visibility === "disabled") {
    if (!canToggle) return null;
    return (
      <section
        aria-labelledby="homepage-reliability-hidden-title"
        className="border-y border-border bg-muted/20 px-4 py-8 sm:px-6 lg:px-8"
        id="reliability"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              className="font-serif text-xl font-medium"
              id="homepage-reliability-hidden-title"
            >
              {copy.hiddenTitle}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {copy.hiddenDescription}
            </p>
          </div>
          <HomepageSlaToggle initiallyEnabled={false} />
        </div>
      </section>
    );
  }

  const stats = state.stats;
  return (
    <section
      aria-labelledby="homepage-reliability-title"
      className="border-y border-border bg-foreground px-4 py-20 text-background sm:px-6 lg:px-8 lg:py-24"
      id="reliability"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-background/55">
              {copy.eyebrow}
            </p>
            <h2
              className="mt-4 font-serif text-3xl font-medium tracking-tight sm:text-4xl"
              id="homepage-reliability-title"
            >
              {copy.title}
            </h2>
            <p className="mt-4 text-base leading-7 text-background/65">
              {copy.description}
            </p>
          </div>
          {canToggle && state.visibility === "enabled" && (
            <HomepageSlaToggle initiallyEnabled />
          )}
        </div>

        {state.visibility === "unavailable" ||
        stats.status === "unavailable" ? (
          <p className="mt-12 border-l-2 border-[#a63d33] py-2 pl-4 text-sm text-background/65">
            {copy.unavailable}
          </p>
        ) : stats.status === "insufficient" ? (
          <p className="mt-12 border-l-2 border-background/30 py-2 pl-4 text-sm text-background/65">
            {copy.insufficient}
          </p>
        ) : (
          <div className="mt-12 grid gap-px bg-background/20 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-foreground p-6">
              <p className="font-serif text-4xl">
                {formatPercent(stats.data.successRate, locale)}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-background/55">
                {copy.availability}
              </p>
            </div>
            <div className="bg-foreground p-6">
              <p className="font-serif text-4xl">
                {formatCount(stats.data.sampleSize, locale)}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-background/55">
                {copy.sample}
              </p>
            </div>
            <div className="bg-foreground p-6">
              <p className="font-serif text-4xl">
                {formatCount(stats.data.completed, locale)}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-background/55">
                {copy.completed}
              </p>
            </div>
            <div className="bg-foreground p-6">
              <p className="font-serif text-4xl text-[#d2776d]">
                {formatCount(stats.data.platformErrors, locale)}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.18em] text-background/55">
                {copy.platformErrors}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
