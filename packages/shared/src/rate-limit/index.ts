/**
 * Rate Limiting 模块
 *
 * 使用 Upstash Redis 实现分布式 API 限流。
 * 未配置 Upstash 时回退到单实例内存兜底限流（不 fail-open），
 * 多实例部署应配置 Upstash 获得跨实例共享的分布式限流。
 *
 * 配置通过 system-settings 运行时读取；其缓存负责避免每个请求直查数据库。
 * Upstash 凭据或阈值变化时，本模块按配置指纹重建客户端，无需重启进程。
 */

import { createHash } from "node:crypto";
import { logWarn } from "@repo/shared/logger";
import {
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";

// ============================================
// 运行时配置
// ============================================

const CONFIG_READ_TIMEOUT_MS = 2_000;
const UPSTASH_REQUEST_TIMEOUT_MS = 2_000;
const WARNING_THROTTLE_MS = 60_000;
const MEMORY_WINDOW_MS = 60_000;

const RATE_LIMIT_DEFINITIONS = {
  global: {
    settingKey: "RATE_LIMIT_GLOBAL_REQUESTS_PER_MINUTE",
    fallback: 100,
  },
  auth: {
    settingKey: "RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE",
    fallback: 5,
  },
  ai: {
    settingKey: "RATE_LIMIT_AI_REQUESTS_PER_MINUTE",
    fallback: 20,
  },
  payment: {
    settingKey: "RATE_LIMIT_PAYMENT_REQUESTS_PER_MINUTE",
    fallback: 10,
  },
  upload: {
    settingKey: "RATE_LIMIT_UPLOAD_REQUESTS_PER_MINUTE",
    fallback: 30,
  },
  strict: {
    settingKey: "RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE",
    fallback: 3,
  },
} as const;

export type RateLimitType = keyof typeof RATE_LIMIT_DEFINITIONS;

type RateLimitRuntimeConfig = {
  redisUrl: string | undefined;
  redisToken: string | undefined;
  requests: Record<RateLimitType, number>;
};

type CachedLimiter = {
  fingerprint: string;
  limiter: Ratelimit;
};

type RateLimitResources = {
  connectionFingerprint?: string;
  redis: Redis | null;
  limiters: Map<RateLimitType, CachedLimiter>;
};

const resources: RateLimitResources = {
  redis: null,
  limiters: new Map(),
};

let lastKnownConfig: RateLimitRuntimeConfig | undefined;
let lastWarningAt = 0;

/**
 * 从进程环境构造安全回退配置。
 *
 * @returns 经正整数校验的阈值与可选 Upstash 凭据
 */
function getProcessRuntimeConfig(): RateLimitRuntimeConfig {
  return {
    redisUrl: process.env.UPSTASH_REDIS_REST_URL?.trim() || undefined,
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || undefined,
    requests: {
      global: getPositiveIntegerEnv(
        "RATE_LIMIT_GLOBAL_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.global.fallback
      ),
      auth: getPositiveIntegerEnv(
        "RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.auth.fallback
      ),
      ai: getPositiveIntegerEnv(
        "RATE_LIMIT_AI_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.ai.fallback
      ),
      payment: getPositiveIntegerEnv(
        "RATE_LIMIT_PAYMENT_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.payment.fallback
      ),
      upload: getPositiveIntegerEnv(
        "RATE_LIMIT_UPLOAD_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.upload.fallback
      ),
      strict: getPositiveIntegerEnv(
        "RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.strict.fallback
      ),
    },
  };
}

/**
 * 给异步配置读取设置上限，避免缓存后端故障拖住业务请求。
 *
 * @param promise - 配置读取任务
 * @param timeoutMs - 最大等待毫秒数
 * @returns 原任务结果
 * @throws 超时后抛出错误，由调用方降级到最后一次有效配置
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`配置读取超过 ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 对配置或 Upstash 故障做节流告警，避免高流量时刷屏。
 *
 * @param message - 不含凭据的告警上下文
 * @param error - 原始异常
 */
function warnRateLimitFailure(message: string, error: unknown) {
  const now = Date.now();
  if (now - lastWarningAt < WARNING_THROTTLE_MS) return;
  lastWarningAt = now;
  logWarn(`[rate-limit] ${message}`, {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

/**
 * 读取完整的运行时限流配置。
 *
 * @returns 当前配置；读取失败时回退到最后一次有效值或进程环境
 */
async function getRuntimeConfig(): Promise<RateLimitRuntimeConfig> {
  const readConfig = async (): Promise<RateLimitRuntimeConfig> => {
    const [redisUrl, redisToken] = await Promise.all([
      getRuntimeSettingString("UPSTASH_REDIS_REST_URL"),
      getRuntimeSettingString("UPSTASH_REDIS_REST_TOKEN"),
    ]);
    const types = Object.keys(RATE_LIMIT_DEFINITIONS) as RateLimitType[];
    const thresholds = await Promise.all(
      types.map((type) => {
        const definition = RATE_LIMIT_DEFINITIONS[type];
        return getRuntimeSettingNumber(
          definition.settingKey,
          definition.fallback,
          { positive: true }
        );
      })
    );
    const requests = { ...getProcessRuntimeConfig().requests };
    for (const [index, type] of types.entries()) {
      const threshold = thresholds[index];
      requests[type] = Math.max(
        1,
        Math.trunc(threshold ?? RATE_LIMIT_DEFINITIONS[type].fallback)
      );
    }
    return { redisUrl, redisToken, requests };
  };

  try {
    const config = await withTimeout(readConfig(), CONFIG_READ_TIMEOUT_MS);
    lastKnownConfig = config;
    return config;
  } catch (error) {
    warnRateLimitFailure("读取运行时配置失败，已使用安全回退配置", error);
    return lastKnownConfig ?? getProcessRuntimeConfig();
  }
}

/**
 * 检查当前运行时配置是否包含完整 Upstash 凭据。
 *
 * @returns URL 与 Token 均存在时为 true
 */
export async function isRateLimitEnabled(): Promise<boolean> {
  const config = await getRuntimeConfig();
  return Boolean(config.redisUrl && config.redisToken);
}

/**
 * 读取环境变量中的正整数，供兼容配置视图与故障回退使用。
 *
 * @param name - 环境变量名
 * @param fallback - 无效值的默认值
 * @returns 正整数阈值
 */
function getPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/**
 * 兼容既有调用方的进程环境配置视图。
 * 业务限流不使用该静态视图，而是在每次检查时读取缓存后的运行时设置。
 */
export const RateLimitConfig = {
  global: {
    get requests() {
      return getPositiveIntegerEnv(
        "RATE_LIMIT_GLOBAL_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.global.fallback
      );
    },
    window: "1m" as const,
  },
  auth: {
    get requests() {
      return getPositiveIntegerEnv(
        "RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.auth.fallback
      );
    },
    window: "1m" as const,
  },
  ai: {
    get requests() {
      return getPositiveIntegerEnv(
        "RATE_LIMIT_AI_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.ai.fallback
      );
    },
    window: "1m" as const,
  },
  payment: {
    get requests() {
      return getPositiveIntegerEnv(
        "RATE_LIMIT_PAYMENT_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.payment.fallback
      );
    },
    window: "1m" as const,
  },
  upload: {
    get requests() {
      return getPositiveIntegerEnv(
        "RATE_LIMIT_UPLOAD_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.upload.fallback
      );
    },
    window: "1m" as const,
  },
  strict: {
    get requests() {
      return getPositiveIntegerEnv(
        "RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE",
        RATE_LIMIT_DEFINITIONS.strict.fallback
      );
    },
    window: "1m" as const,
  },
} as const;

/**
 * 按连接指纹获取 Redis 客户端；凭据变化时清空旧限流器。
 *
 * @param config - 当前运行时配置
 * @returns 已配置时返回 Redis，否则返回 null 以启用内存兜底
 */
function getRedis(config: RateLimitRuntimeConfig): Redis | null {
  const connectionFingerprint = createHash("sha256")
    .update(JSON.stringify([config.redisUrl ?? "", config.redisToken ?? ""]))
    .digest("hex");
  if (resources.connectionFingerprint === connectionFingerprint) {
    return resources.redis;
  }

  resources.connectionFingerprint = connectionFingerprint;
  resources.limiters.clear();
  if (!config.redisUrl || !config.redisToken) {
    resources.redis = null;
    return null;
  }

  resources.redis = new Redis({
    url: config.redisUrl,
    token: config.redisToken,
    // 每条 REST 请求使用独立信号；复用一个已超时的 signal 会让后续请求全失败。
    signal: () => AbortSignal.timeout(UPSTASH_REQUEST_TIMEOUT_MS),
  });
  return resources.redis;
}

/**
 * 按连接与阈值指纹获取限流器。
 *
 * @param type - 限流类别
 * @param config - 当前运行时配置
 * @returns 已配置 Upstash 时返回限流器，否则返回 null
 */
function getLimiter(
  type: RateLimitType,
  config: RateLimitRuntimeConfig
): Ratelimit | null {
  const redisClient = getRedis(config);
  if (!redisClient) return null;

  const fingerprint = `${resources.connectionFingerprint}\u0000${
    config.requests[type]
  }`;
  const cached = resources.limiters.get(type);
  if (cached?.fingerprint === fingerprint) return cached.limiter;

  const limiter = new Ratelimit({
    redis: redisClient,
    limiter: Ratelimit.slidingWindow(config.requests[type], "1m"),
    prefix: `ratelimit:${type}`,
    analytics: true,
    // Redis 客户端负责中止慢请求；禁用 SDK 的 fail-open timeout，异常统一走内存兜底。
    timeout: 0,
  });

  resources.limiters.set(type, { fingerprint, limiter });
  return limiter;
}

// ============================================
// 限流检查函数
// ============================================

/**
 * 限流检查结果
 */
export interface RateLimitResult {
  /** 是否允许请求 */
  success: boolean;
  /** 剩余请求数 */
  remaining: number;
  /** 重置时间（毫秒时间戳）*/
  reset: number;
  /** 限制数 */
  limit: number;
  /** 是否跳过了限流检查（未配置时）*/
  skipped: boolean;
}

/**
 * 检查限流
 *
 * @param identifier - 唯一标识符（如 IP 或 userId）
 * @param type - 限流类型
 * @returns 限流检查结果
 *
 * @example
 * ```ts
 * const result = await checkRateLimit(ip, "auth");
 * if (!result.success) {
 *   return new Response("Too Many Requests", { status: 429 });
 * }
 * ```
 */
// ============================================
// 内存兜底限流（未配置 Upstash 时，对敏感类型生效）
// ============================================

interface MemoryRateBucket {
  count: number;
  reset: number;
}

const memoryBuckets = new Map<string, MemoryRateBucket>();

/**
 * 单实例内存限流。用于未配置 Upstash 时所有限流类型的兜底，
 * 避免认证 / 验证码 / 注册等敏感端点以及生图 / 上传 / 支付等成本敏感端点
 * 完全 fail-open 被暴力破解、刷量或高频打满上游配额。
 * 窗口内放行不超过配置阈值的请求，故正常流量不受影响，仅拦截异常高频。
 * 多实例部署下不跨实例共享——生产应配置 Upstash 获得分布式限流。
 */
function checkMemoryRateLimit(
  identifier: string,
  type: RateLimitType,
  requests: number
): RateLimitResult {
  const now = Date.now();
  const key = `${type}:${identifier}`;
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.reset <= now) {
    if (memoryBuckets.size > 10000) {
      for (const [k, v] of memoryBuckets) {
        if (v.reset <= now) memoryBuckets.delete(k);
      }
    }
    memoryBuckets.set(key, { count: 1, reset: now + MEMORY_WINDOW_MS });
    return {
      success: true,
      remaining: requests - 1,
      reset: now + MEMORY_WINDOW_MS,
      limit: requests,
      skipped: false,
    };
  }

  bucket.count += 1;
  return {
    success: bucket.count <= requests,
    remaining: Math.max(0, requests - bucket.count),
    reset: bucket.reset,
    limit: requests,
    skipped: false,
  };
}

export async function checkRateLimit(
  identifier: string,
  type: RateLimitType = "global"
): Promise<RateLimitResult> {
  const config = await getRuntimeConfig();
  const limiter = getLimiter(type, config);

  // 未配置 Upstash：所有类型走单实例内存兜底限流，不再对成本敏感类型
  // （ai/upload/payment/global）fail-open。窗口内放行不超过阈值的请求，
  // 正常流量无感，仅拦截单 IP / 单 key 的异常高频，防止默认部署下零限流被
  // 无限刷量打满上游配额或暴力破解。生产应配置 Upstash 获得分布式限流。
  if (!limiter) {
    return checkMemoryRateLimit(identifier, type, config.requests[type]);
  }

  try {
    const result = await limiter.limit(identifier);

    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
      limit: result.limit,
      skipped: false,
    };
  } catch (error) {
    // 分布式限流不可用时仍执行单实例限流，避免外部服务故障造成无限 fail-open。
    warnRateLimitFailure("Upstash 请求失败，已降级到内存限流", error);
    return checkMemoryRateLimit(identifier, type, config.requests[type]);
  }
}

// ============================================
// 辅助函数
// ============================================

/**
 * 是否存在可信前置代理。
 *
 * WHY：cf-connecting-ip / x-real-ip / x-forwarded-for 这些头全部由 HTTP 客户端
 * 可写，只有当一个可信反代（Cloudflare / Nginx 等）覆盖写并清空伪造值时才可信。
 * 默认部署（docker-compose 直接暴露 web 端口、无反代）下三者均客户端可控，
 * 攻击者每次带随机 cf-connecting-ip 即可获得全新限流桶绕过 per-IP 限流。
 *
 * 为不破坏 Cloudflare / Nginx 既有部署（依赖这些头做真实 IP 归因），默认信任
 * 这些头；直接对公网暴露的部署应显式设置 RATE_LIMIT_TRUSTED_PROXY=false，
 * 关闭信任后所有请求归并到同一兜底标识，使 per-IP 限流退化为整体限流而非被旁路。
 */
function isTrustedProxyEnabled(): boolean {
  const value = process.env.RATE_LIMIT_TRUSTED_PROXY?.trim().toLowerCase();
  // 仅 "false" / "0" / "no" 显式关闭；未配置时保持向后兼容（默认信任）。
  return value !== "false" && value !== "0" && value !== "no";
}

/**
 * 从 NextRequest 获取客户端 IP，用作 per-IP 限流标识。
 *
 * @param request - 入站请求
 * @returns 客户端 IP 字符串；无可信来源时返回固定兜底标识
 *
 * 取值优先级：cf-connecting-ip → x-real-ip → x-forwarded-for 最左字段。
 * 前两者为受信反代设置的单值头；x-forwarded-for 最左字段由客户端可控，
 * 故放在最后兜底。这些头都不是天然防伪造的——仅在前置可信反代覆盖写时可信
 * （见 isTrustedProxyEnabled）。未声明可信代理时全部忽略，回退固定兜底标识，
 * 避免攻击者伪造头轮换 IP 旁路限流。
 */
export function getClientIp(request: NextRequest): string {
  if (!isTrustedProxyEnabled()) {
    // 无可信前置代理：所有转发头均不可信，统一归并到固定标识。
    // per-IP 限流在此降级为整体限流，宁可误伤共享出口也不被伪造头旁路。
    return "untrusted-proxy";
  }

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) {
    return cfIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  return "unknown";
}

/**
 * 生成限流响应头
 */
export function getRateLimitHeaders(result: RateLimitResult): HeadersInit {
  if (result.skipped) {
    return {};
  }

  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  };
}

/**
 * 创建 429 Too Many Requests 响应
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
  const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message: "请求过于频繁，请稍后再试",
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        ...getRateLimitHeaders(result),
      },
    }
  );
}

// ============================================
// 高级 API：带限流的请求处理
// ============================================

/**
 * 限流包装器选项
 */
export interface WithRateLimitOptions {
  /** 限流类型 */
  type?: RateLimitType;
  /** 自定义标识符获取函数 */
  getIdentifier?: (request: NextRequest) => string | Promise<string>;
}

/**
 * 限流中间件包装器
 *
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   return withRateLimit(request, { type: "auth" }, async () => {
 *     // 你的业务逻辑
 *     return NextResponse.json({ success: true });
 *   });
 * }
 * ```
 */
export async function withRateLimit<T extends Response>(
  request: NextRequest,
  options: WithRateLimitOptions,
  handler: () => Promise<T>
): Promise<T | Response> {
  const { type = "global", getIdentifier = getClientIp } = options;

  const identifier = await getIdentifier(request);
  const result = await checkRateLimit(identifier, type);

  if (!result.success) {
    return createRateLimitResponse(result);
  }

  const response = await handler();

  // 添加限流头到响应
  const headers = getRateLimitHeaders(result);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}
