/**
 * 积分按金额充值配置与报价纯逻辑。
 *
 * 使用方：支付订单服务、后台系统设置面板与 DB-free 单测。
 * 关键依赖：无；运行时读取设置由调用方完成，以保持本模块不依赖数据库。
 *
 * WHY：金额、币种和兑换比例必须在支付订单创建时由服务端统一报价并冻结。
 * 浮点误差或回调时重读配置都可能造成多发积分，因此这里以最小货币单位输入，
 * 并将积分向下截断到两位小数。
 */

export const CREDIT_TOP_UP_CONFIG_SETTING_KEY = "CREDIT_TOP_UP_CONFIG";

export const CREDIT_TOP_UP_PAYMENT_PROVIDERS = ["alipay_f2f"] as const;

export type CreditTopUpPaymentProvider =
  (typeof CREDIT_TOP_UP_PAYMENT_PROVIDERS)[number];

export type CreditTopUpCurrencyConfig = {
  currency: string;
  creditsPerMajorUnit: number;
  minAmountMinor: number;
  maxAmountMinor: number;
  enabled: boolean;
  providers: CreditTopUpPaymentProvider[];
};

export type CreditTopUpConfig = {
  enabled: boolean;
  defaultCurrency: string;
  currencies: CreditTopUpCurrencyConfig[];
};

export type CreditTopUpQuote = {
  currency: string;
  amountMinor: number;
  amount: number;
  creditsAmount: number;
  creditsPerMajorUnit: number;
  provider: CreditTopUpPaymentProvider;
};

const MAX_CREDITS_PER_MAJOR_UNIT = 100_000_000;
const MAX_AMOUNT_MINOR = 1_000_000_000_000;

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "KWD", "OMR"]);

