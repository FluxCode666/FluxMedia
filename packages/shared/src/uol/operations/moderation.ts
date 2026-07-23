/**
 * UOL Operations - Moderation Domain
 *
 * 职责：注册内容审核领域的所有操作到 UOL 注册表。
 * 包含集中式审核策略治理、核心审核编排、提供者查询、启用状态查询与代理端点。
 *
 * 使用方：UOL invoke 网关、MCP 适配器、内置 Agent
 * 关键依赖：policy-contract、policy-service、../registry、zod。
 * policy service 自持数据库事务；本文件只负责权限、输入与错误薄适配。
 */
import { z } from "zod";
import {
  getConfiguredModerationProviders,
  isContentModerationEnabled,
  type ModerateContentInput,
  moderateContent as moderateContentFn,
} from "../../moderation/index";
import {
  moderationBlockRiskLevelSchema,
  moderationPolicyChangeReasonSchema,
} from "../../moderation/policy-contract";
import {
  type ModerationPolicyActor,
  ModerationPolicyServiceError,
  moderationPolicyService,
} from "../../moderation/policy-service";
import { OperationError } from "../errors";
import type { Principal } from "../principal";
import { defineOperation } from "../registry";

// -- 通用子 schema --

/**
 * 审核图片输入 schema - 对应 ModerationImageInput 接口。
 * data 在 proxy 场景为 base64 字符串，url 为公开可访问地址。
 */
const moderationImageInputSchema = z.object({
  data: z.string().optional(),
  type: z.string(),
  name: z.string().optional(),
  url: z.string().optional(),
});

/**
 * 审核决策结果 schema - 对应 ModerationResult 接口。
 * decision: allow/block/skipped/error 四种状态。
 */
const moderationResultSchema = z.object({
  decision: z.enum(["allow", "block", "skipped", "error"]),
  provider: z.string().optional(),
  reason: z.string().optional(),
  details: z.unknown().optional(),
});

/** 管理员读接口与系统 resolver 共用的生效策略输出。 */
const resolvedModerationPolicySchema = z.object({
  globalDefault: moderationBlockRiskLevelSchema,
  userOverride: moderationBlockRiskLevelSchema.nullable(),
  effectiveLevel: moderationBlockRiskLevelSchema,
  source: z.enum(["user_override", "global", "fallback_high"]),
});

/** 全站策略实际写入或无变化时的结构化结果。 */
const globalRiskLevelWriteResultSchema = z.object({
  changed: z.boolean(),
  before: z.unknown(),
  after: moderationBlockRiskLevelSchema,
  auditLogId: z.string().nullable(),
  updatedAt: z.date(),
});

/** 用户覆盖实际写入或无变化时的结构化结果。 */
const userRiskLevelWriteResultSchema = z.object({
  changed: z.boolean(),
  before: z.unknown(),
  after: moderationBlockRiskLevelSchema.nullable(),
  effectiveLevel: moderationBlockRiskLevelSchema,
  source: z.enum(["user_override", "global", "fallback_high"]),
  auditLogId: z.string().nullable(),
  updatedAt: z.date(),
});

/** 审核策略目标用户 ID，空白输入在进入 service 前拒绝。 */
const policyUserIdSchema = z.string().trim().min(1);

/**
 * 从已通过 roles access 的 Principal 构造不可伪造的管理员身份。
 *
 * @param principal - UOL 网关传入的真实调用者。
 * @returns service 所需的用户 ID 与角色；无副作用。
 * @throws OperationError 直接调用 execute 绕过网关且身份不是用户时拒绝。
 */
function requirePolicyActor(principal: Principal): ModerationPolicyActor {
  if (principal.type !== "user") {
    throw new OperationError(
      "forbidden",
      "A human administrator session is required"
    );
  }
  return { userId: principal.userId, role: principal.role };
}

/**
 * 把策略 service 的稳定领域错误转换为 UOL 统一错误。
 *
 * @param work - 延迟执行的策略 service 调用。
 * @returns service 的原始类型安全结果。
 * @throws OperationError 对外仅暴露稳定错误码；不变量错误隐藏内部细节。
 */
async function invokePolicyService<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof ModerationPolicyServiceError)) throw error;
    if (error.code === "invariant_error") {
      throw new OperationError(
        "internal_error",
        "Moderation policy is temporarily unavailable"
      );
    }
    throw new OperationError(error.code, error.message);
  }
}

// =============================================================================
// 集中式审核策略治理 operations
// =============================================================================

