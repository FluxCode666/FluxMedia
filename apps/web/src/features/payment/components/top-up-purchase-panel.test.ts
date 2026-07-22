/**
 * 按金额充值面板的纯逻辑测试。
 *
 * 覆盖快捷金额边界、不同币种最小单位与非法输入，避免客户端报价误差。
 */
import { describe, expect, it } from "vitest";

import {
  formatTopUpInputAmount,
  getTopUpQuickAmounts,
  parseTopUpAmountMinor,
} from "./top-up-purchase-panel-logic";

describe("top-up purchase panel logic", () => {
  it("只返回位于运行时最小和最大金额内的固定快捷金额", () => {
    expect(
      getTopUpQuickAmounts({
        currency: "CNY",
        minAmountMinor: 5_000,
        maxAmountMinor: 20_000,
      })
    ).toEqual([5_000, 10_000, 20_000]);
  });

  it("支持零位和三位小数币种", () => {
    expect(parseTopUpAmountMinor("1500", "JPY")).toBe(1_500);
    expect(parseTopUpAmountMinor("1.234", "KWD")).toBe(1_234);
    expect(formatTopUpInputAmount(1_234, "KWD")).toBe("1.234");
  });

  it.each([
    "",
    "1.234",
    "-1",
    "1e2",
    "abc",
  ])("拒绝 CNY 非法金额 %s", (value) => {
    expect(parseTopUpAmountMinor(value, "CNY")).toBeNull();
  });
});
