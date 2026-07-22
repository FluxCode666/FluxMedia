"use client";

/**
 * 用户控制台统计面板与筛选状态机。
 *
 * 摘要固定为今日/累计，不受趋势筛选影响；粒度和范围同时控制折线图与活动分布。
 * 自定义范围只有点击应用后才提交，所有趋势请求使用递增版本号防止旧响应覆盖新筛选。
 */
import type {
  AnalyticsGranularity,
  AnalyticsMetric,
  UsageTrendsInput,
} from "@repo/shared/analytics/contracts";
import { formatCredits } from "@repo/shared/credits/format";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { cn } from "@repo/ui/utils";
import { Coins, Image as ImageIcon, RefreshCw, Video } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  getMyUsageTrendsAction,
  refreshDashboardSnapshotAction,
} from "@/features/dashboard/analytics-actions";
import type { DashboardSnapshot } from "@/features/dashboard/dashboard-data";
import { getDashboardActionErrorMessage } from "@/features/dashboard/dashboard-error-message";
import { RecentCreationsClient } from "@/features/image-generation/components/recent-creations-client";
import { Link } from "@/i18n/routing";

import {
  ActivityDistributionChartLazy,
  UsageTrendChartLazy,
} from "./dashboard-analytics-charts-lazy";
import {
  type DailyRange,
  DashboardRangePicker,
  type HourlyRange,
} from "./dashboard-range-picker";

type DashboardAnalyticsPanelProps = {
  initialSnapshot: DashboardSnapshot;
  isZh: boolean;
  userName: string;
  accountSupport: ReactNode;
};

const sectionEnterClass =
  "animate-in fade-in slide-in-from-bottom-2 animation-duration-500 fill-mode-backwards motion-reduce:animate-none";
const cardLiftClass =
  "transition-[border-color,box-shadow,translate] duration-250 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-whisper motion-reduce:transition-none";

/** 为已提交范围替换折线指标，保持联合类型的其余字段不变。 */
function withMetric(
  input: UsageTrendsInput,
  metric: AnalyticsMetric
): UsageTrendsInput {
  return { ...input, metric };
}

