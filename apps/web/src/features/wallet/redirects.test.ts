/** 钱包支付回跳 helper 测试：锁定同源钱包目标并拒绝任意客户端 URL。 */
import { describe, expect, it } from "vitest";

import {
  createWalletCheckoutRedirects,
  createWalletPaymentResultUrl,
} from "./redirects";

describe("wallet payment redirects", () => {
  it("生成同源钱包 success/cancel 与 Epay return 目标", () => {
    expect(createWalletCheckoutRedirects("https://flux.example/base")).toEqual({
      successUrl: "https://flux.example/dashboard/wallet?pay=success",
      cancelUrl: "https://flux.example/dashboard/wallet?pay=canceled",
      returnUrl: "https://flux.example/api/payments/epay/return",
    });
  });

  it("只允许白名单支付状态进入钱包 URL", () => {
    expect(
      createWalletPaymentResultUrl("processing", "https://flux.example")
    ).toBe("https://flux.example/dashboard/wallet?pay=processing");
    expect(
      createWalletPaymentResultUrl(
        "https://evil.example",
        "https://flux.example"
      )
    ).toBe("https://flux.example/dashboard/wallet");
  });
});
