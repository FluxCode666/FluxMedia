/**
 * 支付宝当面付适配器。
 *
 * 使用方：积分充值订单服务和支付宝异步通知路由。
 * 关键依赖：官方 alipay-sdk、system-settings、支付基础地址配置。
 *
 * 安全边界：本模块只负责请求支付宝和验签；金额、订单归属、卖家和履约幂等
 * 由订单服务校验。私钥、公钥及支付宝响应中的二维码不得写入日志。
 */
import { AlipaySdk } from "alipay-sdk";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { z } from "zod";

import { getBaseUrl } from "../config/payment";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "../system-settings";

const ALIPAY_PRODUCTION_GATEWAY = "https://openapi.alipay.com/gateway.do";

const alipayPrecreateResponseSchema = z
  .object({
    code: z.string(),
    msg: z.string(),
    subCode: z.string().optional(),
    subMsg: z.string().optional(),
    outTradeNo: z.string().optional(),
    qrCode: z.string().url().optional(),
  })
  .passthrough();

export type AlipayF2FConfig = {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  sellerId?: string;
  gateway: string;
  notifyUrl: string;
  timeoutMinutes: number;
};

export type AlipayF2FPrecreateInput = {
  outTradeNo: string;
  amount: number;
  subject: string;
};

export type AlipayF2FPrecreateResult = {
  qrCode: string;
  expiresAt: Date;
};

/** 支付宝可履约的交易状态。 */
export function isSuccessfulAlipayTradeStatus(value: string | undefined) {
  return value === "TRADE_SUCCESS" || value === "TRADE_FINISHED";
}

/** 将人民币主单位格式化为支付宝要求的两位小数字符串。 */
export function formatAlipayCnyAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("支付宝订单金额无效");
  }
  return amount.toFixed(2);
}

/**
 * 将支付宝回调中的 CNY 字符串严格转为分。
 *
 * 不接受科学计数法、负数或超过两位小数，避免 Number 的宽松解析把畸形回调
 * 误当成已支付金额；允许 `1`、`1.0` 与 `1.00` 三种支付宝常见格式。
 */
export function parseAlipayCnyAmountMinor(value: string): number | null {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = whole * 100 + fraction;
  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
}

function resolvePrivateKeyType(privateKey: string): "PKCS1" | "PKCS8" {
  return privateKey.includes("BEGIN PRIVATE KEY") ? "PKCS8" : "PKCS1";
}

/**
 * 将单行 Base64 的支付宝密钥恢复为 PEM，并保留已带 PEM 头的输入。
 *
 * 支付宝开放平台经常以无头尾、无换行的 Base64 形式展示公钥或私钥；直接交给
 * Node crypto / alipay-sdk 会被视为无效密钥。这里仅在内存中规范化，绝不记录
 * 原始密钥内容，并通过 Node crypto 验证密钥类型，避免把任意文本传给支付 SDK。
 */
