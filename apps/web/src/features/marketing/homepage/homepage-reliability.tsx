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
  recentSuccessRate: string;
  insufficient: string;
  unavailable: string;
  hiddenTitle: string;
  hiddenDescription: string;
};

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
        className="bg-background px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
        id="reliability"
      >
        <div className="mx-auto grid w-full max-w-7xl gap-6 border-y border-border py-8 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <h2
              className="font-serif text-2xl font-medium"
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
      className="scroll-mt-24 bg-background px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
      id="reliability"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="grid gap-8 border-b border-foreground/70 pb-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:gap-12">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
              {copy.eyebrow}
            </p>
            <h2
              className="mt-4 max-w-4xl font-serif text-4xl font-medium leading-[1.04] tracking-[-0.025em] sm:text-5xl lg:text-6xl"
              id="homepage-reliability-title"
            >
              {copy.title}
            </h2>
          </div>
          <div className="max-w-xl lg:justify-self-end">
            <p className="text-sm leading-7 text-muted-foreground">
              {copy.description}
            </p>
            {canToggle && state.visibility === "enabled" && (
              <div className="mt-5">
                <HomepageSlaToggle initiallyEnabled />
              </div>
            )}
          </div>
        </div>

        {state.visibility === "unavailable" ||
        stats.status === "unavailable" ? (
          <div
            className="mt-10 flex items-start gap-3 border-t border-destructive/35 py-5 text-sm leading-6 text-muted-foreground"
            role="status"
          >
            <span
              aria-hidden="true"
              className="mt-2 size-2 shrink-0 rounded-full bg-destructive"
            />
            <p>{copy.unavailable}</p>
          </div>
        ) : stats.status === "insufficient" ? (
          <div
            className="mt-10 flex items-start gap-3 border-t border-border py-5 text-sm leading-6 text-muted-foreground"
            role="status"
          >
            <span
              aria-hidden="true"
              className="mt-2 size-2 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <p>{copy.insufficient}</p>
          </div>
        ) : (
          <dl className="mt-10 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-t border-foreground/20 py-[18px]">
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {copy.availability}
              </dt>
              <dd className="mt-4">
                <span className="block font-serif text-[2.625rem] font-medium leading-none tracking-[-0.025em]">
                  {formatPercent(stats.data.successRate, locale)}
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {copy.recentSuccessRate}
                </span>
              </dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}
