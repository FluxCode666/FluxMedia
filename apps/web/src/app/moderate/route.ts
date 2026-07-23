/**
 * 已鉴权内容审核代理入口。
 *
 * 职责：验证 proxy-secret，随后把跨进程审核输入交由 UOL 统一校验和执行；只接受
 * 图像管线已解析的生效审核级别，禁止请求端重新提交套餐或用户治理字段。
 */
import {
  invokeOperation,
  OperationError,
  type Principal,
} from "@repo/shared/uol";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { NextResponse, type NextRequest } from "next/server";
import { ensureUolInitialized } from "@/server/uol-init";
import { secretMatchesAny } from "./proxy-secret";

type ProxySecretKind = Extract<Principal, { type: "proxy" }>["secretKind"];

/** 构造不泄露内部校验细节的 JSON 错误响应。 */
function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * 在读取请求体前恒定时间校验 Bearer 或专用代理密钥头并返回密钥类别。
 *
 * @param request - 尚未读取 body 的审核代理请求。
 * @returns 匹配的 proxy/gateway 类别；未配置或未匹配时返回 null，保持端点关闭。
 * @sideEffects 读取运行时密钥配置；不读取请求 body。
 */
async function verifyProxySecret(
  request: NextRequest
): Promise<ProxySecretKind | null> {
  const [proxySecret, gatewaySecret] = await Promise.all([
    getRuntimeSettingString("CONTENT_MODERATION_PROXY_SECRET"),
    getRuntimeSettingString("CONTENT_MODERATION_PROXY_GATEWAY_SECRET"),
  ]);
  const secrets = [proxySecret, gatewaySecret].filter(
    (value): value is string => Boolean(value)
  );
  // Fail-closed：未配置代理密钥时，该端点保持关闭（401），
  // 避免成为未鉴权的审核 oracle / 成本放大入口。
  if (secrets.length === 0) return null;

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-moderation-proxy-secret") || "";
  // 用恒定时间比对（sha256 + timingSafeEqual）替代 Array.includes 的原生短路
  // 字符串比较，避免计时侧信道，与全仓其它鉴权入口的标准对齐。
  const candidates = [bearer, headerSecret].filter(Boolean);
  let token = "";
  for (const candidate of candidates) {
    if (secretMatchesAny(candidate, secrets) && !token) token = candidate;
  }
  if (!token) return null;
  if (proxySecret && secretMatchesAny(token, [proxySecret])) return "proxy";
  return "gateway";
}

/** 处理经 proxy-secret 鉴权的跨进程审核请求。 */
export async function POST(request: NextRequest) {
  const secretKind = await verifyProxySecret(request);
  if (!secretKind) {
    return errorResponse("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  try {
    await ensureUolInitialized();
    const result = await invokeOperation(
      "moderation.proxyModerate",
      body,
      { type: "proxy", secretKind }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OperationError) {
      return errorResponse(
        error.code === "validation_error" ? "Invalid request body" : error.message,
        error.httpStatus
      );
    }
    throw error;
  }
}
