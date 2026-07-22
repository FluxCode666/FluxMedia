/**
 * 钱包购买能力矩阵纯逻辑。
 *
 * 使用方：钱包购买区与 DB-free 单测。该模块只决定呈现模式，不读取配置或发起支付。
 */

type PurchaseCapability =
  | { status: "ready"; enabled: boolean }
  | { status: "error" };

export type WalletPurchaseMode =
  | "hidden"
  | "error"
  | "top-up"
  | "subscription"
  | "tabs";

export type WalletPurchaseLayout = {
  mode: WalletPurchaseMode;
  hasError: boolean;
};

/**
 * 将两种独立购买能力解析为唯一布局。
 *
 * @param topUp 按金额充值的读取状态与启用状态。
 * @param subscription 订阅购买的读取状态与启用状态。
 * @returns 呈现模式及是否需要同时展示读取失败提示。
 */
export function resolveWalletPurchaseLayout(
  topUp: PurchaseCapability,
  subscription: PurchaseCapability
): WalletPurchaseLayout {
  const topUpEnabled = topUp.status === "ready" && topUp.enabled;
  const subscriptionEnabled =
    subscription.status === "ready" && subscription.enabled;
  const hasError = topUp.status === "error" || subscription.status === "error";

  if (topUpEnabled && subscriptionEnabled) {
    return { mode: "tabs", hasError };
  }
  if (topUpEnabled) return { mode: "top-up", hasError };
  if (subscriptionEnabled) return { mode: "subscription", hasError };
  if (hasError) return { mode: "error", hasError };
  return { mode: "hidden", hasError };
}
