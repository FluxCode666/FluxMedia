/**
 * 系统设置两级缓存的 DB-free 单测。
 *
 * 使用内存 Redis mock 覆盖默认 DB、序列化校验、cache-aside、写后失效与 Redis
 * 故障降级，避免测试依赖真实 Redis 或 PostgreSQL。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMockState = vi.hoisted(() => ({
  connectFailure: false,
  store: new Map<string, string>(),
  connectionOptions: [] as Array<{
    db: number;
    host: string;
    password: string;
    port: number;
    username: string | undefined;
  }>,
  deletedKeys: [] as string[],
}));

vi.mock("ioredis", () => ({
  default: class RedisMock {
    status = "wait";

    constructor(options: {
      db: number;
      host: string;
      password: string;
      port: number;
      username?: string;
    }) {
      redisMockState.connectionOptions.push({
        db: options.db,
        host: options.host,
        password: options.password,
        port: options.port,
        username: options.username,
      });
    }

    on() {
      return this;
    }

    async connect() {
      if (redisMockState.connectFailure) {
        this.status = "end";
        throw new Error("connection failed");
      }
      this.status = "ready";
    }

    async get(key: string) {
      return redisMockState.store.get(key) ?? null;
    }

    async set(key: string, value: string) {
      redisMockState.store.set(key, value);
      return "OK";
    }

    async del(key: string) {
      redisMockState.deletedKeys.push(key);
      return redisMockState.store.delete(key) ? 1 : 0;
    }

    disconnect() {
      this.status = "end";
    }
  },
}));

/**
 * 写入标准 Redis 的拆分环境变量。
 *
 * @param values - 覆盖默认本地 Redis 配置的字段。
 * @returns 无返回值。
 */
function configureRedisEnvironment(
  values: Partial<{
    host: string;
    password: string;
    port: string;
    username: string;
  }> = {}
) {
  process.env.REDIS_HOST = values.host ?? "127.0.0.1";
  process.env.REDIS_PORT = values.port ?? "6379";
  process.env.REDIS_USERNAME = values.username ?? "";
  process.env.REDIS_PASSWORD = values.password ?? "test-password";
}

/**
 * 清理标准 Redis 的拆分环境变量，避免不同测试相互污染。
 *
 * @returns 无返回值。
 */
function clearRedisEnvironment() {
  delete process.env.REDIS_DB;
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  delete process.env.REDIS_USERNAME;
  delete process.env.REDIS_PASSWORD;
}

vi.mock("../logger", () => ({
  logWarn: vi.fn(),
}));

import {
  clearLocalSystemSettingsCache,
  getSystemSettingsRedisDatabase,
  invalidateSystemSettingsCache,
  loadCachedSystemSettings,
  parseSystemSettingsCache,
  resetSystemSettingsCacheForTests,
  serializeSystemSettingsCache,
} from "./cache";

