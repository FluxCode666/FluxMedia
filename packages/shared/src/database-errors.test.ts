/**
 * 数据库查询超时跨传输识别的 DB-free 回归测试。
 *
 * 验证原始异常、UOL 包装和 Better Auth 会话包装都能映射为安全提示，同时普通 SQL
 * 错误不会被误判。
 */
import { describe, expect, it } from "vitest";
import {
  DATABASE_QUERY_TIMEOUT_MESSAGE,
  DATABASE_QUERY_UNAVAILABLE_MESSAGE,
} from "./database-error-messages";
import {
  isAuthSessionQueryUnavailableError,
  isDatabaseQueryTimeoutError,
} from "./database-errors";
import { OperationError } from "./uol/errors";

describe("database query timeout errors", () => {
  it("recognizes raw and UOL timeout errors", () => {
    expect(
      isDatabaseQueryTimeoutError(
        new Error("Failed query: select private_column", {
          cause: new Error("Query read timeout"),
        })
      )
    ).toBe(true);
    expect(
      isDatabaseQueryTimeoutError(
        new OperationError("timeout", "Database query timed out", {
          source: "postgres",
        })
      )
    ).toBe(true);
  });

  it("classifies Better Auth session failures as unavailable, not timeout", () => {
    expect(
      isAuthSessionQueryUnavailableError({
        status: "INTERNAL_SERVER_ERROR",
        body: {
          code: "FAILED_TO_GET_SESSION",
          message: "Failed to get session",
        },
      })
    ).toBe(true);
    expect(
      isDatabaseQueryTimeoutError({
        body: { code: "FAILED_TO_GET_SESSION" },
      })
    ).toBe(false);
    expect(DATABASE_QUERY_TIMEOUT_MESSAGE).toBe("数据查询超时，请稍后重试");
    expect(DATABASE_QUERY_UNAVAILABLE_MESSAGE).toBe(
      "数据暂时不可用，请稍后重试"
    );
  });

  it("does not classify ordinary or non-PostgreSQL errors as timeouts", () => {
    expect(
      isDatabaseQueryTimeoutError(
        Object.assign(new Error("column does not exist"), { code: "42703" })
      )
    ).toBe(false);
    expect(isDatabaseQueryTimeoutError(new Error("unknown failure"))).toBe(
      false
    );
    expect(
      isDatabaseQueryTimeoutError(
        new OperationError("timeout", "Upstream timed out", {
          source: "image-provider",
        })
      )
    ).toBe(false);
    expect(
      isDatabaseQueryTimeoutError(
        new OperationError("timeout", "Unclassified timeout")
      )
    ).toBe(false);
  });
});
