/**
 * 当前用户的图片与视频统一历史页。
 *
 * 页面只把公开 URL 状态交给本人历史 UOL Action，并组合时区与价格趋势；查询、
 * 归属、日期边界、错误脱敏和 keyset cursor 均由接口层负责。
 */

import { getCurrentUser } from "@repo/shared/auth/server";
import { getAppTimeZone, getUserTimeZone } from "@repo/shared/time-zone/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { Suspense } from "react";
import { loadImagePricingCardData } from "@/features/billing/image-pricing-card-data";
import { HistoryClient } from "@/features/image-generation/components/history-client";
import { HistoryFilters } from "@/features/image-generation/components/history-filters";
import { HistoryPricingTrends } from "@/features/image-generation/components/history-pricing-trends";
import {
  buildHistoryHref,
  type HistorySearchParams,
  parseHistorySearchParams,
} from "@/features/image-generation/components/history-query";
import { getMyHistoryRecordsAction } from "@/features/image-generation/history-actions";
import { Link } from "@/i18n/routing";

export const metadata = {
  title: "History | FluxMedia",
  description: "Review and filter your image and video generation history.",
};

type HistoryPageProps = {
  searchParams: Promise<HistorySearchParams>;
};

type HistoryPricingSectionProps = {
  dataPromise: Promise<Awaited<
    ReturnType<typeof loadImagePricingCardData>
  > | null>;
  isZh: boolean;
  retryHref: string;
};

/**
 * 独立等待价格数据，让历史查询结果先通过外层 Suspense 边界完成渲染。
 *
 * @param props 已启动的价格读取、语言和同页重试地址。
 * @returns 默认折叠且具有独立失败状态的价格趋势卡。
 */
async function HistoryPricingSection({
  dataPromise,
  isZh,
  retryHref,
}: HistoryPricingSectionProps) {
  const data = await dataPromise;
  return <HistoryPricingTrends data={data} isZh={isZh} retryHref={retryHref} />;
}

/** 价格趋势尚未返回时只保留紧凑占位，不阻塞历史列表。 */
function HistoryPricingFallback() {
  return <div className="h-24 animate-pulse rounded-xl bg-muted" />;
}

/** 渲染 URL 驱动的本人图片/视频历史记录。 */
export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const [user, locale, rawSearchParams] = await Promise.all([
    getCurrentUser(),
    getLocale(),
    searchParams,
  ]);
  if (!user) redirect(`/${locale}/sign-in`);

  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const queryState = parseHistorySearchParams(rawSearchParams);
  const retryHref = buildHistoryHref(queryState);
  const pricingPromise = loadImagePricingCardData(user.id).catch(() => null);
  const [historyResult, timeZoneResult] = await Promise.allSettled([
    getMyHistoryRecordsAction({
      createdFrom: queryState.createdFrom,
      createdTo: queryState.createdTo,
      cursor: queryState.cursor,
      limit: 20,
      model: queryState.model,
      status: queryState.status,
      type: queryState.type,
    }),
    getUserTimeZone(user.id),
  ]);
  const timeZone =
    timeZoneResult.status === "fulfilled"
      ? timeZoneResult.value
      : getAppTimeZone();
  const historyActionResult =
    historyResult.status === "fulfilled" ? historyResult.value : null;
  const historyData = historyActionResult?.data;

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 md:px-6">
      <header>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy("History", "历史记录")}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {copy(
            "Filter image and video generations, including processing and failed records.",
            "筛选图片与视频生成记录，包括处理中和失败的任务。"
          )}
        </p>
      </header>

      {historyData ? (
        <HistoryClient
          key={retryHref}
          modelOptions={historyData.modelOptions}
          nextCursor={historyData.nextCursor}
          previousCursor={historyData.previousCursor}
          queryState={queryState}
          records={historyData.records}
          timeZone={timeZone}
        />
      ) : (
        <div className="space-y-4">
          <HistoryFilters modelOptions={[]} state={queryState} />
          <section
            aria-live="assertive"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center"
            role="alert"
          >
            <h2 className="font-serif text-xl font-medium">
              {copy("History could not be loaded", "历史记录加载失败")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {copy(
                "Check the filter values and try again.",
                "请检查筛选条件后重试。"
              )}
            </p>
            <Link
              className="mt-4 inline-block text-sm font-medium underline"
              href={retryHref}
            >
              {copy("Retry", "重试")}
            </Link>
          </section>
        </div>
      )}

      <Suspense fallback={<HistoryPricingFallback />}>
        <HistoryPricingSection
          dataPromise={pricingPromise}
          isZh={isZh}
          retryHref={retryHref}
        />
      </Suspense>
    </div>
  );
}
