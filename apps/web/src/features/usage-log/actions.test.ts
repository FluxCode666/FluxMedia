/**
 * 使用日志 Server Action 薄适配测试。
 *
 * 证明 Action 只把 schema 输入和当前 session 主体交给 UOL，不接受调用方 userId。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureUolInitialized: vi.fn(),
  getUserRoleById: vi.fn(),
  invokeOperation: vi.fn(),
}));

vi.mock("@repo/shared/safe-action", () => ({
  protectedAction: {
    metadata: () => ({
      schema: () => ({
        action:
          <T>(
            handler: (input: {
              parsedInput: unknown;
              ctx: { userId: string };
            }) => Promise<T>
          ) =>
          (input: { parsedInput: unknown; ctx: { userId: string } }) =>
            handler(input),
      }),
    }),
  },
}));

vi.mock("@repo/shared/auth/role-server", () => ({
  getUserRoleById: mocks.getUserRoleById,
}));

vi.mock("@repo/shared/uol", () => ({
  invokeOperation: mocks.invokeOperation,
}));

vi.mock("@/server/uol-init", () => ({
  ensureUolInitialized: mocks.ensureUolInitialized,
}));

import { getMyUsageEventDetailAction, getMyUsageEventsAction } from "./actions";

type MockAction = (input: {
  parsedInput: unknown;
  ctx: { userId: string };
}) => Promise<unknown>;

describe("usage log actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureUolInitialized.mockResolvedValue(undefined);
    mocks.getUserRoleById.mockResolvedValue("user");
  });

  it("forwards list filters with a principal derived from the session", async () => {
    mocks.invokeOperation.mockResolvedValue({
      asOf: "2026-07-22T01:00:00.000Z",
      events: [],
      nextCursor: null,
    });
    const input = { range: "7d", cursor: null };

    await (getMyUsageEventsAction as unknown as MockAction)({
      parsedInput: input,
      ctx: { userId: "session-user" },
    });

    expect(mocks.invokeOperation).toHaveBeenCalledWith(
      "credits.listMyUsageEvents",
      input,
      { type: "user", userId: "session-user", role: "user" }
    );
  });

  it("does not log or reshape the opaque detail reference", async () => {
    mocks.invokeOperation.mockResolvedValue({ kind: "request" });
    const input = { eventRef: "opaque-ref" };

    await (getMyUsageEventDetailAction as unknown as MockAction)({
      parsedInput: input,
      ctx: { userId: "session-user" },
    });

    expect(mocks.invokeOperation).toHaveBeenCalledWith(
      "credits.getMyUsageEventDetail",
      input,
      { type: "user", userId: "session-user", role: "user" }
    );
  });
});
