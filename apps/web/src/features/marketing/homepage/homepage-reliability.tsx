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
        className="bg-background px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10"
        id="reliability"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 rounded-lg border border-border bg-muted/20 px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
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
      className="bg-background px-4 py-6 text-background sm:px-6 sm:py-8 lg:px-8 lg:py-10"
      id="reliability"
    >
      <div className="mx-auto w-full max-w-7xl rounded-lg bg-foreground px-6 py-14 shadow-menu sm:px-10 sm:py-16 lg:px-12 lg:py-20">
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
            <HomepageSlaToggle initiallyEnabled onDark />
          )}
        </div>

        {state.visibility === "unavailable" ||
        stats.status === "unavailable" ? (
          <div
            className="mt-12 flex items-start gap-3 rounded-md border border-[#a63d33]/45 bg-[#a63d33]/10 px-5 py-5 text-sm leading-6 text-background/70"
            role="status"
          >
            <span
              aria-hidden="true"
              className="mt-2 size-2 shrink-0 rounded-full bg-[#d2776d]"
            />
            <p>{copy.unavailable}</p>
          </div>
        ) : stats.status === "insufficient" ? (
          <div
            className="mt-12 flex items-start gap-3 rounded-md border border-background/20 bg-background/[0.04] px-5 py-5 text-sm leading-6 text-background/70"
            role="status"
          >
            <span
              aria-hidden="true"
              className="mt-2 size-2 shrink-0 rounded-full bg-background/45"
            />
            <p>{copy.insufficient}</p>
          </div>
        ) : (
          <div className="mt-12 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
            <div className="flex min-h-80 flex-col justify-between rounded-lg border border-background/20 bg-background/[0.04] p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-background/55">
                  {copy.availability}
                </p>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-[#d2776d] shadow-[0_0_0_5px_rgba(210,119,109,0.12)]"
                />
              </div>
              <p className="font-serif text-6xl leading-none tracking-[-0.045em] sm:text-7xl lg:text-8xl">
                {formatPercent(stats.data.successRate, locale)}
              </p>
              <div
                aria-label={copy.availability}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(stats.data.successRate * 100)}
                className="h-2 overflow-hidden rounded-full bg-background/15"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-[#d2776d]"
                  style={{ width: `${stats.data.successRate * 100}%` }}
                />
              </div>
            </div>

            <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              <div className="flex min-h-24 items-end justify-between gap-5 rounded-md border border-background/20 bg-background/[0.04] p-5 lg:min-h-0">
                <dt className="text-xs uppercase tracking-[0.16em] text-background/55">
                  {copy.sample}
                </dt>
                <dd className="font-serif text-4xl leading-none">
                  {formatCount(stats.data.sampleSize, locale)}
                </dd>
              </div>
              <div className="flex min-h-24 items-end justify-between gap-5 rounded-md border border-background/20 bg-background/[0.04] p-5 lg:min-h-0">
                <dt className="text-xs uppercase tracking-[0.16em] text-background/55">
                  {copy.completed}
                </dt>
                <dd className="font-serif text-4xl leading-none">
                  {formatCount(stats.data.completed, locale)}
                </dd>
              </div>
              <div className="flex min-h-24 items-end justify-between gap-5 rounded-md border border-[#a63d33]/45 bg-[#a63d33]/10 p-5 lg:min-h-0">
                <dt className="text-xs uppercase tracking-[0.16em] text-background/55">
                  {copy.platformErrors}
                </dt>
                <dd className="font-serif text-4xl leading-none text-[#d2776d]">
                  {formatCount(stats.data.platformErrors, locale)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
