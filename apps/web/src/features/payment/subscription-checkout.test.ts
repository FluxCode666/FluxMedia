/**
 * 订阅结账服务测试。
 *
 * 锁定 Creem/Epay 分流、活跃订阅限制、升级订单 metadata 与同源钱包回跳，
 * 避免统一接口改造改变支付、报价或履约协议。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  findRuntimePlanByPriceId: vi.fn(),
  getRuntimePaymentProvider: vi.fn(),
  saveEpayOrder: vi.fn(),
  createRuntimeEpayPurchase: vi.fn(),
  logEvent: vi.fn(),
  assertRuntimeCreemCheckoutConfigured: vi.fn(),
  createCreemCheckout: vi.fn(),
  createSubscriptionCheckoutQuote: vi.fn(),
  createWalletCheckoutRedirects: vi.fn(),
}));

vi.mock("@repo/database", () => ({ db: { select: mocks.select } }));
vi.mock("@repo/database/schema", () => ({
  subscription: {
    userId: "subscription.userId",
    priceId: "subscription.priceId",
    currentPeriodStart: "subscription.currentPeriodStart",
    currentPeriodEnd: "subscription.currentPeriodEnd",
    status: "subscription.status",
  },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("@repo/shared/config/payment-runtime", () => ({
  findRuntimePlanByPriceId: mocks.findRuntimePlanByPriceId,
}));
vi.mock("@repo/shared/logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("@repo/shared/payment/epay", () => ({
  getRuntimePaymentProvider: mocks.getRuntimePaymentProvider,
  saveEpayOrder: mocks.saveEpayOrder,
  createRuntimeEpayPurchase: mocks.createRuntimeEpayPurchase,
}));
vi.mock("@repo/shared/safe-action", () => ({
  ActionUserError: class ActionUserError extends Error {},
}));
vi.mock("./creem", () => ({
  assertRuntimeCreemCheckoutConfigured:
    mocks.assertRuntimeCreemCheckoutConfigured,
  creem: { createCheckout: mocks.createCreemCheckout },
}));
vi.mock("./subscription-upgrade", () => ({
  createSubscriptionCheckoutQuote: mocks.createSubscriptionCheckoutQuote,
}));
vi.mock("../wallet/redirects", () => ({
  createWalletCheckoutRedirects: mocks.createWalletCheckoutRedirects,
}));

import {
  createSubscriptionCheckout,
  selectTrustedSubscriptionCheckoutInput,
} from "./subscription-checkout";

const ACTIVE_SUBSCRIPTION = {
  userId: "user-1",
  priceId: "starter_monthly",
  currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2099-08-01T00:00:00.000Z"),
  status: "active",
};

/** 让 Drizzle 链返回指定的本人订阅快照。 */
function mockSubscriptionQuery(record?: typeof ACTIVE_SUBSCRIPTION): void {
  const limit = vi.fn().mockResolvedValue(record ? [record] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  mocks.select.mockReturnValue({ from });
}

describe("createSubscriptionCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscriptionQuery();
    mocks.findRuntimePlanByPriceId.mockResolvedValue({
      plan: { id: "pro", name: "Pro" },
      price: { amount: 60, interval: "monthly" },
    });
    mocks.assertRuntimeCreemCheckoutConfigured.mockResolvedValue(undefined);
    mocks.createCreemCheckout.mockResolvedValue({
      checkout_url: "https://pay.example.test/checkout",
    });
    mocks.createRuntimeEpayPurchase.mockResolvedValue({
      url: "https://epay.example.test/submit.php",
      params: { out_trade_no: "order-1", sign: "signed" },
    });
    mocks.createWalletCheckoutRedirects.mockReturnValue({
      successUrl: "https://app.example.test/dashboard/wallet?pay=success",
      cancelUrl: "https://app.example.test/dashboard/wallet?pay=cancel",
      returnUrl: "https://app.example.test/api/payments/epay/return",
    });
  });

  it("丢弃任意客户端 provider 和回跳 URL，只保留服务端身份与 priceId", () => {
    expect(
      selectTrustedSubscriptionCheckoutInput("session-user", {
        priceId: "pro_monthly",
        provider: "epay",
        successUrl: "https://evil.example/success",
        cancelUrl: "https://evil.example/cancel",
      })
    ).toEqual({ userId: "session-user", priceId: "pro_monthly" });
  });

  it("Creem 使用服务端钱包回跳并返回 redirect", async () => {
    mocks.getRuntimePaymentProvider.mockResolvedValue("creem");

    await expect(
      createSubscriptionCheckout("user-1", "pro_monthly")
    ).resolves.toEqual({
      kind: "redirect",
      url: "https://pay.example.test/checkout",
    });
    expect(mocks.createCreemCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: "pro_monthly",
        success_url:
          "https://app.example.test/dashboard/wallet?pay=success",
        metadata: { userId: "user-1", planId: "pro" },
      })
    );
  });

  it("Epay 使用服务端 return URL 并返回 form_post", async () => {
    mocks.getRuntimePaymentProvider.mockResolvedValue("epay");

    await expect(
      createSubscriptionCheckout("user-1", "pro_monthly")
    ).resolves.toEqual({
      kind: "form_post",
      url: "https://epay.example.test/submit.php",
      fields: { out_trade_no: "order-1", sign: "signed" },
    });
    expect(mocks.createRuntimeEpayPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        money: 60,
        returnUrl: "https://app.example.test/api/payments/epay/return",
      })
    );
  });

  it.each([
    ["none", "支付功能当前未启用"],
    [
      "alipay_f2f",
      "支付宝当面付仅支持按金额充值，暂不支持订阅套餐支付",
    ],
  ] as const)("provider=%s 时在查询和副作用前拒绝", async (provider, error) => {
    mocks.getRuntimePaymentProvider.mockResolvedValue(provider);

    await expect(
      createSubscriptionCheckout("user-1", "pro_monthly")
    ).rejects.toThrow(error);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.createCreemCheckout).not.toHaveBeenCalled();
    expect(mocks.saveEpayOrder).not.toHaveBeenCalled();
  });

  it("Creem 对已有活跃订阅保持自动补差拒绝", async () => {
    mocks.getRuntimePaymentProvider.mockResolvedValue("creem");
    mockSubscriptionQuery(ACTIVE_SUBSCRIPTION);
    mocks.createSubscriptionCheckoutQuote.mockResolvedValue({
      amountDue: 40,
      prorationCredit: 20,
    });

    await expect(
      createSubscriptionCheckout("user-1", "pro_monthly")
    ).rejects.toThrow("当前支付通道暂不支持自动补差升级");
    expect(mocks.createCreemCheckout).not.toHaveBeenCalled();
  });

  it("Epay 升级保存完整报价 metadata 后生成签名订单", async () => {
    mocks.getRuntimePaymentProvider.mockResolvedValue("epay");
    mockSubscriptionQuery(ACTIVE_SUBSCRIPTION);
    mocks.createSubscriptionCheckoutQuote.mockResolvedValue({
      amountDue: 45.5,
      originalAmount: 60,
      prorationCredit: 14.5,
      remainingDays: 10,
      periodDays: 30,
      upgradeFromPriceId: "starter_monthly",
    });

    await createSubscriptionCheckout("user-1", "pro_monthly");

    expect(mocks.saveEpayOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "subscription",
        userId: "user-1",
        priceId: "pro_monthly",
        planId: "pro",
        checkoutMode: "upgrade",
        expectedAmount: 45.5,
        originalAmount: 60,
        prorationCredit: 14.5,
        remainingDays: 10,
        periodDays: 30,
        upgradeFromPriceId: "starter_monthly",
      }),
      45.5
    );
    expect(mocks.createRuntimeEpayPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "FluxMedia upgrade to Pro monthly",
        money: 45.5,
      })
    );
  });
});
