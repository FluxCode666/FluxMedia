/**
 * 账单与用量页的服务端分支数据选择器。
 *
 * Billing 路由使用本模块把不可信 URL 页签收窄为固定联合类型，并保证只有 Usage
 * 分支调用生图计价 loader。依赖通过参数注入，便于在 DB-free 测试中验证调用次数。
 */

import type { ImagePricingCardData } from "./image-pricing-card-data";

export type BillingTab = "billing" | "usage";

type ImagePricingCardLoader = (userId: string) => Promise<ImagePricingCardData>;

export type BillingPageData =
  | {
      activeTab: "billing";
      pricingCardData: null;
    }
  | {
      activeTab: "usage";
      pricingCardData: ImagePricingCardData;
    };

/**
 * 将外部 URL 参数收窄为受支持的页签。
 *
 * @param value URL 中未信任的 `tab` 值。
 * @returns 仅包含 billing 或 usage 的安全页签；非法值回退到 billing。
 */
export function resolveBillingTab(value: string | undefined): BillingTab {
  return value === "usage" ? "usage" : "billing";
}

/**
 * 为当前页签加载最小服务端数据。
 *
 * @param tab URL 中未信任的 `tab` 值。
 * @param userId 已鉴权会话的用户 ID。
 * @param loadPricingCardData Usage 分支的生图计价 loader。
 * @returns 活动页签和可选计价卡数据；Billing 分支不调用 loader，Usage 失败则原样上抛。
 */
export async function loadBillingPageData(
  tab: string | undefined,
  userId: string,
  loadPricingCardData: ImagePricingCardLoader
): Promise<BillingPageData> {
  const activeTab = resolveBillingTab(tab);
  if (activeTab === "billing") {
    return { activeTab, pricingCardData: null };
  }
  return {
    activeTab,
    pricingCardData: await loadPricingCardData(userId),
  };
}
