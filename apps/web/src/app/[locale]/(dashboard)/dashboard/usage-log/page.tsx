/**
 * 独立使用日志页面。
 *
 * 使用方：已登录用户的业务请求核对入口。页面只将 URL 筛选转换为本人 UOL 查询，钱包
 * 资产、充值与订阅均不在此展示；价格趋势沿用既有内容并保持默认折叠。
 */
import { getServerSession } from "@repo/shared/auth/server";
import { getAppTimeZone, getUserTimeZone } from "@repo/shared/time-zone/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { loadImagePricingCardData } from "@/features/billing/image-pricing-card-data";
import { USAGE_LOG_NOT_READY_MESSAGE } from "@/features/usage-log/action-errors";
import { getMyUsageEventsAction } from "@/features/usage-log/actions";
import { createUsageLogCopy } from "@/features/usage-log/components/usage-log-copy";
import { UsageLogFilters } from "@/features/usage-log/components/usage-log-filters";
import { UsageLogPagination } from "@/features/usage-log/components/usage-log-pagination";
import { UsageLogPricingTrends } from "@/features/usage-log/components/usage-log-pricing-trends";
import {
  buildUsageLogHref,
  parseUsageLogSearchParams,
  type UsageLogSearchParams,
} from "@/features/usage-log/components/usage-log-query";
import { UsageLogTable } from "@/features/usage-log/components/usage-log-table";
import { Link } from "@/i18n/routing";

export const metadata = {
  title: "Usage Log | FluxMedia",
  description:
    "Review request activity, credit changes, and safe failure details.",
};

type UsageLogPageProps = {
  searchParams: Promise<UsageLogSearchParams>;
};

/** 判断当前 URL 是否不是默认无筛选首页，用于选择准确空状态文案。 */
function hasActiveUsageLogFilter(
  state: ReturnType<typeof parseUsageLogSearchParams>
): boolean {
  return (
    state.range !== "7d" || state.businessType !== null || state.status !== null
  );
}

/** 渲染使用日志请求列表、筛选与默认折叠的价格趋势。 */
export default async function UsageLogPage({
  searchParams,
}: UsageLogPageProps) {
  const [session, locale, rawSearchParams] = await Promise.all([
    getServerSession(),
    getLocale(),
    searchParams,
  ]);
  if (!session?.user) redirect(`/${locale}/sign-in`);

  const state = parseUsageLogSearchParams(rawSearchParams);
  const copy = createUsageLogCopy(locale === "zh");
  const retryHref = buildUsageLogHref(state);
  const [usageResult, timeZoneResult, pricingResult] = await Promise.allSettled(
    [
      getMyUsageEventsAction({
        businessType: state.businessType,
        cursor: state.cursor,
        limit: 20,
        range: state.range,
        status: state.status,
      }),
      getUserTimeZone(session.user.id),
      loadImagePricingCardData(session.user.id),
    ]
  );
  const timeZone =
    timeZoneResult.status === "fulfilled"
      ? timeZoneResult.value
      : getAppTimeZone();
  const pricingData =
    pricingResult.status === "fulfilled" ? pricingResult.value : null;
  const usageActionResult =
    usageResult.status === "fulfilled" ? usageResult.value : null;
  const usageData = usageActionResult?.data;
  const isWaiting =
    usageActionResult?.serverError === USAGE_LOG_NOT_READY_MESSAGE;
  const hasActiveFilter = hasActiveUsageLogFilter(state);
  let usageLogResults: ReactNode;

  if (usageData?.events.length) {
    usageLogResults = (
      <>
        <UsageLogTable
          copy={copy}
          events={usageData.events}
          key={retryHref}
          locale={locale}
          timeZone={timeZone}
        />
        <UsageLogPagination
          copy={copy}
          nextCursor={usageData.nextCursor}
          state={state}
        />
      </>
    );
  } else if (usageData) {
    usageLogResults = (
      <section
        aria-live="polite"
        className="rounded-xl border bg-card p-8 text-center"
      >
        <h2 className="font-serif text-xl font-medium">
          {hasActiveFilter ? copy.empty.filteredTitle : copy.empty.firstTitle}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasActiveFilter
            ? copy.empty.filteredDescription
            : copy.empty.firstDescription}
        </p>
      </section>
    );
  } else if (isWaiting) {
    usageLogResults = (
      <section
        aria-live="polite"
        className="rounded-xl border bg-card p-8 text-center"
        role="status"
      >
        <h2 className="font-serif text-xl font-medium">{copy.waiting.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.waiting.description}
        </p>
        <Link
          className="mt-4 inline-block text-sm font-medium underline"
          href={retryHref}
        >
          {copy.waiting.retry}
        </Link>
      </section>
    );
  } else {
    usageLogResults = (
      <section
        aria-live="assertive"
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center"
        role="alert"
      >
        <h2 className="font-serif text-xl font-medium">
          {copy.queryError.title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.queryError.description}
        </p>
        <Link
          className="mt-4 inline-block text-sm font-medium underline"
          href={retryHref}
        >
          {copy.queryError.retry}
        </Link>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
      </header>

      <UsageLogFilters copy={copy} locale={locale} state={state} />

      {usageLogResults}

      <UsageLogPricingTrends
        copy={copy}
        data={pricingData}
        isZh={locale === "zh"}
        retryHref={retryHref}
      />
    </div>
  );
}
