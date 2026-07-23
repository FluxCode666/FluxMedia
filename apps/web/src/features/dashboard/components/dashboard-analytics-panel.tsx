"use client";

/**
 * 用户控制台统计面板。
 *
 * 展示固定滚动近 24 小时、累计摘要、同窗口模型使用占比和近期创作；客户端只保留
 * 刷新状态，不再维护时间范围或趋势指标草稿。
 */
import { formatCredits } from "@repo/shared/credits/format";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { cn } from "@repo/ui/utils";
import { Coins, Image as ImageIcon, RefreshCw, Video } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { refreshDashboardSnapshotAction } from "@/features/dashboard/analytics-actions";
import type { DashboardSnapshot } from "@/features/dashboard/dashboard-data";
import { getDashboardActionErrorMessage } from "@/features/dashboard/dashboard-error-message";
import { RecentCreationsClient } from "@/features/image-generation/components/recent-creations-client";
import { Link } from "@/i18n/routing";

import { ModelUsageDistributionChartLazy } from "./dashboard-analytics-charts-lazy";

type DashboardAnalyticsPanelProps = {
  initialSnapshot: DashboardSnapshot;
  isZh: boolean;
  userName: string;
  serviceSupport: ReactNode;
};

const sectionEnterClass =
  "animate-in fade-in slide-in-from-bottom-2 animation-duration-500 fill-mode-backwards motion-reduce:animate-none";
const cardLiftClass =
  "transition-[border-color,box-shadow,translate] duration-250 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-whisper motion-reduce:transition-none";

/**
 * 将摘要数字格式化为稳定的本地数字分组。
 *
 * @param value 非负统计值。
 * @param locale 当前界面语言对应的 Intl locale。
 * @returns 带本地千位分组的字符串。
 */
function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * 渲染近 24 小时和累计摘要、模型占比与近期创作。
 *
 * @param props 服务端首屏快照、语言、用户名与服务支持区。
 * @returns 可刷新且对窄屏友好的控制台主体。
 */
export function DashboardAnalyticsPanel({
  initialSnapshot,
  isZh,
  userName,
  serviceSupport,
}: DashboardAnalyticsPanelProps) {
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const locale = isZh ? "zh-CN" : "en-US";
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /** 重新读取同一固定窗口的摘要、模型分布和近期创作。 */
  const refreshSnapshot = async () => {
    setIsRefreshing(true);
    try {
      const result = await refreshDashboardSnapshotAction({});
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
      toast.error(copy("Unable to refresh dashboard", "控制台刷新失败"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const last24HoursMetrics = [
    {
      label: copy("Images, last 24 hours", "近24小时生图数量"),
      value: formatCount(snapshot.summary.last24Hours.imageCount, locale),
      description: copy("successful image outputs", "成功产出的图片"),
      icon: ImageIcon,
    },
    {
      label: copy("Video seconds, last 24 hours", "近24小时生视频秒数"),
      value: formatCount(snapshot.summary.last24Hours.videoSeconds, locale),
      description: copy("seconds of video output", "视频产出秒数"),
      icon: Video,
    },
    {
      label: copy("Credits used, last 24 hours", "近24小时消耗积分"),
      value: formatCredits(snapshot.summary.last24Hours.creditsConsumed),
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
          disabled={isRefreshing}
          onClick={() => void refreshSnapshot()}
          type="button"
        >
          <RefreshCw className={cn(isRefreshing && "animate-spin")} />
          {copy("Refresh", "刷新")}
        </Button>
      </header>

      {serviceSupport}

      {[
        {
          title: copy("Last 24 hours", "近24小时统计"),
          metrics: last24HoursMetrics,
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

      <div
        className={cn(
          "grid gap-4 xl:grid-cols-[minmax(340px,.9fr)_minmax(0,1.7fr)]",
          sectionEnterClass,
          "delay-240"
        )}
      >
        <ModelUsageDistributionChartLazy
          distribution={snapshot.summary.modelDistribution}
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
