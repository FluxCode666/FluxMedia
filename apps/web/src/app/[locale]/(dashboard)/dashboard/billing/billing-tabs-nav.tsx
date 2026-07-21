/**
 * 账单与用量页的 URL 驱动页签导航。
 *
 * 使用方是 Billing 服务端页面。每个触发器都是真实链接，使刷新、
 * 直接访问以及浏览器前进后退都能从 `tab` 查询参数恢复状态。
 */

import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/tabs";

import type { BillingTab } from "@/features/billing/billing-page-data";
import { Link } from "@/i18n/routing";

type BillingTabsNavProps = {
  activeTab: BillingTab;
  billingLabel: string;
  usageLabel: string;
};

/**
 * 渲染以 URL 为状态真相的账单页签导航。
 *
 * @param props 当前服务端解析的页签与双语标签。
 * @returns 具有 Radix 活动态样式的可导航页签。
 */
export function BillingTabsNav({
  activeTab,
  billingLabel,
  usageLabel,
}: BillingTabsNavProps) {
  return (
    <Tabs value={activeTab} className="w-full">
      <div className="border-b border-border/60 pb-2">
        <TabsList className="h-auto gap-1 bg-transparent p-0">
          <TabsTrigger value="billing" className={tabTriggerClass} asChild>
            <Link href="/dashboard/billing?tab=billing" scroll={false}>
              {billingLabel}
            </Link>
          </TabsTrigger>
          <TabsTrigger value="usage" className={tabTriggerClass} asChild>
            <Link href="/dashboard/billing?tab=usage" scroll={false}>
              {usageLabel}
            </Link>
          </TabsTrigger>
        </TabsList>
      </div>
    </Tabs>
  );
}

/** 页签触发器与设置页保持一致的单色激活态。 */
const tabTriggerClass =
  "rounded-md border border-transparent px-4 py-2 transition-colors duration-150 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none";
