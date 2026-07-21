/**
 * 标准 PostgreSQL 连接池的可靠性边界。
 *
 * 非 Neon 环境通过这里统一创建连接池：限制连接与查询等待、启用 TCP KeepAlive、
 * 定期轮换长寿命连接，并监听空闲客户端错误。数据库包不能反向依赖 shared logger，
 * 因此默认日志只输出脱敏字段，测试可注入记录器验证不会泄露客户端和连接信息。
 */
import { Pool, type PoolConfig } from "pg";

export type SafePostgresPoolError = {
  name: string;
  message: string;
  code?: string;
};

type PoolErrorLogger = (
  message: string,
  details: SafePostgresPoolError
) => void;

type PostgresPoolErrorSource = {
  on(event: "error", listener: (error: Error) => void): unknown;
};

type PostgresQueryClient = {
  query: (...queryArguments: unknown[]) => unknown;
  release?: (error?: Error | boolean) => void;
  end: () => Promise<void>;
};

type CatchableResult = {
  catch: (onRejected: (error: unknown) => unknown) => unknown;
};

type ErrorWithCause = Error & {
  cause?: unknown;
  code?: unknown;
};

const STANDARD_POSTGRES_POOL_DEFAULTS = {
  application_name: "fluxmedia-web",
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  idle_in_transaction_session_timeout: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  max: 10,
  maxLifetimeSeconds: 300,
  maxUses: 1_000,
  query_timeout: 10_000,
} as const satisfies PoolConfig;

/** 移除错误消息中的数据库 URL 与常见凭据字段，并限制日志长度。 */
function sanitizePostgresPoolErrorMessage(message: string): string {
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu, "[REDACTED_DATABASE_URL]")
    .replace(
      /\b(password|secretKey|token)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;}]+)/giu,
      "$1=[REDACTED]"
    )
    .slice(0, 500);
}

/** 构造不包含自动重试的标准 PG 连接池配置，避免写事务被透明重放。 */
export function buildStandardPostgresPoolConfig(
  connectionString: string
): PoolConfig {
  return { connectionString, ...STANDARD_POSTGRES_POOL_DEFAULTS };
}

/** 从未知连接错误中只保留可定位且不会暴露连接凭据的字段。 */
export function sanitizePostgresPoolError(
  error: unknown
): SafePostgresPoolError {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: "Unknown PostgreSQL pool error" };
  }
  const codeCandidate = error as Error & { code?: unknown };
  return {
    name: error.name,
    message: sanitizePostgresPoolErrorMessage(error.message),
    ...(typeof codeCandidate.code === "string"
      ? { code: codeCandidate.code }
      : {}),
  };
}

/**
 * 判断未知异常链是否表示 PostgreSQL 查询或连接等待超时。
 *
 * Drizzle、Better Auth 与 node-postgres 可能逐层包装异常，因此必须沿 `cause` 查找；
 * 只匹配明确的超时消息或错误码，避免把普通 SQL 错误误报为可重试超时。
 */
export function isPostgresTimeoutError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    const candidate = current as ErrorWithCause;
    const message = current.message.toLowerCase();
    const isDrizzleQueryWrapper = message.startsWith("failed query:");
    if (candidate.code === "ETIMEDOUT") return true;
    if (
      !isDrizzleQueryWrapper &&
      (message === "query read timeout" ||
        message === "connection terminated due to connection timeout" ||
        message === "timeout exceeded when trying to connect" ||
        message === "timeout expired" ||
        message.includes("canceling statement due to statement timeout"))
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

/** 判断 pg 是否返回了客户端侧的查询读取超时。 */
function isPostgresQueryReadTimeout(error: unknown): error is Error {
  return error instanceof Error && error.message === "Query read timeout";
}

/** 将发生查询读取超时的客户端从连接池移除，避免事务连接被再次借出。 */
function discardTimedOutPostgresClient(
  client: PostgresQueryClient,
  error: Error
): void {
  const release = client.release;
  if (release) {
    // Drizzle 可能在事务回滚路径再次调用 release；让后续调用保持幂等。
    client.release = () => undefined;
    release(error);
    return;
  }

  void client.end().catch((endError: unknown) => {
    console.error(
      "[database] failed to close timed-out PostgreSQL client",
      sanitizePostgresPoolError(endError)
    );
  });
}

/** 判断查询结果是否为支持 catch 的 Promise-like 对象。 */
function isCatchableResult(value: unknown): value is CatchableResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "catch" in value &&
    typeof value.catch === "function"
  );
}

/**
 * 包装 pg 客户端查询，在读取超时时销毁借出的客户端。
 *
 * pg 的 query_timeout 只会结束当前查询回调，不会自动释放 transaction client；
 * 这里同时覆盖 Promise 与 callback 两种调用形式，确保 Drizzle 事务异常路径不会
 * 把仍有活动查询或未完成事务的连接归还到池中。
 */
export function guardPostgresClientQueryTimeouts(
  client: PostgresQueryClient
): void {
  const originalQuery = client.query.bind(client);
  client.query = (...queryArguments: unknown[]) => {
    const guardedArguments = [...queryArguments];
    const callbackIndex = guardedArguments.length - 1;
    const callback = guardedArguments[callbackIndex];

    if (typeof callback === "function") {
      const callbackFunction = callback as (...args: unknown[]) => unknown;
      guardedArguments[callbackIndex] = (...callbackArguments: unknown[]) => {
        const [error] = callbackArguments;
        if (isPostgresQueryReadTimeout(error)) {
          discardTimedOutPostgresClient(client, error);
        }
        return callbackFunction(...callbackArguments);
      };
    }

    const result = originalQuery(...guardedArguments);
    if (isCatchableResult(result)) {
      return result.catch((error: unknown) => {
        if (isPostgresQueryReadTimeout(error)) {
          discardTimedOutPostgresClient(client, error);
        }
        throw error;
      });
    }
    return result;
  };
}

/**
 * 监听池内空闲客户端的网络错误。
 *
 * pg 要求调用方注册 `error` 监听器；否则断开的空闲连接会抛到进程级
 * `uncaughtException`。监听器只记录脱敏错误，连接池会自行移除故障客户端。
 */
export function attachPostgresPoolErrorHandler(
  pool: PostgresPoolErrorSource,
  logger: PoolErrorLogger = (message, details) =>
    console.error(message, details)
): void {
  pool.on("error", (error) => {
    logger(
      "[database] idle PostgreSQL client disconnected",
      sanitizePostgresPoolError(error)
    );
  });
}

/** 创建带可靠性配置和空闲连接错误监听器的标准 PostgreSQL 连接池。 */
export function createStandardPostgresPool(connectionString: string): Pool {
  const pool = new Pool(buildStandardPostgresPoolConfig(connectionString));
  pool.on("connect", (client) => {
    guardPostgresClientQueryTimeouts(client as unknown as PostgresQueryClient);
  });
  attachPostgresPoolErrorHandler(pool);
  return pool;
}