function normalizeAlipayKey(input: {
  value: string;
  kind: "private" | "public";
}) {
  const value = input.value.trim().replaceAll("\\n", "\n");
  if (value.includes("-----BEGIN")) return value;

  const body = value.replaceAll(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error(
      `支付宝${input.kind === "private" ? "私钥" : "公钥"}格式无效`
    );
  }

  const candidates =
    input.kind === "private"
      ? ["RSA PRIVATE KEY", "PRIVATE KEY"]
      : ["PUBLIC KEY", "RSA PUBLIC KEY"];
  for (const label of candidates) {
    const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
    const pem = `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
    try {
      if (input.kind === "private") {
        createPrivateKey(pem);
      } else {
        createPublicKey(pem);
      }
      return pem;
    } catch {
      // 同一 Base64 可能是 PKCS#1 或 PKCS#8/SPKI，依次尝试而不泄露密钥内容。
    }
  }

  throw new Error(
    `支付宝${input.kind === "private" ? "私钥" : "公钥"}格式无效`
  );
}

/**
 * 读取支付宝运行时配置。配置缺失时显式失败而非静默回退，避免用户扫描
 * 无法到账的二维码。
 */
export async function getRuntimeAlipayF2FConfig(): Promise<AlipayF2FConfig> {
  const [
    appId,
    privateKey,
    alipayPublicKey,
    sellerId,
    gateway,
    notifyUrl,
    timeoutMinutes,
  ] = await Promise.all([
    getRuntimeSettingString("ALIPAY_APP_ID"),
    getRuntimeSettingString("ALIPAY_PRIVATE_KEY"),
    getRuntimeSettingString("ALIPAY_PUBLIC_KEY"),
    getRuntimeSettingString("ALIPAY_SELLER_ID"),
    getRuntimeSettingString("ALIPAY_GATEWAY"),
    getRuntimeSettingString("ALIPAY_NOTIFY_URL"),
    getRuntimeSettingNumber("ALIPAY_F2F_TIMEOUT_MINUTES", 30, {
      positive: true,
    }),
  ]);

  if (!appId || !privateKey || !alipayPublicKey) {
    throw new Error("支付宝当面付配置不完整");
  }

  const resolvedGateway = gateway || ALIPAY_PRODUCTION_GATEWAY;
  const parsedGateway = new URL(resolvedGateway);
  if (parsedGateway.protocol !== "https:") {
    throw new Error("支付宝网关必须使用 HTTPS");
  }
  const resolvedNotifyUrl = notifyUrl || `${getBaseUrl()}/api/webhooks/alipay`;
  const parsedNotifyUrl = new URL(resolvedNotifyUrl);
  if (
    parsedNotifyUrl.protocol !== "https:" &&
    parsedNotifyUrl.protocol !== "http:"
  ) {
    throw new Error("支付宝通知地址必须使用 HTTP 或 HTTPS");
  }

  return {
    appId,
    privateKey: normalizeAlipayKey({ value: privateKey, kind: "private" }),
    alipayPublicKey: normalizeAlipayKey({
      value: alipayPublicKey,
      kind: "public",
    }),
    ...(sellerId ? { sellerId } : {}),
    gateway: parsedGateway.toString(),
    notifyUrl: parsedNotifyUrl.toString(),
    timeoutMinutes: Math.min(1_440, Math.max(1, Math.floor(timeoutMinutes))),
  };
}

/** 仅在开关与完整密钥均存在时返回 true。 */
export async function isRuntimeAlipayF2FConfigured() {
  if (!(await getRuntimeSettingBoolean("ALIPAY_F2F_ENABLED", false))) {
    return false;
  }
  try {
    await getRuntimeAlipayF2FConfig();
    return true;
  } catch {
    return false;
  }
}

function createAlipayClient(config: AlipayF2FConfig) {
  return new AlipaySdk({
    appId: config.appId,
    privateKey: config.privateKey,
    alipayPublicKey: config.alipayPublicKey,
    gateway: config.gateway,
    signType: "RSA2",
    keyType: resolvePrivateKeyType(config.privateKey),
    camelcase: true,
    timeout: 10_000,
  });
}

/**
 * 创建支付宝当面付预下单并返回二维码承载 URL。
 *
 * @throws 当支付宝返回非成功代码、回包结构异常或缺少二维码时抛出。
 */
export async function createAlipayF2FPrecreate(
  input: AlipayF2FPrecreateInput
): Promise<AlipayF2FPrecreateResult> {
  const config = await getRuntimeAlipayF2FConfig();
  const client = createAlipayClient(config);
  const result = await client.exec(
    "alipay.trade.precreate",
    {
      notifyUrl: config.notifyUrl,
      bizContent: {
        outTradeNo: input.outTradeNo,
        totalAmount: formatAlipayCnyAmount(input.amount),
        subject: input.subject,
        timeoutExpress: `${config.timeoutMinutes}m`,
        ...(config.sellerId ? { sellerId: config.sellerId } : {}),
      },
    },
    { validateSign: true }
  );
  const parsed = alipayPrecreateResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error("支付宝预下单响应格式无效");
  }
  if (parsed.data.code !== "10000" || !parsed.data.qrCode) {
    throw new Error(
      `支付宝预下单失败：${parsed.data.subMsg ?? parsed.data.msg}`
    );
  }
  if (
    parsed.data.outTradeNo !== undefined &&
    parsed.data.outTradeNo !== input.outTradeNo
  ) {
    throw new Error("支付宝预下单订单号不一致");
  }

  return {
    qrCode: parsed.data.qrCode,
    expiresAt: new Date(Date.now() + config.timeoutMinutes * 60_000),
  };
}

/**
 * 对支付宝异步通知进行官方 RSA2 验签。
 *
 * @param params - 平台 FormData 已解码一次的表单字段；SDK V2 不会再次 decode
 *   value，调用方不得再自行做 URI 解码或重写字段。
 */
export async function verifyRuntimeAlipayNotification(
  params: Record<string, string>
) {
  const config = await getRuntimeAlipayF2FConfig();
  return createAlipayClient(config).checkNotifySignV2(params);
}

/** 读取支付宝回调表单，拒绝 JSON 等非官方通知形态。 */
export async function parseAlipayNotificationParams(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    throw new Error("支付宝通知必须使用表单编码");
  }
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}
