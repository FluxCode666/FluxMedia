/**
 * 历史记录页的默认折叠价格趋势卡。
 *
 * 使用方：历史记录服务端页面。折叠态不会挂载图表客户端代码；价格数据失败只影响
 * 本卡，不覆盖已经加载成功的生成记录。
 */
"use client";

import { Button } from "@repo/ui/components/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { ImagePricingChartCardLazy } from "@/features/billing/components/image-pricing-chart-card-lazy";
import type { ImagePricingCardData } from "@/features/billing/image-pricing-card-data";
import { Link } from "@/i18n/routing";

type HistoryPricingTrendsProps = {
  data: ImagePricingCardData | null;
  isZh: boolean;
  retryHref: string;
};

/**
 * 渲染可展开的价格趋势，默认保持收起。
 *
 * @param props 当前用户的计价卡数据、语言和同页重试地址。
 * @returns 独立失败边界的折叠卡片。
 */
export function HistoryPricingTrends({
  data,
  isZh,
  retryHref,
}: HistoryPricingTrendsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="font-serif text-xl font-medium">
            {copy("Pricing trends", "价格趋势")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy(
              "Review the current image pricing for your plan and backend group.",
              "查看当前套餐与后端分组对应的生图价格。"
            )}
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
          {isExpanded ? copy("Hide", "收起") : copy("Show", "展开")}
        </Button>
      </div>
      {isExpanded ? (
        <div className="border-t p-5" id={contentId}>
          {data ? (
            <ImagePricingChartCardLazy {...data} isZh={isZh} />
          ) : (
            <div className="space-y-3" role="alert">
              <p className="text-sm text-destructive">
                {copy(
                  "Pricing data could not be loaded.",
                  "价格数据加载失败。"
                )}
              </p>
              <Link className="text-sm font-medium underline" href={retryHref}>
                {copy("Retry", "重试")}
              </Link>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
