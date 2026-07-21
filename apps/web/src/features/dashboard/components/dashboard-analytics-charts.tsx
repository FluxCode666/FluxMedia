"use client";

/**
 * 控制台用量趋势与活动分布图表。
 *
 * 本文件是首页唯一直接依赖 Recharts 的模块，由懒加载包装器整体拆包。折线图压缩
 * 左右边距，饼图使用更大的外半径；积分不进入时间范围图表。
 */
import type { UsageTrendsOutput } from "@repo/shared/analytics/contracts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { cn } from "@repo/ui/utils";
import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type UsageTrendChartProps = {
  trends: UsageTrendsOutput;
  isZh: boolean;
  isLoading: boolean;
  onMetricChange: (metric: UsageTrendsOutput["metric"]) => void;
};

type ActivityDistributionChartProps = {
  distribution: UsageTrendsOutput["distribution"];
  isZh: boolean;
};

/** 观察容器宽度，避免 ResponsiveContainer 首次测量为零。 */
function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (value: number) => setWidth(Math.max(0, Math.floor(value)));
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** 将完整桶标签压缩为坐标轴刻度，Tooltip 仍展示完整标签。 */
function formatAxisLabel(
  label: string,
  granularity: UsageTrendsOutput["granularity"]
): string {
  if (granularity === "day") return label.slice(5);
  return label.length >= 16 ? label.slice(5, 16) : label;
}

/** 渲染所选图片数量或视频秒数的单指标趋势。 */
export function UsageTrendChart({
  trends,
  isZh,
  isLoading,
  onMetricChange,
}: UsageTrendChartProps) {
  const { ref, width } = useElementWidth();
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const metricLabel =
    trends.metric === "imageCount"
      ? copy("Images", "生图数量")
      : copy("Video seconds", "生视频秒数");
  const rangeLabel = `${trends.buckets[0]?.label ?? ""} — ${
    trends.buckets.at(-1)?.label ?? ""
  }`;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-4 border-b pb-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="space-y-1.5">
          <CardTitle className="font-serif text-lg font-medium tracking-tight">
            {copy("Generation trend", "生成趋势")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <fieldset className="inline-flex w-fit rounded-lg border bg-muted/35 p-1">
          <legend className="sr-only">
            {copy("Trend metric", "趋势指标")}
          </legend>
          {(["imageCount", "videoSeconds"] as const).map((metric) => (
            <button
              aria-pressed={trends.metric === metric}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow,opacity]",
                trends.metric === metric
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              disabled={isLoading}
              key={metric}
              onClick={() => onMetricChange(metric)}
              type="button"
            >
              {metric === "imageCount"
                ? copy("Images", "生图")
                : copy("Video", "生视频")}
            </button>
          ))}
        </fieldset>
      </CardHeader>
      <CardContent className="px-2 pb-4 pt-5 sm:px-4">
        <div
          aria-busy={isLoading}
          className={cn(
            "h-[286px] min-w-0 transition-opacity",
            isLoading && "opacity-55"
          )}
          ref={ref}
        >
          {width > 0 ? (
            <LineChart
              data={trends.buckets}
              height={286}
              margin={{ bottom: 0, left: 0, right: 6, top: 8 }}
              width={width}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="label"
                interval="preserveStartEnd"
                minTickGap={34}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                tickFormatter={(value) =>
                  formatAxisLabel(String(value), trends.granularity)
                }
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                tickLine={false}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "var(--shadow-menu)",
                  fontSize: 12,
                }}
                cursor={{
                  stroke: "var(--muted-foreground)",
                  strokeDasharray: "3 3",
                  strokeOpacity: 0.45,
                }}
                formatter={(value) => [
                  `${Number(value).toLocaleString()} ${
                    trends.unit === "images"
                      ? copy("images", "张")
                      : copy("seconds", "秒")
                  }`,
                  metricLabel,
                ]}
                labelStyle={{ color: "var(--popover-foreground)" }}
              />
              <Line
                activeDot={{ r: 4, strokeWidth: 0 }}
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                stroke="var(--chart-1)"
                strokeWidth={2.25}
                type="monotone"
              />
            </LineChart>
          ) : (
            <div className="h-full animate-pulse rounded-md bg-muted/35" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** 渲染当前范围内图片任务与视频任务的活动分布饼图。 */
export function ActivityDistributionChart({
  distribution,
  isZh,
}: ActivityDistributionChartProps) {
  const { ref, width } = useElementWidth();
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const data = [
    {
      name: copy("Image tasks", "生图任务"),
      value: distribution.imageTasks,
      color: "var(--chart-1)",
    },
    {
      name: copy("Video tasks", "生视频任务"),
      value: distribution.videoTasks,
      color: "var(--chart-3)",
    },
  ];

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="border-b pb-5">
        <CardTitle className="font-serif text-lg font-medium tracking-tight">
          {copy("Activity distribution", "活动分布")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {copy("Within the selected range", "所选时间范围内")}
        </p>
      </CardHeader>
      <CardContent className="grid min-h-[286px] items-center gap-2 py-5 sm:grid-cols-[minmax(210px,1fr)_minmax(150px,.7fr)]">
        <div className="relative h-[230px] min-w-0" ref={ref}>
          {distribution.totalTasks === 0 ? (
            <div className="absolute inset-0 m-auto flex size-44 items-center justify-center rounded-full border bg-muted/20 px-8 text-center text-xs text-muted-foreground">
              {copy("No activity in this range", "该范围暂无活动")}
            </div>
          ) : width > 0 ? (
            <PieChart height={230} width={width}>
              <Pie
                cx="50%"
                cy="50%"
                data={data}
                dataKey="value"
                isAnimationActive={false}
                nameKey="name"
                outerRadius={92}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {data.map((entry) => (
                  <Cell fill={entry.color} key={entry.name} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "var(--shadow-menu)",
                  fontSize: 12,
                }}
                formatter={(value) => [
                  Number(value).toLocaleString(),
                  copy("Tasks", "任务数"),
                ]}
              />
            </PieChart>
          ) : (
            <div className="h-full animate-pulse rounded-full bg-muted/35" />
          )}
        </div>
        <div className="space-y-4">
          {data.map((item) => {
            const percentage =
              distribution.totalTasks > 0
                ? (item.value / distribution.totalTasks) * 100
                : 0;
            return (
              <div className="space-y-1.5" key={item.name}>
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.name}
                  </span>
                  <span className="font-medium tabular-nums">
                    {percentage.toFixed(1)}%
                  </span>
                </div>
                <p className="pl-4 text-[11px] text-muted-foreground">
                  {item.value.toLocaleString()} {copy("tasks", "个任务")}
                </p>
              </div>
            );
          })}
          <div className="border-t pt-3 text-xs text-muted-foreground">
            {copy("Total", "合计")}：
            <span className="font-medium text-foreground tabular-nums">
              {distribution.totalTasks.toLocaleString()}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
