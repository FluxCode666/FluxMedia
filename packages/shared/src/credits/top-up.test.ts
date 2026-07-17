/** 积分充值报价纯逻辑回归测试：锁定比例、币种小数位与金额边界。 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CREDIT_TOP_UP_CONFIG,
  amountMinorToMajor,
  getCurrencyMinorUnitExponent,
  normalizeCreditTopUpConfig,
  quoteCreditTopUp,
} from "./top-up";

describe("充值币种与比例", () => {
  it("按人民币充值比例报价，¥1 = 10 credits", () => {
    expect(
      quoteCreditTopUp({
        config: DEFAULT_CREDIT_TOP_UP_CONFIG,
        currency: "cny",
        amountMinor: 100,
        provider: "alipay_f2f",
      })
    ).toMatchObject({ amount: 1, creditsAmount: 10, currency: "CNY" });
  });

  it("正确处理零、两位和三位小数币种", () => {
    expect(getCurrencyMinorUnitExponent("JPY")).toBe(0);
    expect(getCurrencyMinorUnitExponent("CNY")).toBe(2);
    expect(getCurrencyMinorUnitExponent("KWD")).toBe(3);
    expect(amountMinorToMajor(1234, "KWD")).toBe(1.234);
  });

  it("拒绝未开放的金额和支付通道", () => {
    expect(() =>
      quoteCreditTopUp({
        config: DEFAULT_CREDIT_TOP_UP_CONFIG,
        currency: "CNY",
        amountMinor: 99,
        provider: "alipay_f2f",
      })
    ).toThrow("充值金额超出允许范围");
    expect(() =>
      quoteCreditTopUp({
        config: DEFAULT_CREDIT_TOP_UP_CONFIG,
        currency: "USD",
        amountMinor: 100,
        provider: "alipay_f2f",
      })
    ).toThrow("该币种暂未开放充值");
  });

  it("过滤不支持币种的支付宝当面付配置", () => {
    const config = normalizeCreditTopUpConfig({
      enabled: true,
      defaultCurrency: "USD",
      currencies: [
        {
          currency: "USD",
          creditsPerMajorUnit: 20,
          minAmountMinor: 100,
          maxAmountMinor: 10_000,
          providers: ["alipay_f2f"],
        },
      ],
    });
    expect(config.currencies[0]?.providers).toEqual([]);
  });
});
