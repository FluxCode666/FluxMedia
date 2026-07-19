/**
 * rate-limit 运行时配置单测。
 *
 * 通过内存桩验证配置指纹重建、动态阈值和 Upstash 故障降级，不连接数据库或网络。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  redisConfigs: [] as Array<Record<string, unknown>>,
  limiterConfigs: [] as Array<Record<string, unknown>>,
  rejectLimit: false,
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(async (key: string) => {
    const value = runtime.settings.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }),
  getRuntimeSettingNumber: vi.fn(async (key: string, fallback: number) => {
    const value = Number(runtime.settings.get(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class RedisMock {
    constructor(config: Record<string, unknown>) {
      runtime.redisConfigs.push(config);
    }
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class RatelimitMock {
    static slidingWindow(requests: number, window: string) {
      return { requests, window };
    }

    private readonly config: Record<string, unknown>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
      runtime.limiterConfigs.push(config);
    }

    async limit() {
      if (runtime.rejectLimit) throw new Error("Upstash unavailable");
      const limiter = this.config.limiter as { requests: number };
      return {
        success: true,
        remaining: limiter.requests - 1,
        reset: Date.now() + 60_000,
        limit: limiter.requests,
      };
    }
  },
}));

/**
 * 重新导入模块以隔离客户端和内存桶单例。
 *
 * @returns 新模块实例
 */
async function importFreshModule() {
  vi.resetModules();
  return import("./index");
}

describe("rate limit runtime configuration", () => {
  beforeEach(() => {
    runtime.settings.clear();
    runtime.redisConfigs.length = 0;
    runtime.limiterConfigs.length = 0;
    runtime.rejectLimit = false;
  });

  it("rebuilds Redis and limiter clients only when their fingerprints change", async () => {
    runtime.settings.set(
      "UPSTASH_REDIS_REST_URL",
      "https://redis-a.example.com"
    );
    runtime.settings.set("UPSTASH_REDIS_REST_TOKEN", "token-a");
    runtime.settings.set("RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE", 3);
    const { checkRateLimit } = await importFreshModule();

    const first = await checkRateLimit("first", "strict");
    const second = await checkRateLimit("second", "strict");
    expect(first.limit).toBe(3);
    expect(second.limit).toBe(3);
    expect(runtime.redisConfigs).toHaveLength(1);
    expect(runtime.limiterConfigs).toHaveLength(1);

    runtime.settings.set("RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE", 7);
    const afterThresholdChange = await checkRateLimit("third", "strict");
    expect(afterThresholdChange.limit).toBe(7);
    expect(runtime.redisConfigs).toHaveLength(1);
    expect(runtime.limiterConfigs).toHaveLength(2);

    runtime.settings.set("UPSTASH_REDIS_REST_TOKEN", "token-b");
    await checkRateLimit("fourth", "strict");
    expect(runtime.redisConfigs).toHaveLength(2);
    expect(runtime.limiterConfigs).toHaveLength(3);
  });

  it("switches to dynamic memory limits when Upstash credentials are cleared", async () => {
    runtime.settings.set(
      "UPSTASH_REDIS_REST_URL",
      "https://redis-a.example.com"
    );
    runtime.settings.set("UPSTASH_REDIS_REST_TOKEN", "token-a");
    const { checkRateLimit } = await importFreshModule();

    await checkRateLimit("remote", "strict");
    expect(runtime.redisConfigs).toHaveLength(1);

    runtime.settings.delete("UPSTASH_REDIS_REST_URL");
    runtime.settings.delete("UPSTASH_REDIS_REST_TOKEN");
    runtime.settings.set("RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE", 1);
    const first = await checkRateLimit("memory", "strict");
    const second = await checkRateLimit("memory", "strict");

    expect(first.success).toBe(true);
    expect(first.limit).toBe(1);
    expect(second.success).toBe(false);
    expect(runtime.redisConfigs).toHaveLength(1);
  });

  it("falls back to memory limiting when Upstash requests fail", async () => {
    runtime.settings.set(
      "UPSTASH_REDIS_REST_URL",
      "https://redis-a.example.com"
    );
    runtime.settings.set("UPSTASH_REDIS_REST_TOKEN", "token-a");
    runtime.settings.set("RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE", 1);
    runtime.rejectLimit = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { checkRateLimit } = await importFreshModule();

    const first = await checkRateLimit("fallback", "strict");
    const second = await checkRateLimit("fallback", "strict");

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
