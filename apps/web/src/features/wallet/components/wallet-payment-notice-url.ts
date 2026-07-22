/**
 * 钱包支付提示 URL 清理器。
 *
 * 使用方：钱包支付提示客户端组件。只移除已消费的支付结果参数，
 * 保留购买 Tab、其他查询参数和 hash，不触发导航或支付履约。
 */

/**
 * 从当前钱包 URL 中移除一次性支付结果。
 *
 * @param currentUrl 浏览器当前的完整 URL。
 * @returns 供 history.replaceState 使用的同源相对 URL。
 * @sideEffects 无；不修改传入 URL。
 */
export function removeWalletPaymentNoticeParams(currentUrl: URL): string {
  const nextUrl = new URL(currentUrl.toString());
  nextUrl.searchParams.delete("pay");
  nextUrl.searchParams.delete("success");
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}
