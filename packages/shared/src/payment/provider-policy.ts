/**
 * 运行时支付通道及产品能力策略。
 *
 * 使用方：运行时配置、Epay 适配器、钱包购买能力与订阅 checkout。
 * 这里只判断通道产品支持，不读取密钥或系统设置 readiness。
 */
export const RUNTIME_PAYMENT_PROVIDERS = [
  "creem",
  "epay",
  "alipay_f2f",
  "none",
] as const;

export type RuntimePaymentProvider = (typeof RUNTIME_PAYMENT_PROVIDERS)[number];
export type SubscriptionProviderCapability =
  | "supported"
  | "disabled"
  | "unsupported";

/** 判断运行时支付通道是否承载订阅 checkout，不检查密钥 readiness。 */
export function getSubscriptionProviderCapability(
  provider: RuntimePaymentProvider
): SubscriptionProviderCapability {
  if (provider === "none") return "disabled";
  return provider === "alipay_f2f" ? "unsupported" : "supported";
}