/** 读取全站审核策略，仅真实 super_admin 会话可用。 */
export const getGlobalRiskPolicy = defineOperation({
  name: "moderation.getGlobalRiskPolicy",
  domain: "moderation",
  title: "Get Global Moderation Risk Policy",
  description: "读取全站审核级别、生效值及其权威来源。",
  input: z.object({}).strict(),
  output: resolvedModerationPolicySchema,
  access: { kind: "roles", roles: ["super_admin"] },
  agentExposure: "human-only",
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async () =>
    invokePolicyService(() => moderationPolicyService.getGlobalPolicy()),
});

/** 原子更新全站审核级别和审计，仅真实 super_admin 会话可用。 */
export const setGlobalRiskLevel = defineOperation({
  name: "moderation.setGlobalRiskLevel",
  domain: "moderation",
  title: "Set Global Moderation Risk Level",
  description: "填写原因并原子更新全站审核级别与管理员审计。",
  input: z
    .object({
      level: moderationBlockRiskLevelSchema,
      reason: moderationPolicyChangeReasonSchema,
    })
    .strict(),
  output: globalRiskLevelWriteResultSchema,
  access: { kind: "roles", roles: ["super_admin"] },
  agentExposure: "human-only",
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit", "cache"],
  processLocalState: false,
  execute: async (input, principal, ctx) =>
    invokePolicyService(() =>
      moderationPolicyService.setGlobalRiskLevel({
        actor: requirePolicyActor(principal),
        level: input.level,
        reason: input.reason,
        requestId: ctx.requestId,
      })
    ),
});

/** 读取目标用户的全站值、覆盖值、生效值与来源。 */
export const getUserRiskPolicy = defineOperation({
  name: "moderation.getUserRiskPolicy",
  domain: "moderation",
  title: "Get User Moderation Risk Policy",
  description: "读取指定用户的审核策略视图，不允许普通用户或 API Key 调用。",
  input: z.object({ userId: policyUserIdSchema }).strict(),
  output: resolvedModerationPolicySchema,
  access: {
    kind: "roles",
    roles: ["observer_admin", "admin", "super_admin"],
  },
  agentExposure: "human-only",
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async (input) =>
    invokePolicyService(() =>
      moderationPolicyService.getUserPolicy(input.userId)
    ),
});

/** 原子设置或清除用户审核覆盖，并记录真实管理员与原因。 */
export const setUserRiskLevelOverride = defineOperation({
  name: "moderation.setUserRiskLevelOverride",
  domain: "moderation",
  title: "Set User Moderation Risk Level Override",
  description: "填写原因并设置或清除指定用户的管理员审核级别覆盖。",
  input: z
    .object({
      userId: policyUserIdSchema,
      level: moderationBlockRiskLevelSchema.nullable(),
      reason: moderationPolicyChangeReasonSchema,
    })
    .strict(),
  output: userRiskLevelWriteResultSchema,
  access: { kind: "roles", roles: ["admin", "super_admin"] },
  agentExposure: "human-only",
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit", "cache"],
  processLocalState: false,
  execute: async (input, principal, ctx) =>
    invokePolicyService(() =>
      moderationPolicyService.setUserRiskLevelOverride({
        actor: requirePolicyActor(principal),
        userId: input.userId,
        level: input.level,
        reason: input.reason,
        requestId: ctx.requestId,
      })
    ),
});

/** 为生成管线解析指定用户的唯一生效审核策略。 */
export const resolveEffectiveRiskLevel = defineOperation({
  name: "moderation.resolveEffectiveRiskLevel",
  domain: "moderation",
  title: "Resolve Effective Moderation Risk Level",
  description: "按管理员覆盖优先、全站默认其次的规则解析可信生效审核级别。",
  input: z.object({ userId: policyUserIdSchema }).strict(),
  output: resolvedModerationPolicySchema,
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async (input) =>
    invokePolicyService(() =>
      moderationPolicyService.resolveEffectivePolicy(input.userId)
    ),
});

// =============================================================================
// 1. moderation.moderateContent
//    核心审核编排器：接收文本/图片输入，协调多提供者执行审核并返回最终决策。
//    系统内部调用，由图像生成管线触发。
// =============================================================================

