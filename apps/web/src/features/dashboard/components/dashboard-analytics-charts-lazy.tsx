"use client";

/**
 * 控制台图表的单一懒加载入口。
 *
 * 折线图和饼图来自同一模块，因此 Recharts 只形成一个客户端异步块；等高骨架避免
 * 首次加载时页面跳动，Server Component 不会直接引入图表运行时。
 */
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type {
  ActivityDistributionChart,
  UsageTrendChart,
} from "./dashboard-analytics-charts";

const LazyUsageTrendChart = dynamic(
  () =>
    import("./dashboard-analytics-charts").then((module) => ({
      default: module.UsageTrendChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[390px] animate-pulse rounded-lg border bg-muted/25" />
    ),
  }
);

const LazyActivityDistributionChart = dynamic(
  () =>
    import("./dashboard-analytics-charts").then((module) => ({
      default: module.ActivityDistributionChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[390px] animate-pulse rounded-lg border bg-muted/25" />
    ),
  }
);

/** 懒加载生成趋势图。 */
export function UsageTrendChartLazy(
  props: ComponentProps<typeof UsageTrendChart>
) {
  return <LazyUsageTrendChart {...props} />;
}

/** 懒加载活动分布饼图。 */
export function ActivityDistributionChartLazy(
  props: ComponentProps<typeof ActivityDistributionChart>
) {
  return <LazyActivityDistributionChart {...props} />;
}
