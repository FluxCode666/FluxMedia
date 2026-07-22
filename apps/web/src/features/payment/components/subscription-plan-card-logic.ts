/**
 * 订阅套餐卡的价格选择纯逻辑。
 *
 * 使用方：订阅套餐卡。这里只选择服务端已授权公开的价格，不判断结账资格。
 */
import type { SubscriptionPurchaseOptions } from "@repo/shared/subscription/purchase-contract";

type SubscriptionPrice =
  SubscriptionPurchaseOptions["plans"][number]["prices"][number];

/**
 * 选择套餐卡首次展示的价格。
 *
 * @param prices 服务端已过滤的可展示价格。
 * @returns 月付 priceId；无月付时返回首项；无价格时返回 null。
 */
export function getInitialSubscriptionPriceId(
  prices: SubscriptionPrice[]
): string | null {
  return (
    prices.find((price) => price.interval === "monthly")?.priceId ??
    prices[0]?.priceId ??
    null
  );
}
