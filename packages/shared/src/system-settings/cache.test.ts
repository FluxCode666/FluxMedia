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
  selectedDatabases: [] as number[],
  deletedKeys: [] as string[],
}));

vi.mock("ioredis", () => ({
  default: class RedisMock {
    status = "wait";

    constructor(_url: string, options: { db: number }) {
      redisMockState.selectedDatabases.push(options.db);
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
    redisMockState.selectedDatabases = [];
    redisMockState.deletedKeys = [];
    delete process.env.REDIS_DB;
    delete process.env.REDIS_URL;
    delete process.env.SYSTEM_SETTINGS_LOCAL_CACHE_TTL_MS;
    delete process.env.SYSTEM_SETTINGS_CACHE_TTL_SECONDS;
    resetSystemSettingsCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSystemSettingsCacheForTests();
    delete process.env.REDIS_DB;
    delete process.env.REDIS_URL;
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
    process.env.REDIS_URL = "redis://localhost:6379";
    const loader = vi.fn(
      async () => new Map<string, unknown>([["APP_TIME_ZONE", "Asia/Shanghai"]])
    );

    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["APP_TIME_ZONE", "Asia/Shanghai"]])
    );
    clearLocalSystemSettingsCache();
    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["APP_TIME_ZONE", "Asia/Shanghai"]])
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(redisMockState.selectedDatabases).toEqual([4]);
    expect(redisMockState.store.size).toBe(1);
  });

  it("invalidates Redis and reloads the database on the next read", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let currentValue = "UTC";
    const loader = vi.fn(
      async () => new Map<string, unknown>([["APP_TIME_ZONE", currentValue]])
    );

    await loadCachedSystemSettings(loader);
    currentValue = "Asia/Tokyo";
    await invalidateSystemSettingsCache();

    await expect(loadCachedSystemSettings(loader)).resolves.toEqual(
      new Map([["APP_TIME_ZONE", "Asia/Tokyo"]])
    );
    expect(loader).toHaveBeenCalledTimes(2);
    expect(redisMockState.deletedKeys.length).toBeGreaterThan(0);
  });

  it("falls back to the database when Redis is unavailable", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
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
    process.env.REDIS_URL = "redis://localhost:6379";
    redisMockState.connectFailure = true;
    const loader = vi.fn(
      async () => new Map<string, unknown>([["APP_TIME_ZONE", "UTC"]])
    );

    await loadCachedSystemSettings(loader);
    clearLocalSystemSettingsCache();
    redisMockState.connectFailure = false;
    vi.setSystemTime(new Date("2026-07-20T00:00:06.000Z"));
    await loadCachedSystemSettings(loader);

    expect(redisMockState.selectedDatabases).toEqual([4, 4]);
    expect(redisMockState.store.size).toBe(1);
  });
});
