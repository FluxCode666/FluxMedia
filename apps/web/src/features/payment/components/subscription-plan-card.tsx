/**
 * 钱包订阅套餐卡。
 *
 * 使用方：钱包购买区。服务端决定套餐和价格资格；组件只选择已返回的价格并调用
 * 兼容 createCheckoutSession，Creem redirect 与 Epay POST form 行为保持不变。
 */
"use client";

import type { SubscriptionPurchaseOptions } from "@repo/shared/subscription/purchase-contract";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Check, Loader2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { createCheckoutSession } from "@/features/payment/actions";
import type { WalletCopy } from "@/features/wallet/components/wallet-copy";
import { getInitialSubscriptionPriceId } from "./subscription-plan-card-logic";

type SubscriptionPlan = SubscriptionPurchaseOptions["plans"][number];

type SubscriptionPlanCardProps = {
  copy: WalletCopy;
  currency: string;
  locale: string;
  plan: SubscriptionPlan;
};

/** 以临时 POST form 提交 Epay 签名字段，提交后立即清理 DOM。 */
function submitEpayForm(url: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.action = url;
  form.method = "POST";
  form.hidden = true;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/** 渲染单个套餐、周期选择和结账按钮；不可购买原因只使用稳定服务端状态。 */
export function SubscriptionPlanCard({
  copy,
  currency,
  locale,
  plan,
}: SubscriptionPlanCardProps) {
  const [priceId, setPriceId] = useState(
    getInitialSubscriptionPriceId(plan.prices) ?? ""
  );
  const selectedPrice =
    plan.prices.find((price) => price.priceId === priceId) ?? plan.prices[0];
  const { execute, isPending } = useAction(createCheckoutSession, {
    onSuccess: ({ data }) => {
      if (!data?.url) return;
      if (data.method === "POST" && data.params) {
        submitEpayForm(data.url, data.params);
        return;
      }
      window.location.assign(data.url);
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? copy.checkoutFailed);
    },
  });

  /** 只提交服务端返回的 priceId；provider 和回跳目标不会由浏览器覆盖。 */
  function startCheckout(): void {
    if (!plan.canCheckout || !selectedPrice) return;
    execute({ priceId: selectedPrice.priceId });
  }

  const unavailableLabel =
    plan.checkoutReason === "current_plan"
      ? copy.currentPlan
      : copy.unavailable;

  return (
    <article className="flex h-full flex-col rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl font-medium">{plan.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan.description}
          </p>
        </div>
        {plan.popular ? <Badge>{copy.popular}</Badge> : null}
      </div>

      <ul className="my-5 flex-1 space-y-2 text-sm">
        {plan.features.map((feature) => (
          <li className="flex gap-2" key={`${plan.id}-${feature}`}>
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.prices.length > 1 ? (
        <label className="mb-4 block space-y-2 text-sm font-medium">
          <span className="sr-only">{plan.name}</span>
          <select
            className="h-10 w-full rounded-md border bg-background px-3"
            onChange={(event) => setPriceId(event.target.value)}
            value={selectedPrice?.priceId ?? ""}
          >
            {plan.prices.map((price) => (
              <option key={price.priceId} value={price.priceId}>
                {price.interval === "monthly" ? copy.monthly : copy.yearly} ·{" "}
                {new Intl.NumberFormat(locale, {
                  currency,
                  style: "currency",
                }).format(price.amount)}
              </option>
            ))}
          </select>
        </label>
      ) : selectedPrice ? (
        <p className="mb-4 text-lg font-semibold tabular-nums">
          {new Intl.NumberFormat(locale, {
            currency,
            style: "currency",
          }).format(selectedPrice.amount)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            /{selectedPrice.interval === "monthly" ? copy.monthly : copy.yearly}
          </span>
        </p>
      ) : null}

      <Button
        disabled={!plan.canCheckout || !selectedPrice || isPending}
        onClick={startCheckout}
        type="button"
        variant={plan.highlighted ? "default" : "outline"}
      >
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {plan.canCheckout ? copy.subscribe : unavailableLabel}
      </Button>
    </article>
  );
}