/** 将摘要数字格式化为稳定的本地数字分组。 */
function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** 渲染六项摘要、趋势筛选、两种图表与近期创作。 */
export function DashboardAnalyticsPanel({
  initialSnapshot,
  isZh,
  userName,
  accountSupport,
}: DashboardAnalyticsPanelProps) {
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const locale = isZh ? "zh-CN" : "en-US";
  const defaultInput = {
    granularity: "hour",
    metric: "imageCount",
    range: "last24Hours",
  } satisfies UsageTrendsInput;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [committedInput, setCommittedInput] =
    useState<UsageTrendsInput>(defaultInput);
  const [granularity, setGranularity] = useState<AnalyticsGranularity>("hour");
  const [hourlyRange, setHourlyRange] = useState<HourlyRange>("last24Hours");
  const [dailyRange, setDailyRange] = useState<DailyRange>("last7Days");
  const [customHourlyStart, setCustomHourlyStart] = useState("");
  const [customHourlyEnd, setCustomHourlyEnd] = useState("");
  const [customDailyStart, setCustomDailyStart] = useState("");
  const [customDailyEnd, setCustomDailyEnd] = useState("");
  const [isTrendLoading, setIsTrendLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestVersion = useRef(0);
  const isBusy = isTrendLoading || isRefreshing;

  /** 让筛选草稿回到最后一次成功提交的范围。 */
  const restoreCommittedDraft = (input: UsageTrendsInput) => {
    setGranularity(input.granularity);
    if (input.granularity === "hour") {
      setHourlyRange(input.range);
      if (input.range === "custom") {
        setCustomHourlyStart(input.start);
        setCustomHourlyEnd(input.end);
      }
      return;
    }
    setDailyRange(input.range);
    if (input.range === "custom") {
      setCustomDailyStart(input.start);
      setCustomDailyEnd(input.end);
    }
  };

  /** 仅查询趋势；失败时保留旧图和已提交筛选。 */
  const submitTrendInput = async (
    nextInput: UsageTrendsInput
  ): Promise<boolean> => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setIsTrendLoading(true);
    try {
      const result = await getMyUsageTrendsAction(nextInput);
      if (version !== requestVersion.current) return false;
      if (!result?.data) {
        restoreCommittedDraft(committedInput);
        toast.error(
          getDashboardActionErrorMessage(
            result?.serverError,
            isZh,
            copy("Unable to load trend data", "趋势数据加载失败")
          )
        );
        return false;
      }
      setSnapshot((previous) => ({ ...previous, trends: result.data }));
      setCommittedInput(nextInput);
      restoreCommittedDraft(nextInput);
      return true;
    } catch {
      if (version !== requestVersion.current) return false;
      restoreCommittedDraft(committedInput);
      toast.error(copy("Unable to load trend data", "趋势数据加载失败"));
      return false;
    } finally {
      if (version === requestVersion.current) setIsTrendLoading(false);
    }
  };

  /** 切换粒度并立即应用对应默认范围。 */
  const handleGranularityChange = (value: string) => {
    const nextGranularity: AnalyticsGranularity =
      value === "day" ? "day" : "hour";
    setGranularity(nextGranularity);
    if (nextGranularity === "hour") {
      setHourlyRange("last24Hours");
      void submitTrendInput({
        granularity: "hour",
        metric: snapshot.trends.metric,
        range: "last24Hours",
      });
      return;
    }
    setDailyRange("last7Days");
    void submitTrendInput({
      granularity: "day",
      metric: snapshot.trends.metric,
      range: "last7Days",
    });
  };

  /** 选择小时预设时立即提交；自定义只进入草稿态。 */
  const handleHourlyRangeChange = (value: string) => {
    const nextRange: HourlyRange =
      value === "last48Hours"
        ? "last48Hours"
        : value === "custom"
          ? "custom"
          : "last24Hours";
    setHourlyRange(nextRange);
    if (nextRange === "custom") {
      requestVersion.current += 1;
      setIsTrendLoading(false);
    } else {
      void submitTrendInput({
        granularity: "hour",
        metric: snapshot.trends.metric,
        range: nextRange,
      });
    }
  };

  /** 选择天预设时立即提交；自定义只进入草稿态。 */
  const handleDailyRangeChange = (value: string) => {
    const supported = [
      "last7Days",
      "currentMonth",
      "currentQuarter",
      "currentYear",
      "custom",
    ] as const;
    const nextRange: DailyRange = supported.includes(value as DailyRange)
      ? (value as DailyRange)
      : "last7Days";
    setDailyRange(nextRange);
    if (nextRange === "custom") {
      requestVersion.current += 1;
      setIsTrendLoading(false);
    } else {
      void submitTrendInput({
        granularity: "day",
        metric: snapshot.trends.metric,
        range: nextRange,
      });
    }
  };

  /** 应用当前自定义墙上时间或自然日范围。 */
  const applyCustomRange = async (): Promise<boolean> => {
    if (granularity === "hour") {
      if (!customHourlyStart || !customHourlyEnd) {
        toast.error(
          copy("Choose both start and end time", "请选择开始和结束时间")
        );
        return false;
      }
      return submitTrendInput({
        granularity: "hour",
        metric: snapshot.trends.metric,
        range: "custom",
        start: customHourlyStart,
        end: customHourlyEnd,
      });
    }
    if (!customDailyStart || !customDailyEnd) {
      toast.error(
        copy("Choose both start and end date", "请选择开始和结束日期")
      );
      return false;
    }
    return submitTrendInput({
      granularity: "day",
      metric: snapshot.trends.metric,
      range: "custom",
      start: customDailyStart,
      end: customDailyEnd,
    });
  };

  /** 切换折线指标，同时保持已提交范围不变。 */
  const handleMetricChange = (metric: AnalyticsMetric) => {
    if (metric === snapshot.trends.metric) return;
    void submitTrendInput(withMetric(committedInput, metric));
  };

  /** 按当前筛选一次性刷新摘要、趋势与近期创作。 */
  const refreshSnapshot = async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setIsTrendLoading(false);
    setIsRefreshing(true);
    try {
      const result = await refreshDashboardSnapshotAction(committedInput);
      if (version !== requestVersion.current) return;
      if (!result?.data) {
        toast.error(
          getDashboardActionErrorMessage(
            result?.serverError,
            isZh,
            copy("Unable to refresh dashboard", "控制台刷新失败")
          )
        );
        return;
      }
      setSnapshot(result.data);
      toast.success(copy("Dashboard refreshed", "控制台已刷新"));
    } catch {
      if (version !== requestVersion.current) return;
      toast.error(copy("Unable to refresh dashboard", "控制台刷新失败"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const todayMetrics = [
    {
      label: copy("Images today", "今日生图数量"),
      value: formatCount(snapshot.summary.today.imageCount, locale),
      description: copy("successful image outputs", "成功产出的图片"),
      icon: ImageIcon,
    },
    {
      label: copy("Video seconds today", "今日生视频秒数"),
      value: formatCount(snapshot.summary.today.videoSeconds, locale),
      description: copy("seconds of video output", "视频产出秒数"),
      icon: Video,
    },
    {
      label: copy("Credits used today", "今日消耗积分"),
      value: formatCredits(snapshot.summary.today.creditsConsumed),
      description: copy("net of linked refunds", "已扣除关联退款"),
      icon: Coins,
    },
  ];
  const lifetimeMetrics = [
    {
      label: copy("Total images", "累计生图数量"),
      value: formatCount(snapshot.summary.lifetime.imageCount, locale),
      description: copy("since account creation", "账户创建以来"),
      icon: ImageIcon,
    },
    {
      label: copy("Total video seconds", "累计生视频秒数"),
      value: formatCount(snapshot.summary.lifetime.videoSeconds, locale),
      description: copy("since account creation", "账户创建以来"),
      icon: Video,
    },
    {
      label: copy("Total credits used", "累计消耗积分"),
      value: formatCredits(snapshot.summary.lifetime.creditsConsumed),
      description: copy("net of linked refunds", "已扣除关联退款"),
      icon: Coins,
    },
  ];

  return (
    <div className="space-y-8">
      <header
        className={cn(
          "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
          sectionEnterClass
        )}
      >
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {copy("Overview", "总览")}
          </p>
          <h1 className="font-serif text-3xl font-medium tracking-tight">
            {copy("Usage overview", "用量概览")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {copy(
              `Welcome back, ${userName}. Track your output at a glance.`,
              `欢迎回来，${userName}。在这里查看你的创作产出。`
            )}
          </p>
        </div>
        <Button
          aria-busy={isRefreshing}
          disabled={isBusy}
          onClick={() => void refreshSnapshot()}
          type="button"
        >
          <RefreshCw className={cn(isRefreshing && "animate-spin")} />
          {copy("Refresh", "刷新")}
        </Button>
      </header>

      {accountSupport}

      {[
        {
          title: copy("Today", "今日统计"),
          metrics: todayMetrics,
          delay: "delay-80",
        },
        {
          title: copy("Lifetime", "累计统计"),
          metrics: lifetimeMetrics,
          delay: "delay-160",
        },
      ].map((section) => (
        <section
          className={cn("space-y-3", sectionEnterClass, section.delay)}
          key={section.title}
        >
          <h2 className="font-serif text-lg font-medium tracking-tight">
            {section.title}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {section.metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <Card className={cardLiftClass} key={metric.label}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                      {metric.label}
                    </CardTitle>
                    <Icon
                      className="size-4 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                  </CardHeader>
                  <CardContent>
                    <div className="font-serif text-3xl font-medium tracking-tight tabular-nums">
                      {metric.value}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {metric.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      <Card className={cn("gap-0 py-0", sectionEnterClass, "delay-240")}>
        <CardContent className="flex min-h-20 flex-col justify-center gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-sm font-medium" htmlFor="usage-range">
              {copy("Time range", "时间范围")}：
            </label>
            <DashboardRangePicker
              customDailyEnd={customDailyEnd}
              customDailyStart={customDailyStart}
              customHourlyEnd={customHourlyEnd}
              customHourlyStart={customHourlyStart}
              dailyRange={dailyRange}
              disabled={isBusy}
              granularity={granularity}
              hourlyRange={hourlyRange}
              isZh={isZh}
              onApplyCustomRange={applyCustomRange}
              onCustomDailyEndChange={setCustomDailyEnd}
              onCustomDailyStartChange={setCustomDailyStart}
              onCustomHourlyEndChange={setCustomHourlyEnd}
              onCustomHourlyStartChange={setCustomHourlyStart}
              onDailyRangeChange={handleDailyRangeChange}
              onHourlyRangeChange={handleHourlyRangeChange}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-sm font-medium" htmlFor="usage-granularity">
              {copy("Granularity", "粒度")}：
            </label>
            <Select
              disabled={isBusy}
              onValueChange={handleGranularityChange}
              value={granularity}
            >
              <SelectTrigger
                className="w-full min-w-32 sm:w-auto"
                id="usage-granularity"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">{copy("Hourly", "按小时")}</SelectItem>
                <SelectItem value="day">{copy("Daily", "按天")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className={cn(sectionEnterClass, "delay-320")}>
        <UsageTrendChartLazy
          isLoading={isBusy}
          isZh={isZh}
          onMetricChange={handleMetricChange}
          trends={snapshot.trends}
        />
      </div>

      <div
        className={cn(
          "grid gap-4 xl:grid-cols-[minmax(340px,.9fr)_minmax(0,1.7fr)]",
          sectionEnterClass,
          "delay-400"
        )}
      >
        <ActivityDistributionChartLazy
          distribution={snapshot.trends.distribution}
          isZh={isZh}
        />
        <Card className="h-full overflow-hidden">
          <CardHeader className="border-b pb-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="space-y-1.5">
              <CardTitle className="font-serif text-lg font-medium tracking-tight">
                {copy("Recent creations", "近期创作")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {copy(
                  "Your latest successful image outputs",
                  "最近成功产出的图片"
                )}
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/dashboard/gallery" prefetch={false}>
                {copy("View all", "查看全部")}
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="py-5">
            {snapshot.recentCreations.length > 0 ? (
              <RecentCreationsClient
                initialGenerations={snapshot.recentCreations}
                key={snapshot.summary.asOf}
                timeZone={snapshot.summary.timeZone}
              />
            ) : (
              <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed bg-muted/15 px-6 text-center text-sm text-muted-foreground">
                {copy(
                  "Your latest creations will appear here.",
                  "完成创作后，最近的图片会显示在这里。"
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
