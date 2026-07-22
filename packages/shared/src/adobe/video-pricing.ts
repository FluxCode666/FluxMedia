/**
 * Adobe Firefly 视频固定每秒积分计算（纯函数，DB-free，可单测）。
 *
 * 使用方：视频生成扣费与创作页预估。每个模型族可配置自己的每秒价格；未配置族回退
 * 全局每秒基价。模块不读取 DB 或运行时设置，确保预估和实扣共用同一计算口径。
 */

export const DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND = 30;
export const MAX_VIDEO_CREDITS_PER_SECOND = 100_000;

/** 判断每秒积分是否可安全参与计费。 */
function isValidCreditsPerSecond(value: number): boolean {
  return (
    Number.isFinite(value) && value > 0 && value <= MAX_VIDEO_CREDITS_PER_SECOND
  );
}

/** 向上取到两位小数，避免积分计费下溢和浮点噪声。 */
function ceil2(value: number): number {
  const cents = Math.round(value * 1_000_000) / 10_000;
  const result = Math.ceil(cents - 1e-9) / 100;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * 解析视频模型族的每秒积分价格。
 *
 * @param family - 视频模型族。
 * @param prices - `VIDEO_MODEL_CREDITS_PER_SECOND` 的 family → 每秒积分 map。
 * @param fallback - 未配置模型族时使用的统一每秒基价。
 * @returns 正数配置值，或有效的回退基价。
 */
export function resolveVideoCreditsPerSecond(
  family: string | null | undefined,
  prices: Record<string, number> | null | undefined,
  fallback: number = DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND
): number {
  const safeFallback = isValidCreditsPerSecond(fallback)
    ? fallback
    : DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND;
  if (!family || !prices) return safeFallback;
  const value = prices[family];
  return typeof value === "number" && isValidCreditsPerSecond(value)
    ? value
    : safeFallback;
}

/**
 * 计算一次视频生成的积分成本。
 *
 * @param durationSeconds - 视频时长（秒）。
 * @param creditsPerSecond - 已按模型族解析的每秒积分价格。
 * @returns 向上取到两位小数的总积分。
 */
export function getVideoCreditCost(params: {
  durationSeconds: number;
  creditsPerSecond?: number | null;
}): number {
  const creditsPerSecond =
    typeof params.creditsPerSecond === "number" &&
    isValidCreditsPerSecond(params.creditsPerSecond)
      ? params.creditsPerSecond
      : DEFAULT_VIDEO_BASE_CREDITS_PER_SECOND;
  const duration = Math.max(0, params.durationSeconds || 0);
  return ceil2(creditsPerSecond * duration);
}
