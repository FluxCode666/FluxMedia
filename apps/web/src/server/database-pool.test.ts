/**
 * 标准 PostgreSQL 连接池可靠性配置的 DB-free 回归测试。
 *
 * 验证远端链路停顿会有限失败，空闲连接错误有监听器承接，且日志不会携带 pg Client
 * 对象、连接参数或其他可能的凭据字段。
 */
import { EventEmitter } from "node:events";

import {
  attachPostgresPoolErrorHandler,
  buildStandardPostgresPoolConfig,
  guardPostgresClientQueryTimeouts,
  isPostgresTimeoutError,
  sanitizePostgresPoolError,
} from "@repo/database/pool";
import { describe, expect, it, vi } from "vitest";

describe("standard PostgreSQL pool reliability", () => {
  it("uses bounded waits, keepalive, and connection rotation", () => {
    expect(
      buildStandardPostgresPoolConfig("postgresql://example.invalid/test")
    ).toMatchObject({
      application_name: "fluxmedia-web",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      maxLifetimeSeconds: 300,
      maxUses: 1_000,
      query_timeout: 10_000,
    });
  });

  it("handles idle-client errors with sanitized details", () => {
    const emitter = new EventEmitter();
    const logger = vi.fn();
    attachPostgresPoolErrorHandler(emitter, logger);

    const error = Object.assign(new Error("read ETIMEDOUT"), {
      code: "ETIMEDOUT",
      client: {
        connectionParameters: { password: "must-not-leak" },
        secretKey: 123,
      },
    });
    expect(() => emitter.emit("error", error)).not.toThrow();
    expect(logger).toHaveBeenCalledWith(
      "[database] idle PostgreSQL client disconnected",
      {
        name: "Error",
        message: "read ETIMEDOUT",
        code: "ETIMEDOUT",
      }
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain("must-not-leak");
    expect(sanitizePostgresPoolError("unexpected")).toEqual({
      name: "UnknownError",
      message: "Unknown PostgreSQL pool error",
    });
  });

  it("discards a checked-out client after a query read timeout", async () => {
    const timeoutError = new Error("Query read timeout");
    const release = vi.fn();
    const client = {
      query: vi.fn((..._arguments: unknown[]) => Promise.reject(timeoutError)),
      release,
      end: vi.fn(() => Promise.resolve()),
    };
    guardPostgresClientQueryTimeouts(client);

    await expect(client.query()).rejects.toBe(timeoutError);
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(timeoutError);

    client.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it("discards a checked-out client when callback queries time out", () => {
    const timeoutError = new Error("Query read timeout");
    const release = vi.fn();
    const callback = vi.fn();
    const client = {
      query: vi.fn((...queryArguments: unknown[]) => {
        const queryCallback = queryArguments.at(-1);
        if (typeof queryCallback === "function") {
          queryCallback(timeoutError, undefined);
        }
      }),
      release,
      end: vi.fn(() => Promise.resolve()),
    };
    guardPostgresClientQueryTimeouts(client);

    client.query("select 1", callback);

    expect(callback).toHaveBeenCalledWith(timeoutError, undefined);
    expect(release).toHaveBeenCalledWith(timeoutError);
  });

  it("redacts connection URLs embedded in pool error messages", () => {
    const sanitized = sanitizePostgresPoolError(
      new Error(
        "connect postgresql://private-user:private-password@db.example.com/app"
      )
    );

    expect(sanitized.message).toBe("connect [REDACTED_DATABASE_URL]");
    expect(JSON.stringify(sanitized)).not.toContain("private-user");
    expect(JSON.stringify(sanitized)).not.toContain("private-password");
    expect(JSON.stringify(sanitized)).not.toContain("db.example.com");
  });

  it("recognizes nested query and connection timeout errors", () => {
    const queryTimeout = new Error("Query read timeout");
    const drizzleError = new Error("Failed query: select private_column", {
      cause: queryTimeout,
    });
    expect(isPostgresTimeoutError(drizzleError)).toBe(true);
    expect(
      isPostgresTimeoutError(
        Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })
      )
    ).toBe(true);
    expect(
      isPostgresTimeoutError(
        new Error("Connection terminated due to connection timeout")
      )
    ).toBe(true);
    expect(
      isPostgresTimeoutError(
        new Error("timeout exceeded when trying to connect")
      )
    ).toBe(true);
  });

  it("does not misclassify ordinary database failures as timeouts", () => {
    expect(
      isPostgresTimeoutError(
        Object.assign(new Error("column does not exist"), { code: "42703" })
      )
    ).toBe(false);
    expect(isPostgresTimeoutError(new Error("Connection terminated"))).toBe(
      false
    );
    expect(
      isPostgresTimeoutError(
        new Error(
          "Failed query: select 'statement timeout' from audit_log\n" +
            "params: timeout expired"
        )
      )
    ).toBe(false);
  });
});
