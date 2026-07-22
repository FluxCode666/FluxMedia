/** 钱包支付提示 URL 清理测试：锁定一次性参数与购买上下文的边界。 */

import { describe, expect, it } from "vitest";

import { removeWalletPaymentNoticeParams } from "./wallet-payment-notice-url";

describe("wallet payment notice URL", () => {
  it("移除支付结果并保留购买上下文与 hash", () => {
    expect(
      removeWalletPaymentNoticeParams(
        new URL(
          "https://flux.example/zh/dashboard/wallet?purchase=top-up&pay=success&success=true#purchase"
        )
      )
    ).toBe("/zh/dashboard/wallet?purchase=top-up#purchase");
  });

  it("不移除其他查询参数", () => {
    expect(
      removeWalletPaymentNoticeParams(
        new URL("https://flux.example/dashboard/wallet?source=return&pay=fail")
      )
    ).toBe("/dashboard/wallet?source=return");
  });
});
