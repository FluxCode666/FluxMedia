/**
 * 账单与用量路由页。
 *
 * 使用方是用户 Dashboard 导航；关键依赖为会话鉴权、应用时区、
 * 积分用量和仅在 Usage 分支执行的生图计价 loader。
 */

import { getServerSession } from "@repo/shared/auth/server";
import { CreditUsageSection } from "@repo/shared/credits/components";
import { getUserTimeZone } from "@repo/shared/time-zone/server";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { loadBillingPageData } from "@/features/billing/billing-page-data";
import { ImagePricingChartCardLazy } from "@/features/billing/components/image-pricing-chart-card-lazy";
import { loadImagePricingCardData } from "@/features/billing/image-pricing-card-data";
import { BillingSection } from "@/features/settings/components/billing-section";

import { BillingTabsNav } from "./billing-tabs-nav";

export const metadata = {
  title: "Billing & Usage | FluxMedia",
  description:
    "Manage subscriptions, billing history, credit usage, and image pricing",
};

type BillingPageProps = {
  searchParams: Promise<{ tab?: string }>;
};

/** Tab 内容区入场：切换 tab 时淡入，尊重系统减少动态偏好 */
const tabContentClass =
  "mt-6 animate-in fade-in duration-300 motion-reduce:animate-none";

/**
 * 渲染账单与用量页，并仅为 URL 中的活动页签加载服务端数据。
 *
 * @param props Next.js 异步查询参数。
 * @returns 当前账单或用量内容；未鉴权时重定向登录页。
 */
export default async function BillingPage({ searchParams }: BillingPageProps) {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const pageData = await loadBillingPageData(
    (await searchParams).tab,
    session.user.id,
    loadImagePricingCardData
  );
  const { activeTab } = pageData;
  const [t, tTabs, timeZone] = await Promise.all([
    getTranslations("Settings.billing"),
    getTranslations("Settings.billing.tabs"),
    getUserTimeZone(session.user.id),
  ]);
  let activeContent: ReactNode;

  if (pageData.activeTab === "usage") {
    activeContent = (
      <div className="space-y-6">
        <CreditUsageSection timeZone={timeZone} />
        <ImagePricingChartCardLazy
          billing={pageData.pricingCardData.billing}
          isZh={locale === "zh"}
          pricing={pageData.pricingCardData.pricing}
        />
      </div>
    );
  } else {
    activeContent = <BillingSection timeZone={timeZone} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <BillingTabsNav
        activeTab={activeTab}
        billingLabel={tTabs("billing")}
        usageLabel={tTabs("usage")}
      />
      <div className={tabContentClass}>{activeContent}</div>
    </div>
  );
}
