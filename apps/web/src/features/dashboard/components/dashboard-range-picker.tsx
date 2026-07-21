"use client";

/**
 * Dashboard 趋势的连体时间范围选择器。
 *
 * 小时与按天粒度共用同一个弹层：常用预设集中在快速选择区，自定义开始/结束值和
 * 应用按钮组成一个连续控件，避免范围下拉与日期输入分散在两行。
 */
import type { AnalyticsGranularity } from "@repo/shared/analytics/contracts";
import { Button } from "@repo/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { cn } from "@repo/ui/utils";
import { ArrowRight, CalendarDays, Check, ChevronDown } from "lucide-react";
import { useState } from "react";

export type HourlyRange = "last24Hours" | "last48Hours" | "custom";
export type DailyRange =
  | "last7Days"
  | "currentMonth"
  | "currentQuarter"
  | "currentYear"
  | "custom";

type DashboardRangePickerProps = {
  customDailyEnd: string;
  customDailyStart: string;
  customHourlyEnd: string;
  customHourlyStart: string;
  dailyRange: DailyRange;
  disabled: boolean;
  granularity: AnalyticsGranularity;
  hourlyRange: HourlyRange;
  isZh: boolean;
  onApplyCustomRange: () => Promise<boolean>;
  onCustomDailyEndChange: (value: string) => void;
  onCustomDailyStartChange: (value: string) => void;
  onCustomHourlyEndChange: (value: string) => void;
  onCustomHourlyStartChange: (value: string) => void;
  onDailyRangeChange: (value: string) => void;
  onHourlyRangeChange: (value: string) => void;
};

/** 返回当前粒度和范围对应的触发器文案。 */
function getRangeLabel(
  granularity: AnalyticsGranularity,
  hourlyRange: HourlyRange,
  dailyRange: DailyRange,
  copy: (en: string, zh: string) => string
): string {
  if (granularity === "hour") {
    if (hourlyRange === "last48Hours") {
      return copy("Last 48 hours", "近 48 小时");
    }
    if (hourlyRange === "custom") {
      return copy("Custom time range", "自定义时间范围");
    }
    return copy("Last 24 hours", "近 24 小时");
  }

  const labels: Record<DailyRange, string> = {
    last7Days: copy("Last 7 days", "近 7 天"),
    currentMonth: copy("This month", "本月"),
    currentQuarter: copy("This quarter", "本季度"),
    currentYear: copy("This year", "本年"),
    custom: copy("Custom date range", "自定义日期范围"),
  };
  return labels[dailyRange];
}

