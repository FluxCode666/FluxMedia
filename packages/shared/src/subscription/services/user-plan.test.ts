import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selfUseEnabled: true,
  userRows: [] as Array<{ role: string }>,
  subscriptionRows: [] as Array<{
    priceId: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }>,
}));

const schemaMock = vi.hoisted(() => ({
  user: {
    id: "user.id",
    role: "user.role",
  },
  subscription: {
    userId: "subscription.user_id",
    priceId: "subscription.price_id",
    status: "subscription.status",
    currentPeriodEnd: "subscription.current_period_end",
    cancelAtPeriodEnd: "subscription.cancel_at_period_end",
  },
}));

const dbMock = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async (count: number) => {
          const rows =
            table === schemaMock.user
              ? state.userRows
              : state.subscriptionRows;
          return rows.slice(0, count);
        }),
      })),
    })),
  })),
}));

vi.mock("@repo/database", () => ({
  db: dbMock,
}));

vi.mock("@repo/database/schema", () => schemaMock);

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
}));

vi.mock("../../auth/self-use-mode", () => ({
  isSelfUseModeEnabled: vi.fn(async () => state.selfUseEnabled),
}));

describe("getUserPlan", () => {
  beforeEach(() => {
    vi.resetModules();
    state.selfUseEnabled = true;
    state.userRows = [];
    state.subscriptionRows = [];
    dbMock.select.mockClear();
  });

  it("treats self-use super admins as Enterprise without a subscription", async () => {
    state.userRows = [{ role: "super_admin" }];

    const { getUserPlan } = await import("./user-plan");
    const plan = await getUserPlan("admin-1");

    expect(plan).toMatchObject({
      plan: "enterprise",
      planName: "Enterprise",
      hasActiveSubscription: true,
      subscriptionStatus: "self_use",
      priceId: null,
    });
    expect(dbMock.select).toHaveBeenCalledTimes(1);
  });

  it("keeps normal users on the normal subscription path", async () => {
    state.userRows = [{ role: "user" }];
    const previousProvider = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "epay";
    state.subscriptionRows = [
      {
        priceId: "pro_monthly",
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 60_000),
        cancelAtPeriodEnd: false,
      },
    ];

    try {
      vi.resetModules();
      const { getUserPlan } = await import("./user-plan");
      const plan = await getUserPlan("user-1");

      expect(plan.plan).toBe("pro");
      expect(plan.subscriptionStatus).toBe("active");
    } finally {
      if (previousProvider === undefined) {
        delete process.env.PAYMENT_PROVIDER;
      } else {
        process.env.PAYMENT_PROVIDER = previousProvider;
      }
      vi.resetModules();
    }
  });

  it("does not apply the super-admin override when self-use mode is disabled", async () => {
    state.selfUseEnabled = false;
    state.userRows = [{ role: "super_admin" }];

    const { getUserPlan } = await import("./user-plan");
    const plan = await getUserPlan("admin-1");

    expect(plan).toMatchObject({
      plan: "free",
      hasActiveSubscription: false,
    });
  });
});
