/**
 * 订阅结账服务。
 *
 * 使用方：subscription.createCheckout 的 app-level UOL binding。该服务保留既有
 * Creem/Epay 订单、升级报价与日志语义，只接受服务端确认的 userId 和 priceId；
 * 支付渠道与回跳目标均从服务端运行时配置解析。
 */
import { db } from "@repo/database";
import { subscription } from "@repo/database/schema";
import { findRuntimePlanByPriceId } from "@repo/shared/config/payment-runtime";
import { logEvent } from "@repo/shared/logger";
import {
  createRuntimeEpayPurchase,
  getRuntimePaymentProvider,
  saveEpayOrder,
} from "@repo/shared/payment/epay";
import { getSubscriptionProviderCapability } from "@repo/shared/payment/provider-policy";
import type {
  SubscriptionCheckoutInput,
  SubscriptionCheckoutOutput,
} from "@repo/shared/subscription/checkout-contract";
import { eq } from "drizzle-orm";
import { assertRuntimeCreemCheckoutConfigured, creem } from "./creem";
import { createSubscriptionCheckoutQuote } from "./subscription-upgrade";
import { createWalletCheckoutRedirects } from "../wallet/redirects";

export type { SubscriptionCheckoutOutput } from "@repo/shared/subscription/checkout-contract";

export type SubscriptionCheckoutErrorReason =
  | "payment_disabled"
  | "subscription_not_supported"
  | "provider_unavailable";

/** 可安全映射到传输层的订阅结账业务错误，不携带上游响应或支付配置。 */
export class SubscriptionCheckoutError extends Error {
  readonly reason: SubscriptionCheckoutErrorReason;

  constructor(reason: SubscriptionCheckoutErrorReason, message: string) {
    super(message);
    this.name = "SubscriptionCheckoutError";
    this.reason = reason;
  }
}

/**
 * 从 UOL 兼容输入中选出唯一可信的结账参数。
 *
 * @param userId 当前已鉴权 user Principal 的用户 ID。
 * @param input UOL 已校验但仍不可信的客户端输入。
 * @returns 只含 Principal userId 与 priceId，不保留客户端渠道和回跳覆盖。
 */
export function selectTrustedSubscriptionCheckoutInput(
  userId: string,
  input: SubscriptionCheckoutInput
): { userId: string; priceId: string } {
  return { userId, priceId: input.priceId };
}

type SubscriptionSnapshot = {
  userId: string;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  status: string;
};

/**
 * 判断订阅在当前时间是否仍有效。
 *
 * lifetime 始终有效；active/trialing 需处于有效期内；已取消但尚未到期的订阅仍
 * 参与升级报价。非法日期自然按已过期处理，不产生额外副作用。
 */
function isSubscriptionCurrentlyActive(sub: SubscriptionSnapshot): boolean {
  if (sub.status === "lifetime") return true;
  const withinPeriod =
    !sub.currentPeriodEnd || sub.currentPeriodEnd > new Date();
  return (
    (["active", "trialing"].includes(sub.status) && withinPeriod) ||
    (sub.status === "canceled" &&
      Boolean(sub.currentPeriodEnd) &&
      withinPeriod)
  );
}

/**
 * 为当前用户创建唯一订阅结账。
 *
 * @param userId 当前 session 用户 ID，只能由 UOL Principal 提供。
 * @param priceId 经过 UOL schema 校验的目标运行时价格 ID。
 * @returns Creem redirect 或 Epay form POST 参数；不返回 provider 密钥。
 * @throws 支付关闭、provider 不支持/未配置、价格无效或升级不合法时拒绝；Epay
 *   会先持久化 pending 订单再生成签名表单，Creem 会直接调用远程 checkout。
 */
export async function createSubscriptionCheckout(
  userId: string,
  priceId: string
): Promise<SubscriptionCheckoutOutput> {
  const paymentProvider = await getRuntimePaymentProvider();
  const providerCapability =
    getSubscriptionProviderCapability(paymentProvider);
  if (providerCapability === "disabled") {
    throw new SubscriptionCheckoutError(
      "payment_disabled",
      "支付功能当前未启用"
    );
  }
  if (providerCapability === "unsupported") {
    throw new SubscriptionCheckoutError(
      "subscription_not_supported",
      "支付宝当面付仅支持按金额充值，暂不支持订阅套餐支付"
    );
  }

  const [existingSub] = await db
    .select({
      userId: subscription.userId,
      priceId: subscription.priceId,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      status: subscription.status,
    })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .limit(1);

  const { plan, price } = await findRuntimePlanByPriceId(priceId);
  if (!plan || !price) {
    throw new Error("无效的价格 ID");
  }

  const hasActiveSub =
    existingSub && isSubscriptionCurrentlyActive(existingSub);
  const upgradeQuote = hasActiveSub
    ? await createSubscriptionCheckoutQuote(existingSub, priceId)
    : null;
  const useEpay = paymentProvider === "epay";
  if (!useEpay) {
    try {
      await assertRuntimeCreemCheckoutConfigured();
    } catch {
      throw new SubscriptionCheckoutError(
        "provider_unavailable",
        "Creem 支付通道未完整配置，请联系管理员填写 API Key 和 Webhook Secret"
      );
    }
  }

  logEvent("payment.checkout.started", {
    userId,
    priceId,
    planId: plan.id,
    provider: paymentProvider,
    checkoutMode: upgradeQuote ? "upgrade" : "new_subscription",
    amountDue: upgradeQuote?.amountDue ?? price.amount,
    prorationCredit: upgradeQuote?.prorationCredit,
  });

  const redirects = createWalletCheckoutRedirects();
  if (useEpay) {
    const outTradeNo = `SUB${Date.now()}${crypto.randomUUID().slice(0, 8)}`;
    const amountDue = upgradeQuote?.amountDue ?? price.amount;
    const metadata = {
      type: "subscription" as const,
      userId,
      outTradeNo,
      priceId,
      planId: plan.id,
      checkoutMode: upgradeQuote
        ? ("upgrade" as const)
        : ("new_subscription" as const),
      expectedAmount: amountDue,
      originalAmount: upgradeQuote?.originalAmount ?? price.amount,
      prorationCredit: upgradeQuote?.prorationCredit ?? 0,
      remainingDays: upgradeQuote?.remainingDays ?? 0,
      periodDays: upgradeQuote?.periodDays ?? 0,
      upgradeFromPriceId: upgradeQuote?.upgradeFromPriceId,
    };
    await saveEpayOrder(metadata, amountDue);
    const checkout = await createRuntimeEpayPurchase({
      outTradeNo,
      name: upgradeQuote
        ? `FluxMedia upgrade to ${plan.name} ${price.interval ?? "subscription"}`
        : `FluxMedia ${plan.name} ${price.interval ?? "subscription"}`,
      money: amountDue,
      returnUrl: redirects.returnUrl,
    });

    return {
      kind: "form_post",
      url: checkout.url,
      fields: checkout.params,
    };
  }

  if (hasActiveSub) {
    throw new Error("当前支付通道暂不支持自动补差升级，请联系管理员处理");
  }

  const checkout = await creem.createCheckout({
    product_id: priceId,
    success_url: redirects.successUrl,
    request_id: `${userId}_${Date.now()}`,
    metadata: {
      userId,
      planId: plan.id,
    },
  });

  return { kind: "redirect", url: checkout.checkout_url };
}
