/** 钱包购买区：按能力四态选择隐藏、直出或双 Tab，不承载支付履约状态机。 */
"use client";

import type { WalletTopUpOptions } from "@repo/shared/credits/wallet-contract";
import type { SubscriptionPurchaseOptions } from "@repo/shared/subscription/purchase-contract";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";

import { SubscriptionPlanCard } from "@/features/payment/components/subscription-plan-card";
import { TopUpPurchasePanel } from "@/features/payment/components/top-up-purchase-panel";
import type { WalletDataSection } from "../wallet-page-data";
import { resolveWalletPurchaseLayout } from "./purchase-layout";
import type { WalletCopy } from "./wallet-copy";

type WalletPurchaseSectionProps = {
  copy: WalletCopy;
  initialPurchase: "subscription" | "top-up";
  locale: string;
  subscription: WalletDataSection<SubscriptionPurchaseOptions>;
  topUp: WalletDataSection<WalletTopUpOptions>;
};

/** 渲染订阅套餐卡列表；每张卡只消费服务端返回的公开 presenter 数据。 */
function SubscriptionPlans({
  copy,
  locale,
  options,
}: {
  copy: WalletCopy;
  locale: string;
  options: SubscriptionPurchaseOptions;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {options.plans.map((plan) => (
        <SubscriptionPlanCard
          copy={copy}
          currency={options.currency}
          key={plan.id}
          locale={locale}
          plan={plan}
        />
      ))}
    </div>
  );
}

/** 根据充值与订阅能力矩阵渲染购买内容；两者确认关闭时完全隐藏。 */
export function WalletPurchaseSection({
  copy,
  initialPurchase,
  locale,
  subscription,
  topUp,
}: WalletPurchaseSectionProps) {
  const layout = resolveWalletPurchaseLayout(
    topUp.status === "ready"
      ? { status: "ready", enabled: topUp.data.enabled }
      : { status: "error" },
    subscription.status === "ready"
      ? { status: "ready", enabled: subscription.data.enabled }
      : { status: "error" }
  );

  if (layout.mode === "hidden") return null;

  const topUpPanel =
    topUp.status === "ready" && topUp.data.enabled ? (
      <TopUpPurchasePanel copy={copy} locale={locale} options={topUp.data} />
    ) : null;
  const subscriptionPanel =
    subscription.status === "ready" && subscription.data.enabled ? (
      <SubscriptionPlans
        copy={copy}
        locale={locale}
        options={subscription.data}
      />
    ) : null;

  return (
    <section aria-labelledby="wallet-purchase-title" className="space-y-5">
      <div>
        <h2
          className="font-serif text-xl font-medium"
          id="wallet-purchase-title"
        >
          {copy.purchaseTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy.purchaseDescription}
        </p>
      </div>

      {layout.hasError ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          {copy.purchaseError}
        </p>
      ) : null}

      {topUpPanel && subscriptionPanel ? (
        <Tabs
          defaultValue={
            initialPurchase === "subscription" ? "subscription" : "top-up"
          }
        >
          <TabsList aria-label={copy.purchaseTitle}>
            <TabsTrigger value="top-up">{copy.topUpTab}</TabsTrigger>
            <TabsTrigger value="subscription">
              {copy.subscriptionTab}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="top-up">{topUpPanel}</TabsContent>
          <TabsContent value="subscription">{subscriptionPanel}</TabsContent>
        </Tabs>
      ) : (
        (topUpPanel ?? subscriptionPanel)
      )}
    </section>
  );
}
