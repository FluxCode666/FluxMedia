/**
 * 钱包购买区能力矩阵的纯逻辑测试。
 *
 * 覆盖四种启用组合与读取失败边界，确保失败不会被误判为业务关闭。
 */
import { describe, expect, it } from "vitest";

import { resolveWalletPurchaseLayout } from "./purchase-layout";

const disabled = { status: "ready", enabled: false } as const;
const enabled = { status: "ready", enabled: true } as const;
const error = { status: "error" } as const;

describe("resolveWalletPurchaseLayout", () => {
  it.each([
    [disabled, disabled, "hidden"],
    [enabled, disabled, "top-up"],
    [disabled, enabled, "subscription"],
    [enabled, enabled, "tabs"],
  ] as const)("解析两种购买能力的四态", (topUp, subscription, mode) => {
    expect(resolveWalletPurchaseLayout(topUp, subscription)).toEqual({
      mode,
      hasError: false,
    });
  });

  it("读取失败时保留错误状态而不是按关闭隐藏", () => {
    expect(resolveWalletPurchaseLayout(error, disabled)).toEqual({
      mode: "error",
      hasError: true,
    });
    expect(resolveWalletPurchaseLayout(error, enabled)).toEqual({
      mode: "subscription",
      hasError: true,
    });
  });
});