export const DEFAULT_CREDIT_TOP_UP_CONFIG: CreditTopUpConfig = {
  enabled: true,
  defaultCurrency: "CNY",
  currencies: [
    {
      currency: "CNY",
      creditsPerMajorUnit: 10,
      minAmountMinor: 100,
      maxAmountMinor: 1_000_000,
      enabled: true,
      providers: ["alipay_f2f"],
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePositiveNumber(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parsePositiveInteger(value: unknown, fallback: number, max: number) {
  return Math.floor(parsePositiveNumber(value, fallback, max));
}

function normalizeCurrency(value: unknown, fallback?: string): string | null {
  const currency =
    typeof value === "string" && value.trim()
      ? value.trim().toUpperCase()
      : fallback;
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function normalizeProviders(value: unknown, currency: string) {
  const providers = Array.isArray(value)
    ? value.filter(
        (provider): provider is CreditTopUpPaymentProvider =>
          typeof provider === "string" &&
          CREDIT_TOP_UP_PAYMENT_PROVIDERS.includes(
            provider as CreditTopUpPaymentProvider
          )
      )
    : [];

  // 官方支付宝当面付仅支持人民币；配置层在此过滤，保证 UI/API 都不会向
  // 不支持的币种错误暴露该通道。
  return Array.from(
    new Set(providers.filter((provider) => provider !== "alipay_f2f" || currency === "CNY"))
  );
}

/**
 * 返回 ISO 4217 币种的最小货币单位指数。
 *
 * @param currency - 三位 ISO 币种代码。
 * @returns 0、2 或 3；未知币种按绝大多数货币的 2 位小数处理。
 */
export function getCurrencyMinorUnitExponent(currency: string): number {
  const normalized = currency.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return 2;
}

/**
 * 按最小货币单位将金额转为主单位，避免用客户端浮点数作为计费输入。
 */
export function amountMinorToMajor(amountMinor: number, currency: string) {
  return amountMinor / 10 ** getCurrencyMinorUnitExponent(currency);
}

/**
 * 解析管理员的充值 JSON；无效字段回退为默认值，空数组则整体回退默认配置。
 */
export function normalizeCreditTopUpConfig(raw: unknown): CreditTopUpConfig {
  if (!isRecord(raw)) return DEFAULT_CREDIT_TOP_UP_CONFIG;

  const fallbackByCurrency = new Map(
    DEFAULT_CREDIT_TOP_UP_CONFIG.currencies.map((item) => [
      item.currency,
      item,
    ])
  );
  const currencies = Array.isArray(raw.currencies)
    ? raw.currencies
        .map((item) => {
          if (!isRecord(item)) return null;
          const currency = normalizeCurrency(item.currency);
          if (!currency) return null;
          const fallback = fallbackByCurrency.get(currency);
          const minAmountMinor = parsePositiveInteger(
            item.minAmountMinor,
            fallback?.minAmountMinor ?? 1,
            MAX_AMOUNT_MINOR
          );
          const maxAmountMinor = parsePositiveInteger(
            item.maxAmountMinor,
            fallback?.maxAmountMinor ?? MAX_AMOUNT_MINOR,
            MAX_AMOUNT_MINOR
          );
          return {
            currency,
            creditsPerMajorUnit: parsePositiveNumber(
              item.creditsPerMajorUnit,
              fallback?.creditsPerMajorUnit ?? 1,
              MAX_CREDITS_PER_MAJOR_UNIT
            ),
            minAmountMinor,
            maxAmountMinor: Math.max(minAmountMinor, maxAmountMinor),
            enabled:
              typeof item.enabled === "boolean"
                ? item.enabled
                : (fallback?.enabled ?? true),
            providers: normalizeProviders(
              item.providers,
              currency
            ),
          } satisfies CreditTopUpCurrencyConfig;
        })
        .filter((item): item is CreditTopUpCurrencyConfig => Boolean(item))
    : [];

  const normalizedCurrencies =
    currencies.length > 0
      ? Array.from(
          new Map(currencies.map((item) => [item.currency, item])).values()
        )
      : DEFAULT_CREDIT_TOP_UP_CONFIG.currencies;
  const defaultCurrency = normalizeCurrency(
    raw.defaultCurrency,
    DEFAULT_CREDIT_TOP_UP_CONFIG.defaultCurrency
  );

  return {
    enabled:
      typeof raw.enabled === "boolean"
        ? raw.enabled
        : DEFAULT_CREDIT_TOP_UP_CONFIG.enabled,
    defaultCurrency:
      normalizedCurrencies.some((item) => item.currency === defaultCurrency)
        ? (defaultCurrency ?? DEFAULT_CREDIT_TOP_UP_CONFIG.defaultCurrency)
        : (normalizedCurrencies[0]?.currency ??
          DEFAULT_CREDIT_TOP_UP_CONFIG.defaultCurrency),
    currencies: normalizedCurrencies,
  };
}

/**
 * 基于已规范化配置生成充值报价。
 *
 * @throws 当币种、金额区间或支付通道不受支持时抛出安全的业务错误。
 */
export function quoteCreditTopUp(input: {
  config: CreditTopUpConfig;
  currency: string;
  amountMinor: number;
  provider: CreditTopUpPaymentProvider;
}): CreditTopUpQuote {
  if (!input.config.enabled) {
    throw new Error("积分充值暂未开放");
  }
  const currency = normalizeCurrency(input.currency);
  if (!currency) throw new Error("不支持的充值币种");
  const amountMinor = Math.trunc(input.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("充值金额无效");
  }

  const currencyConfig = input.config.currencies.find(
    (item) => item.currency === currency && item.enabled
  );
  if (!currencyConfig) throw new Error("该币种暂未开放充值");
  if (!currencyConfig.providers.includes(input.provider)) {
    throw new Error("该币种不支持所选支付方式");
  }
  if (
    amountMinor < currencyConfig.minAmountMinor ||
    amountMinor > currencyConfig.maxAmountMinor
  ) {
    throw new Error("充值金额超出允许范围");
  }

  const amount = amountMinorToMajor(amountMinor, currency);
  // 向下截断确保永不因 IEEE 754 误差多发积分；积分账本最多保留两位小数。
  const creditsAmount = Math.floor(
    (amount * currencyConfig.creditsPerMajorUnit + Number.EPSILON) * 100
  ) / 100;
  if (creditsAmount <= 0) throw new Error("充值金额不足以兑换积分");

  return {
    currency,
    amountMinor,
    amount,
    creditsAmount,
    creditsPerMajorUnit: currencyConfig.creditsPerMajorUnit,
    provider: input.provider,
  };
}
