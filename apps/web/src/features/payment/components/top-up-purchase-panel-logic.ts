/**
 * 按金额充值面板的金额纯逻辑。
 *
 * 使用方：充值客户端组件。所有计算以最小货币单位完成，服务端仍是最终报价真相。
 */
import {
  amountMinorToMajor,
  getCurrencyMinorUnitExponent,
} from "@repo/shared/credits/top-up";

const QUICK_AMOUNT_MAJOR_UNITS = [10, 50, 100, 200, 500] as const;

type TopUpAmountBounds = {
  currency: string;
  minAmountMinor: number;
  maxAmountMinor: number;
};

/**
 * 解析用户输入为最小货币单位。
 *
 * @param value 未本地化、可能非法的输入字符串。
 * @param currency ISO 4217 币种代码。
 * @returns 安全正整数；格式、精度或范围非法时返回 null。
 */
export function parseTopUpAmountMinor(
  value: string,
  currency: string
): number | null {
  const exponent = getCurrencyMinorUnitExponent(currency);
  const normalized = value.trim();
  const expression =
    exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${exponent}})?$`);
  if (!expression.test(normalized)) return null;

  const amountMinor = Math.round(Number(normalized) * 10 ** exponent);
  return Number.isSafeInteger(amountMinor) && amountMinor > 0
    ? amountMinor
    : null;
}

/**
 * 将最小货币单位格式化为可再次提交的非本地化输入值。
 *
 * @param amountMinor 安全整数金额。
 * @param currency ISO 4217 币种代码。
 * @returns 不含分组符且移除多余末尾零的十进制字符串。
 */
export function formatTopUpInputAmount(
  amountMinor: number,
  currency: string
): string {
  const exponent = getCurrencyMinorUnitExponent(currency);
  if (exponent === 0) return String(amountMinor);
  return amountMinorToMajor(amountMinor, currency)
    .toFixed(exponent)
    .replace(/\.?0+$/, "");
}

/**
 * 从固定主单位候选中筛出运行时配置允许的快捷金额。
 *
 * @param bounds 当前币种及服务端提供的最小、最大金额。
 * @returns 升序、去重的最小货币单位数组；没有候选时允许返回空数组。
 */
export function getTopUpQuickAmounts(bounds: TopUpAmountBounds): number[] {
  const factor = 10 ** getCurrencyMinorUnitExponent(bounds.currency);
  return Array.from(
    new Set(QUICK_AMOUNT_MAJOR_UNITS.map((amount) => amount * factor))
  ).filter(
    (amountMinor) =>
      amountMinor >= bounds.minAmountMinor &&
      amountMinor <= bounds.maxAmountMinor
  );
}