/** 渲染快速预设与连体自定义范围控件。 */
export function DashboardRangePicker({
  customDailyEnd,
  customDailyStart,
  customHourlyEnd,
  customHourlyStart,
  dailyRange,
  disabled,
  granularity,
  hourlyRange,
  isZh,
  onApplyCustomRange,
  onCustomDailyEndChange,
  onCustomDailyStartChange,
  onCustomHourlyEndChange,
  onCustomHourlyStartChange,
  onDailyRangeChange,
  onHourlyRangeChange,
}: DashboardRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const isHourly = granularity === "hour";
  const selectedRange = isHourly ? hourlyRange : dailyRange;
  const quickOptions = isHourly
    ? [
        { label: copy("Last 24 hours", "近 24 小时"), value: "last24Hours" },
        { label: copy("Last 48 hours", "近 48 小时"), value: "last48Hours" },
      ]
    : [
        { label: copy("Last 7 days", "近 7 天"), value: "last7Days" },
        { label: copy("This month", "本月"), value: "currentMonth" },
        {
          label: copy("This quarter", "本季度"),
          value: "currentQuarter",
        },
        { label: copy("This year", "本年"), value: "currentYear" },
      ];
  const customStart = isHourly ? customHourlyStart : customDailyStart;
  const customEnd = isHourly ? customHourlyEnd : customDailyEnd;

  /** 选择快速范围后立即提交并关闭弹层。 */
  const selectQuickRange = (value: string) => {
    if (selectedRange === value) {
      setIsOpen(false);
      return;
    }
    if (isHourly) onHourlyRangeChange(value);
    else onDailyRangeChange(value);
    setIsOpen(false);
  };

  /** 校验并提交自定义范围；校验或查询失败时保留弹层供用户调整。 */
  const applyCustomRange = async () => {
    if (await onApplyCustomRange()) setIsOpen(false);
  };

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={isOpen}
          className="w-full min-w-48 justify-between font-normal sm:w-auto"
          disabled={disabled}
          id="usage-range"
          type="button"
          variant="outline"
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="truncate">
              {getRangeLabel(granularity, hourlyRange, dailyRange, copy)}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[calc(100vw-2rem)] max-w-[30rem] overflow-hidden p-0"
      >
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">
            {isHourly
              ? copy("Select time range", "选择时间范围")
              : copy("Select date range", "选择日期范围")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {copy(
              "Choose a preset or define a custom range.",
              "可使用快速选择，也可以设置自定义范围。"
            )}
          </p>
        </div>

        <div className="space-y-4 p-4">
          <section aria-labelledby="usage-range-quick-label">
            <p
              className="mb-2 text-xs font-medium text-muted-foreground"
              id="usage-range-quick-label"
            >
              {copy("Quick select", "快速选择")}
            </p>
            <div className="grid grid-cols-2 overflow-hidden rounded-md border bg-background">
              {quickOptions.map((option, index) => {
                const isSelected = selectedRange === option.value;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-2 px-3 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                      index % 2 === 0 && "border-r",
                      index >= 2 && "border-t",
                      isSelected && "bg-muted font-medium text-foreground"
                    )}
                    disabled={disabled}
                    key={option.value}
                    onClick={() => selectQuickRange(option.value)}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "size-4 text-foreground",
                        !isSelected && "invisible"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="usage-range-custom-label">
            <p
              className="mb-2 text-xs font-medium text-muted-foreground"
              id="usage-range-custom-label"
            >
              {copy("Custom range", "自定义范围")}
            </p>
            <div className="overflow-hidden rounded-md border bg-background">
              <div className="grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <label className="min-w-0 px-3 py-2.5">
                  <span className="block text-[11px] font-medium text-muted-foreground">
                    {copy("Start", "开始")}
                  </span>
                  <input
                    className="mt-1 h-7 w-full min-w-0 rounded-sm bg-transparent text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={disabled}
                    onChange={(event) =>
                      isHourly
                        ? onCustomHourlyStartChange(event.target.value)
                        : onCustomDailyStartChange(event.target.value)
                    }
                    type={isHourly ? "datetime-local" : "date"}
                    value={customStart}
                  />
                </label>
                <div className="hidden items-center border-x bg-muted/30 px-2 text-muted-foreground sm:flex">
                  <ArrowRight aria-hidden="true" className="size-4" />
                </div>
                <label className="min-w-0 border-t px-3 py-2.5 sm:border-t-0">
                  <span className="block text-[11px] font-medium text-muted-foreground">
                    {copy("End", "结束")}
                  </span>
                  <input
                    className="mt-1 h-7 w-full min-w-0 rounded-sm bg-transparent text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={disabled}
                    onChange={(event) =>
                      isHourly
                        ? onCustomHourlyEndChange(event.target.value)
                        : onCustomDailyEndChange(event.target.value)
                    }
                    type={isHourly ? "datetime-local" : "date"}
                    value={customEnd}
                  />
                </label>
              </div>
              <Button
                className="h-10 w-full rounded-none border-x-0 border-b-0 shadow-none"
                disabled={disabled}
                onClick={() => void applyCustomRange()}
                type="button"
                variant="outline"
              >
                {copy("Apply custom range", "应用自定义范围")}
              </Button>
            </div>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