export const moderateContent = defineOperation({
  name: "moderation.moderateContent",
  domain: "moderation",
  title: "Moderate Content",
  description:
    "核心内容审核编排器。接收文本与可选图片输入，依次尝试代理、" +
    "Aliyun、OpenAI 提供者执行审核，返回 allow/block/skipped/error 决策。" +
    "由图像生成管线在生成前调用，fail-closed 策略。",
  input: z
    .object({
      prompt: z.string(),
      images: z.array(moderationImageInputSchema).optional(),
      mode: z.enum(["text", "image"]).optional(),
      userId: z.string().optional(),
      effectiveBlockRiskLevel: moderationBlockRiskLevelSchema,
      generationId: z.string().optional(),
      skipProxy: z.boolean().optional(),
    })
    .strict(),
  output: moderationResultSchema,
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  processLocalState: false,
  execute: async (input, _principal, _ctx) => {
    // Zod schema 是序列化格式（images.data 为 base64 string），
    // 而 moderateContentFn 期望 ModerateContentInput（images.data 为 Buffer）。
    // UOL 作为传输边界，此处用 type assertion 桥接。
    // 必填的可信档位直接进入领域输入；可选字段逐项赋值以满足精确可选类型。
    const params: ModerateContentInput = {
      prompt: input.prompt,
      effectiveBlockRiskLevel: input.effectiveBlockRiskLevel,
    };
    if (input.mode != null) params.mode = input.mode;
    if (input.userId != null) params.userId = input.userId;
    if (input.images != null) {
      params.images = input.images as unknown as NonNullable<
        ModerateContentInput["images"]
      >;
    }
    if (input.generationId != null) params.generationId = input.generationId;
    if (input.skipProxy != null) params.skipProxy = input.skipProxy;
    const result = await moderateContentFn(params);
    return result;
  },
});

// =============================================================================
// 2. moderation.getProviders
//    获取当前已配置且可用的审核提供者列表（aliyun / openai）。
//    系统内部只读查询。
// =============================================================================

export const getProviders = defineOperation({
  name: "moderation.getProviders",
  domain: "moderation",
  title: "Get Configured Moderation Providers",
  description:
    "返回当前环境中已配置且凭据有效的内容审核提供者列表。" +
    "受 CONTENT_MODERATION_ENABLED 与 CONTENT_MODERATION_PROVIDER 运行时设置控制。" +
    "系统内部使用，用于健康检查与管理面板展示。",
  input: z.object({}),
  output: z.object({
    providers: z.array(z.enum(["aliyun", "openai"])),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async (_input, _principal, _ctx) => {
    const providers = await getConfiguredModerationProviders();
    return { providers };
  },
});

// =============================================================================
// 3. moderation.isEnabled
//    查询内容审核功能是否全局启用。公开只读接口。
// =============================================================================

export const isEnabled = defineOperation({
  name: "moderation.isEnabled",
  domain: "moderation",
  title: "Is Content Moderation Enabled",
  description:
    "返回当前内容审核功能是否全局启用（基于 CONTENT_MODERATION_ENABLED 运行时设置）。" +
    "公开接口，不需要身份验证。用于前端 UI 条件展示与 Agent 决策。",
  input: z.object({}),
  output: z.object({
    enabled: z.boolean(),
  }),
  access: { kind: "public" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async (_input, _principal, _ctx) => {
    const enabled = await isContentModerationEnabled();
    return { enabled };
  },
});

// =============================================================================
// 4. moderation.proxyModerate
//    POST /moderate 端点 - 接受 proxySecret 鉴权的审核代理入站请求。
//    由远程实例通过 CONTENT_MODERATION_PROXY_URL 回调调用，
//    携带 PROXY_SECRET 或 GATEWAY_SECRET 鉴权。
// =============================================================================

export const proxyModerate = defineOperation({
  name: "moderation.proxyModerate",
  domain: "moderation",
  title: "Proxy Moderate Content",
  description:
    "审核代理入站端点（对应 POST /moderate）。接受携带 proxySecret 鉴权的外部请求，" +
    "在本地执行实际审核逻辑（skipProxy=true 避免循环调用）并返回结果。" +
    "用于多实例部署中的审核能力中心化。",
  input: z
    .object({
      prompt: z.string(),
      images: z.array(moderationImageInputSchema).optional(),
      mode: z.enum(["text", "image"]).optional(),
      userId: z.string().optional(),
      effectiveBlockRiskLevel: moderationBlockRiskLevelSchema,
      generationId: z.string().optional(),
    })
    .strict(),
  output: moderationResultSchema,
  access: { kind: "proxySecret" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: moderation.proxyModerate");
  },
});
