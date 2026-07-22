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

const testErrors = vi.hoisted(() => {
  class MockActionUserError extends Error {}
  class MockOperationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return { MockActionUserError, MockOperationError };
});

vi.mock("@repo/shared/safe-action", () => ({
  ActionUserError: testErrors.MockActionUserError,
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
  OperationError: testErrors.MockOperationError,
}));

vi.mock("@/server/uol-init", () => ({
  ensureUolInitialized: mocks.ensureUolInitialized,
}));

import { USAGE_LOG_NOT_READY_MESSAGE } from "./action-errors";
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

  it("maps not_ready to a stable production-safe message", async () => {
    mocks.invokeOperation.mockRejectedValue(
      new testErrors.MockOperationError("not_ready")
    );

    await expect(
      (getMyUsageEventsAction as unknown as MockAction)({
        parsedInput: { range: "7d", cursor: null },
        ctx: { userId: "session-user" },
      })
    ).rejects.toMatchObject({
      constructor: testErrors.MockActionUserError,
      message: USAGE_LOG_NOT_READY_MESSAGE,
    });
  });

  it("keeps non-readiness failures unchanged", async () => {
    const error = new testErrors.MockOperationError("timeout");
    mocks.invokeOperation.mockRejectedValue(error);

    await expect(
      (getMyUsageEventsAction as unknown as MockAction)({
        parsedInput: { range: "7d", cursor: null },
        ctx: { userId: "session-user" },
      })
    ).rejects.toBe(error);
  });

  it("详情读取将 not_ready 映射为稳定安全文案", async () => {
    mocks.invokeOperation.mockRejectedValue(
      new testErrors.MockOperationError("not_ready")
    );

    await expect(
      (getMyUsageEventDetailAction as unknown as MockAction)({
        parsedInput: { eventRef: "opaque-ref" },
        ctx: { userId: "session-user" },
      })
    ).rejects.toMatchObject({
      constructor: testErrors.MockActionUserError,
      message: USAGE_LOG_NOT_READY_MESSAGE,
    });
  });

  it("详情读取保持其他错误对象不变", async () => {
    const error = new testErrors.MockOperationError("timeout");
    mocks.invokeOperation.mockRejectedValue(error);

    await expect(
      (getMyUsageEventDetailAction as unknown as MockAction)({
        parsedInput: { eventRef: "opaque-ref" },
        ctx: { userId: "session-user" },
      })
    ).rejects.toBe(error);
  });
});
