/**
 * 已鉴权内容审核代理入口。
 *
 * 职责：先验证 proxy-secret，再严格校验跨进程审核输入并执行本地审核；只接受
 * 图像管线已解析的生效审核级别，禁止请求端重新提交套餐或用户治理字段。
 */
import {
  moderateContent,
  type ModerationImageInput,
} from "@repo/shared/moderation";
import {
  moderationBlockRiskLevelSchema,
} from "@repo/shared/moderation/policy-contract";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { secretMatchesAny } from "./proxy-secret";

const moderationRequestImageSchema = z
  .object({
    data: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

const moderationProxyRequestSchema = z
  .object({
    prompt: z.string().refine((value) => value.trim().length > 0),
    images: z.array(moderationRequestImageSchema).optional(),
    mode: z.enum(["image", "text"]).optional(),
    userId: z.string().optional(),
    generationId: z.string().optional(),
    effectiveBlockRiskLevel: moderationBlockRiskLevelSchema,
  })
  .strict();

type ModerationRequestImage = z.infer<typeof moderationRequestImageSchema>;

/** 构造不泄露内部校验细节的 JSON 错误响应。 */
function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** 读取当前允许的代理密钥，空配置保持端点关闭。 */
async function getProxySecrets() {
  return [
    await getRuntimeSettingString("CONTENT_MODERATION_PROXY_SECRET"),
    await getRuntimeSettingString("CONTENT_MODERATION_PROXY_GATEWAY_SECRET"),
  ].filter((value): value is string => Boolean(value));
}

/** 在读取请求体前恒定时间校验 Bearer 或专用代理密钥头。 */
async function verifyProxySecret(request: NextRequest) {
  const secrets = await getProxySecrets();
  // Fail-closed：未配置代理密钥时，该端点保持关闭（401），
  // 避免成为未鉴权的审核 oracle / 成本放大入口。
  if (secrets.length === 0) return false;

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-moderation-proxy-secret") || "";
  // 用恒定时间比对（sha256 + timingSafeEqual）替代 Array.includes 的原生短路
  // 字符串比较，避免计时侧信道，与全仓其它鉴权入口的标准对齐。
  return (
    secretMatchesAny(bearer, secrets) || secretMatchesAny(headerSecret, secrets)
  );
}

/** 把已校验的 JSON 图片描述转换为审核领域输入。 */
function parseImage(image: ModerationRequestImage): ModerationImageInput | null {
  if (!image.url && !image.data) return null;
  return {
    data: image.data ? Buffer.from(image.data, "base64") : Buffer.alloc(0),
    name: image.name,
    type: image.type || "image/png",
    url: image.url,
  };
}

/** 处理经 proxy-secret 鉴权的跨进程审核请求。 */
export async function POST(request: NextRequest) {
  if (!(await verifyProxySecret(request))) {
    return errorResponse("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const parsed = moderationProxyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid request body");
  }

  const input = parsed.data;
  const images = input.images
    ?.map(parseImage)
    .filter((image): image is ModerationImageInput => Boolean(image));

  const result = await moderateContent({
    prompt: input.prompt,
    images,
    mode: input.mode,
    userId: input.userId,
    effectiveBlockRiskLevel: input.effectiveBlockRiskLevel,
    generationId: input.generationId,
    skipProxy: true,
  });

  return NextResponse.json(result);
}
