/**
 * 使用日志页的默认折叠价格趋势。
 *
 * 使用方：使用日志路由。只有用户明确展开时才挂载现有的懒加载图表，保留既有定价
 * 数据口径，并将价格数据读取失败隔离在本卡内，不影响请求日志。
 */
"use client";

import { Button } from "@repo/ui/components/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { ImagePricingChartCardLazy } from "@/features/billing/components/image-pricing-chart-card-lazy";
import type { ImagePricingCardData } from "@/features/billing/image-pricing-card-data";
import { Link } from "@/i18n/routing";

import type { UsageLogCopy } from "./usage-log-copy";

type UsageLogPricingTrendsProps = {
  copy: UsageLogCopy;
  data: ImagePricingCardData | null;
  isZh: boolean;
  retryHref: string;
};

/**
 * 渲染默认收起的旧价格趋势内容。
 *
 * @param props 图表公开数据、失败重试 URL 和本地化文案。
 * @returns 可展开卡片；失败时只显示安全提示与同页重试入口。
 * @sideEffects 用户展开时初始化图表组件及其懒加载代码块。
 */
export function UsageLogPricingTrends({
  copy,
  data,
  isZh,
  retryHref,
}: UsageLogPricingTrendsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-serif text-xl font-medium">
            {copy.pricing.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy.pricing.description}
          </p>
        </div>
        <Button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
          type="button"
          variant="outline"
        >
          {isExpanded ? (
            <ChevronDown className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {isExpanded ? copy.pricing.hide : copy.pricing.show}
        </Button>
      </div>
      {isExpanded ? (
        <div className="border-t p-5" id={contentId}>
          {data ? (
            <ImagePricingChartCardLazy
              billing={data.billing}
              isZh={isZh}
              pricing={data.pricing}
            />
          ) : (
            <div className="space-y-3" role="alert">
              <p className="text-sm text-destructive">{copy.pricing.error}</p>
              <Link className="text-sm font-medium underline" href={retryHref}>
                {copy.pricing.retry}
              </Link>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
