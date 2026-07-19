/**
 * 系统设置两级缓存。
 *
 * 使用方：system-settings/index.ts 的统一读取与写后失效入口。
 * 关键依赖：ioredis、Zod。L1 是进程内短缓存，L2 是 Redis 共享缓存；
 * Redis 未配置或暂时故障时回退数据库加载器，不阻断应用启动和业务请求。
 */
import Redis from "ioredis";
import { z } from "zod";

import { logWarn } from "../logger";

const SYSTEM_SETTINGS_CACHE_KEY = "fluxmedia:v1:system-settings";
const DEFAULT_REDIS_DATABASE = 4;
const DEFAULT_REDIS_CACHE_TTL_SECONDS = 60;
const DEFAULT_LOCAL_CACHE_TTL_MS = 1_000;
const DEFAULT_DATABASE_FALLBACK_CACHE_TTL_MS = 10_000;
const REDIS_FAILURE_COOLDOWN_MS = 5_000;

const cachedSettingsSchema = z.object({
  version: z.literal(1),
  values: z.array(z.tuple([z.string(), z.unknown()])),
});

type CachedSettingsPayload = z.infer<typeof cachedSettingsSchema>;
type SettingsLoader = () => Promise<Map<string, unknown>>;

let localCache:
  | {
      expiresAt: number;
      values: Map<string, unknown>;
    }
  | undefined;
let inFlightLoad: Promise<Map<string, unknown>> | undefined;
let redisClient: Redis | undefined;
let redisClientFingerprint: string | undefined;
let redisUnavailableUntil = 0;
let pendingRedisInvalidation = false;
let lastRedisWarningAt = 0;

/**
 * 将环境变量解析为有界整数。
 *
 * @param rawValue - 未受信任的环境变量文本。
 * @param fallback - 缺失或非法时的回退值。
 * @param bounds - 允许的闭区间。
 * @returns 位于闭区间内的整数。
 */
function parseBoundedInteger(
  rawValue: string | undefined,
  fallback: number,
  bounds: { min: number; max: number }
) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return fallback;
  }
  return parsed;
}

/**
 * 读取 Redis DB 编号。
 *
 * @returns REDIS_DB 的合法值；未配置时固定使用 4 号库。
 */
export function getSystemSettingsRedisDatabase() {
  return parseBoundedInteger(process.env.REDIS_DB, DEFAULT_REDIS_DATABASE, {
    min: 0,
    max: 15,
  });
}

/**
 * 读取共享缓存 TTL，并限制极端配置避免雪崩或长期脏缓存。
 *
 * @returns Redis 缓存秒数，默认 60 秒。
 */
function getRedisCacheTtlSeconds() {
  return parseBoundedInteger(
    process.env.SYSTEM_SETTINGS_CACHE_TTL_SECONDS,
    DEFAULT_REDIS_CACHE_TTL_SECONDS,
    { min: 10, max: 3_600 }
  );
}

/**
 * 读取 L1 缓存 TTL。
 *
 * @returns 进程内缓存毫秒数，默认 1 秒。
 */
function getLocalCacheTtlMs() {
  return parseBoundedInteger(
    process.env.SYSTEM_SETTINGS_LOCAL_CACHE_TTL_MS,
    DEFAULT_LOCAL_CACHE_TTL_MS,
    { min: 100, max: 10_000 }
  );
}

/**
 * 判断系统设置 Redis 是否已配置。
 *
 * @returns REDIS_URL 非空时为 true。
 */
function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL?.trim());
}

/**
 * 以限频方式记录 Redis 降级，不输出连接串或缓存内容。
 *
 * @param operation - 失败的缓存操作名。
 * @param error - 原始错误，仅记录安全的错误类型。
 */
