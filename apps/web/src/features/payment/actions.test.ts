/**
 * 支付 Server Action 兼容测试。
 *
 * 证明 createCheckoutSession 仍保留旧输入和浏览器输出，同时仅用当前 session
 * Principal 调用 subscription.createCheckout，不再直接访问支付 SDK 或订单数据库。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureUolInitialized: vi.fn(),
  getUserRoleById: vi.fn(),
  invokeOperation: vi.fn(),
}));

vi.mock("@repo/database", () => ({ db: {} }));
vi.mock("@repo/database/schema", () => ({ subscription: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("@repo/shared/auth/role-server", () => ({
  getUserRoleById: mocks.getUserRoleById,
}));
vi.mock("@repo/shared/logger", () => ({ logEvent: vi.fn() }));
vi.mock("@repo/shared/uol", () => ({
  invokeOperation: mocks.invokeOperation,
}));
vi.mock("@/server/uol-init", () => ({
  ensureUolInitialized: mocks.ensureUolInitialized,
}));
vi.mock("./creem", () => ({
  creem: { cancelSubscription: vi.fn() },
}));
vi.mock("@repo/shared/safe-action", () => {
  type ActionHandler = (input: {
    parsedInput: Record<string, unknown>;
    ctx: { userId: string };
  }) => Promise<unknown>;
  const builder = {
    metadata: () => builder,
    schema: () => builder,
    action: (handler: ActionHandler) => handler,
  };
  return { protectedAction: builder };
});

import { createCheckoutSession } from "./actions";

type CheckoutAction = (input: {
  parsedInput: {
    priceId: string;
    type?: "subscription" | "one-time";
    successUrl?: string;
    cancelUrl?: string;
  };
  ctx: { userId: string };
}) => Promise<unknown>;

const invokeCheckoutAction = createCheckoutSession as unknown as CheckoutAction;

describe("createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureUolInitialized.mockResolvedValue(undefined);
    mocks.getUserRoleById.mockResolvedValue("user");
  });

  it("Creem redirect 保持旧的 {url} 输出并只使用当前 session Principal", async () => {
    mocks.invokeOperation.mockResolvedValue({
      kind: "redirect",
      url: "https://pay.example.test/checkout",
    });

    await expect(
      invokeCheckoutAction({
        parsedInput: {
          priceId: "pro_monthly",
          type: "subscription",
          successUrl: "https://client.example/success",
          cancelUrl: "https://client.example/cancel",
        },
        ctx: { userId: "session-user" },
      })
    ).resolves.toEqual({ url: "https://pay.example.test/checkout" });
    expect(mocks.ensureUolInitialized).toHaveBeenCalledOnce();
    expect(mocks.invokeOperation).toHaveBeenCalledWith(
      "subscription.createCheckout",
      {
        priceId: "pro_monthly",
        successUrl: "https://client.example/success",
        cancelUrl: "https://client.example/cancel",
      },
      { type: "user", userId: "session-user", role: "user" }
    );
  });

  it("Epay form_post 保持旧的 POST params 输出", async () => {
    mocks.invokeOperation.mockResolvedValue({
      kind: "form_post",
      url: "https://epay.example.test/submit.php",
      fields: { out_trade_no: "order-1", sign: "signed" },
    });

    await expect(
      invokeCheckoutAction({
        parsedInput: { priceId: "pro_monthly" },
        ctx: { userId: "session-user" },
      })
    ).resolves.toEqual({
      url: "https://epay.example.test/submit.php",
      params: { out_trade_no: "order-1", sign: "signed" },
      method: "POST",
    });
  });
});