describe("system settings cache", () => {
  beforeEach(() => {
    redisMockState.connectFailure = false;
    redisMockState.store.clear();
    redisMockState.connectionOptions = [];
    redisMockState.deletedKeys = [];
    clearRedisEnvironment();
    delete process.env.SYSTEM_SETTINGS_LOCAL_CACHE_TTL_MS;
    delete process.env.SYSTEM_SETTINGS_CACHE_TTL_SECONDS;
    resetSystemSettingsCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSystemSettingsCacheForTests();
    clearRedisEnvironment();
    delete process.env.SYSTEM_SETTINGS_LOCAL_CACHE_TTL_MS;
    delete process.env.SYSTEM_SETTINGS_CACHE_TTL_SECONDS;
  });

  it("defaults to Redis database 4 and rejects invalid database numbers", () => {
    expect(getSystemSettingsRedisDatabase()).toBe(4);

    process.env.REDIS_DB = "9";
    expect(getSystemSettingsRedisDatabase()).toBe(9);

    process.env.REDIS_DB = "16";
    expect(getSystemSettingsRedisDatabase()).toBe(4);

    process.env.REDIS_DB = "not-a-number";
    expect(getSystemSettingsRedisDatabase()).toBe(4);
  });

  it("round-trips typed values and rejects malformed cache payloads", () => {
    const values = new Map<string, unknown>([
      ["ENABLED", true],
      ["LIMIT", 12],
      ["JSON", { version: 1 }],
    ]);

    expect(
      parseSystemSettingsCache(serializeSystemSettingsCache(values))
    ).toEqual(values);
    expect(parseSystemSettingsCache("not-json")).toBeUndefined();
    expect(
      parseSystemSettingsCache(JSON.stringify({ version: 2, values: [] }))
    ).toBeUndefined();
  });

  it("reads through Redis after the first database load", async () => {
    configureRedisEnvironment({
      host: "172.17.0.1",
      password: "raw/password-with-special-characters",
      port: "6380",
      username: "cache-user",
    });
    const loader = vi.fn(
      async () =>
        new Map<string, unknown>([["NEXT_PUBLIC_APP_NAME", "FluxMedia"]])
    );

    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["NEXT_PUBLIC_APP_NAME", "FluxMedia"]])
    );
    clearLocalSystemSettingsCache();
    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["NEXT_PUBLIC_APP_NAME", "FluxMedia"]])
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(redisMockState.connectionOptions).toEqual([
      {
        db: 4,
        host: "172.17.0.1",
        password: "raw/password-with-special-characters",
        port: 6380,
        username: "cache-user",
      },
    ]);
    expect(redisMockState.store.size).toBe(1);
  });

  it("invalidates Redis and reloads the database on the next read", async () => {
    configureRedisEnvironment();
    let currentValue = "UTC";
    const loader = vi.fn(
      async () =>
        new Map<string, unknown>([["NEXT_PUBLIC_APP_NAME", currentValue]])
    );

    await loadCachedSystemSettings(loader);
    currentValue = "Asia/Tokyo";
    await invalidateSystemSettingsCache();

    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["NEXT_PUBLIC_APP_NAME", "Asia/Tokyo"]])
    );
    expect(loader).toHaveBeenCalledTimes(2);
    expect(redisMockState.deletedKeys.length).toBeGreaterThan(0);
  });

  it("falls back to the database when Redis is unavailable", async () => {
    configureRedisEnvironment();
    redisMockState.connectFailure = true;
    const loader = vi.fn(
      async () => new Map<string, unknown>([["SELF_USE_MODE_ENABLED", true]])
    );

    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["SELF_USE_MODE_ENABLED", true]])
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("recreates an ended Redis client after the failure cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    configureRedisEnvironment();
    redisMockState.connectFailure = true;
    const loader = vi.fn(
      async () => new Map<string, unknown>([["NEXT_PUBLIC_APP_NAME", "UTC"]])
    );

    await loadCachedSystemSettings(loader);
    clearLocalSystemSettingsCache();
    redisMockState.connectFailure = false;
    vi.setSystemTime(new Date("2026-07-20T00:00:06.000Z"));
    await loadCachedSystemSettings(loader);

    expect(
      redisMockState.connectionOptions.map((options) => options.db)
    ).toEqual([4, 4]);
    expect(redisMockState.store.size).toBe(1);
  });

  it("falls back to the database when the Redis configuration is incomplete", async () => {
    process.env.REDIS_HOST = "127.0.0.1";
    const loader = vi.fn(
      async () => new Map<string, unknown>([["NEXT_PUBLIC_APP_NAME", "UTC"]])
    );

    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["NEXT_PUBLIC_APP_NAME", "UTC"]])
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(redisMockState.connectionOptions).toHaveLength(0);
  });

  it("falls back to the database when the Redis port is invalid", async () => {
    configureRedisEnvironment({ port: "not-a-port" });
    const loader = vi.fn(
      async () => new Map<string, unknown>([["NEXT_PUBLIC_APP_NAME", "UTC"]])
    );

    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["NEXT_PUBLIC_APP_NAME", "UTC"]])
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(redisMockState.connectionOptions).toHaveLength(0);
  });
});