function warnRedisFallback(operation: string, error: unknown) {
  const now = Date.now();
  if (now - lastRedisWarningAt < REDIS_FAILURE_COOLDOWN_MS) return;
  lastRedisWarningAt = now;
  logWarn("系统设置 Redis 缓存不可用，已回退数据库", {
    operation,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

/**
 * 创建或复用 Redis 客户端。
 *
 * 连接配置仅来自部署环境，避免系统设置缓存依赖自身才能完成初始化。客户端默认
 * 选择 4 号库，并设置短连接/命令超时和有限重试，防止 Redis 故障拖住主链路。
 *
 * @returns 已配置时返回进程级客户端，否则返回 undefined。
 */
function getRedisClient() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return undefined;

  const database = getSystemSettingsRedisDatabase();
  const fingerprint = `${redisUrl}\u0000${database}`;
  if (redisClient && redisClientFingerprint === fingerprint) {
    return redisClient;
  }

  if (redisClient) {
    redisClient.disconnect();
  }

  redisClient = new Redis(redisUrl, {
    db: database,
    lazyConnect: true,
    connectTimeout: 750,
    commandTimeout: 750,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    retryStrategy: () => null,
  });
  redisClient.on("error", () => {
    // 命令调用处统一分类并限频记录；error 事件只负责避免未监听事件终止进程。
  });
  redisClientFingerprint = fingerprint;
  redisUnavailableUntil = 0;
  return redisClient;
}

/**
 * 确保懒连接客户端已连接。
 *
 * @param client - 当前 Redis 客户端。
 * @throws 连接失败或处于不可恢复状态时抛出，由调用方统一降级。
 */
async function ensureRedisConnected(client: Redis) {
  if (client.status === "wait") {
    await client.connect();
    return;
  }
  if (client.status === "end") {
    throw new Error("Redis client is closed");
  }
}

/**
 * 执行可降级的 Redis 操作。
 *
 * @param operation - 观测用操作名，不包含敏感信息。
 * @param run - 实际 Redis 命令。
 * @param options - force 用于写后失效，即使熔断窗口内也尝试一次。
 * @returns 操作结果；未配置、熔断或失败时返回 undefined。
 */
async function runRedisOperation<T>(
  operation: string,
  run: (client: Redis) => Promise<T>,
  options?: { force?: boolean }
): Promise<T | undefined> {
  const client = getRedisClient();
  if (!client) return undefined;
  if (!options?.force && redisUnavailableUntil > Date.now()) return undefined;

  try {
    await ensureRedisConnected(client);
    const result = await run(client);
    redisUnavailableUntil = 0;
    return result;
  } catch (error) {
    redisUnavailableUntil = Date.now() + REDIS_FAILURE_COOLDOWN_MS;
    warnRedisFallback(operation, error);
    return undefined;
  }
}

/**
 * 将 Map 序列化为带版本的 JSON。
 *
 * @param values - 已由数据库规范化的系统设置。
 * @returns 可写入 Redis 的 JSON 文本。
 */
export function serializeSystemSettingsCache(values: Map<string, unknown>) {
  const payload: CachedSettingsPayload = {
    version: 1,
    values: [...values.entries()],
  };
  return JSON.stringify(payload);
}

/**
 * 校验并反序列化 Redis 缓存。
 *
 * @param rawValue - Redis 返回的未受信任文本。
 * @returns 合法 Map；损坏、旧版本或非 JSON 时返回 undefined 触发回源。
 */
export function parseSystemSettingsCache(rawValue: string) {
  try {
    const parsed = cachedSettingsSchema.safeParse(JSON.parse(rawValue));
    return parsed.success ? new Map(parsed.data.values) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 从 Redis 读取系统设置全集。
 *
 * 待处理的写后失效会优先删除旧 key，避免 Redis 故障恢复后重新读到故障前数据。
 *
 * @returns 命中时返回 Map，miss、损坏或 Redis 不可用时返回 undefined。
 */
async function readSettingsFromRedis() {
  return runRedisOperation("read", async (client) => {
    if (pendingRedisInvalidation) {
      await client.del(SYSTEM_SETTINGS_CACHE_KEY);
      pendingRedisInvalidation = false;
    }
    const rawValue = await client.get(SYSTEM_SETTINGS_CACHE_KEY);
    if (typeof rawValue !== "string") return undefined;
    const parsed = parseSystemSettingsCache(rawValue);
    if (!parsed) {
      await client.del(SYSTEM_SETTINGS_CACHE_KEY);
    }
    return parsed;
  });
}

/**
 * 将数据库回源结果写入 Redis。
 *
 * TTL 加入最多 10% 的稳定随机抖动，降低多实例同一时刻集中过期的风险。写缓存
 * 失败不改变数据库读取结果，由后续请求继续回源。
 *
 * @param values - 数据库返回的完整系统设置 Map。
 */
async function writeSettingsToRedis(values: Map<string, unknown>) {
  const ttlSeconds = getRedisCacheTtlSeconds();
  const jitterSeconds = Math.floor(
    Math.random() * Math.max(1, ttlSeconds * 0.1)
  );
  await runRedisOperation("write", async (client) => {
    await client.set(
      SYSTEM_SETTINGS_CACHE_KEY,
      serializeSystemSettingsCache(values),
      "EX",
      ttlSeconds + jitterSeconds
    );
  });
}

/**
 * 执行一次 Redis miss 后的数据库回源，并回填共享缓存。
 *
 * @param loadFromDatabase - system-settings 注入的数据库加载器。
 * @returns 当前完整系统设置 Map。
 */
async function loadSettingsUncached(loadFromDatabase: SettingsLoader) {
  if (isRedisConfigured()) {
    const redisValues = await readSettingsFromRedis();
    if (redisValues) return redisValues;
  }

  const databaseValues = await loadFromDatabase();
  if (isRedisConfigured()) {
    await writeSettingsToRedis(databaseValues);
  }
  return databaseValues;
}

/**
 * 读取系统设置全集。
 *
 * L1 命中直接返回；miss 时同一进程内合并并发回源，优先 Redis，Redis miss 才访问
 * PostgreSQL。Redis 未配置时保留原有 10 秒本地缓存，避免可选依赖降级后放大 DB 压力。
 *
 * @param loadFromDatabase - 仅在缓存 miss 时执行的数据库加载器。
 * @returns 当前完整系统设置 Map。
 */
export async function loadCachedSystemSettings(
  loadFromDatabase: SettingsLoader
) {
  const now = Date.now();
  if (localCache && localCache.expiresAt > now) return localCache.values;
  if (inFlightLoad) return inFlightLoad;

  inFlightLoad = loadSettingsUncached(loadFromDatabase)
    .then((values) => {
      localCache = {
        expiresAt:
          Date.now() +
          (isRedisConfigured()
            ? getLocalCacheTtlMs()
            : DEFAULT_DATABASE_FALLBACK_CACHE_TTL_MS),
        values,
      };
      return values;
    })
    .finally(() => {
      inFlightLoad = undefined;
    });
  return inFlightLoad;
}

/**
 * 立即清除当前进程的 L1 缓存。
 *
 * 用于测试隔离和同进程写后可见性；不会执行网络 I/O。
 */
export function clearLocalSystemSettingsCache() {
  localCache = undefined;
  inFlightLoad = undefined;
}

/**
 * 在数据库写成功后失效 L1 与 Redis 共享缓存。
 *
 * Redis 删除失败时记录待失效标记并继续返回成功，后续本进程首次 Redis 读会先删除
 * 旧 key；其他实例最多受 Redis key 的短 TTL 约束。数据库始终是真相来源。
 */
export async function invalidateSystemSettingsCache() {
  clearLocalSystemSettingsCache();
  if (!isRedisConfigured()) return;

  pendingRedisInvalidation = true;
  const deleted = await runRedisOperation(
    "invalidate",
    (client) => client.del(SYSTEM_SETTINGS_CACHE_KEY),
    { force: true }
  );
  if (deleted !== undefined) {
    pendingRedisInvalidation = false;
  }
}

/**
 * 关闭测试或进程生命周期中的 Redis 客户端并清空模块状态。
 *
 * 生产代码通常无需调用；导出用于 DB-free 故障与连接配置测试，确保句柄不泄漏。
 */
export function resetSystemSettingsCacheForTests() {
  clearLocalSystemSettingsCache();
  redisClient?.disconnect();
  redisClient = undefined;
  redisClientFingerprint = undefined;
  redisUnavailableUntil = 0;
  pendingRedisInvalidation = false;
  lastRedisWarningAt = 0;
}
