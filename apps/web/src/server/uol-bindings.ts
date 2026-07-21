/**
 * UOL Bindings - 启动时延迟绑定真实 execute 实现
 *
 * 职责：在 apps/web 启动时，将 packages/shared 中定义的 operation stub
 * 替换为真实的 service-fn 实现。解决跨包依赖问题：
 * - 操作定义在 packages/shared（不可导入 apps/web）
 * - 部分 execute 实现依赖 apps/web 的 service-fn（DB、外部 API 等）
 *
 * 使用方：uol-init.ts 在应用启动时调用此模块（副作用导入）
 * 关键依赖：@repo/shared/uol（bindExecute）、各 features service-fn
 *
 * 约定：
 * - 此文件在 import 时执行所有 bindExecute 调用
 * - 每个绑定块对应一个 operation，注明源 service-fn 位置
 * - 尚未接线的 operation 用 TODO 注释标记
 */

// 副作用导入：触发所有操作注册到 registry
import "@repo/shared/uol/operations";

import type { adobeEnabledModelIdsSchema } from "@repo/shared/adobe/enabled-models";
import {
  usageSummaryOutputSchema,
  usageTrendsInputSchema,
  usageTrendsOutputSchema,
} from "@repo/shared/analytics/contracts";
import { resolveUsageTimeRange } from "@repo/shared/analytics/range";
import { getAnalyticsMetricUnit } from "@repo/shared/analytics/series";
import { normalizeSubscriptionPlan } from "@repo/shared/config/subscription-plan";
import type { RequestParameterMapping } from "@repo/shared/image-backend/request-parameter-mapping";
import { checkRateLimit } from "@repo/shared/rate-limit";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import {
  formatDateInputInTimeZone,
  parseDateInputInTimeZone,
} from "@repo/shared/time-zone";
import { getUserTimeZone } from "@repo/shared/time-zone/server";
import type { OperationContext, Principal } from "@repo/shared/uol";
import { bindExecute, OperationError } from "@repo/shared/uol";
import type { z } from "zod";
import {
  type AnalyticsReadModelState,
  loadOutputUsageSummary,
  loadOutputUsageTrends,
  readAnalyticsReadModelStates,
} from "@/features/dashboard/analytics-service";
import { getExternalModelsForUser } from "@/features/external-api/models";
import {
  deleteImageBackendParameterMappingTemplate,
  listAdminImageBackendPool,
  listImageBackendParameterMappingTemplates,
  upsertImageBackendAdobe,
  upsertImageBackendApi,
  upsertImageBackendParameterMappingTemplate,
} from "@/features/image-backend-pool/service";
import { createEditableFileCreditOperation } from "@/features/image-generation/credit-operation-context";
import { runEditableFileForUser } from "@/features/image-generation/editable-file-operations";
import { runImageGenerationForUser } from "@/features/image-generation/operations";
import type { ImageQuality } from "@/features/image-generation/types";
import {
  createCreditTopUpCheckout,
  fulfillAlipayCreditTopUp,
  getCreditPaymentStatus,
  getCreditTopUpOptions,
  getCreditTopUpOrderStatus,
} from "@/features/payment/credit-top-up";

// ---------------------------------------------------------------------------
// image-generation 域
// ---------------------------------------------------------------------------

/**
 * image.generate - 统一管线核心
 * 源: apps/web/src/features/image-generation/operations.ts
 */
bindExecute(
  "image.generate",
  async (
    input: {
      userId: string;
      prompt: string;
      negativePrompt?: string;
      model?: string;
      size?: string;
      quality?: string;
      style?: string;
      count?: number;
      generationId?: string;
      backendGroupId?: string;
      relayOnly?: boolean;
      extra?: Record<string, unknown>;
    },
    _principal: Principal,
    _ctx: OperationContext
  ) => {
    const result = await runImageGenerationForUser({
      mode: "generate",
      userId: input.userId,
      prompt: input.prompt,
      model: input.model,
      size: input.size,
      quality: input.quality as ImageQuality | undefined,
      n: input.count,
      generationId: input.generationId,
      relayOnly: input.relayOnly,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    // 将 ImageGenerationOperationResult 映射到 UOL output schema
    const images: { url: string; revisedPrompt?: string }[] = [];
    if (result.imageUrl) {
      images.push({
        url: result.imageUrl,
        revisedPrompt: result.revisedPrompt,
      });
    }
    if (result.imageOutputs) {
      for (const output of result.imageOutputs) {
        if (output.imageUrl) {
          images.push({
            url: output.imageUrl,
            revisedPrompt: output.revisedPrompt,
          });
        }
      }
    }

    return {
      generationId: result.generationId ?? input.generationId ?? "",
      images,
      creditsUsed: result.creditsConsumed,
      model: result.model,
    };
  }
);

/**
 * externalApi.getModels - 外接 API 模型列表。
 *
 * 源：apps/web/src/features/external-api/models.ts。
 * WHY：套餐能力与供应商模型列表必须经过同一 UOL 网关，避免 HTTP 路由和未来 MCP
 * 传输在可见模型集合上产生漂移。
 */
bindExecute(
  "externalApi.getModels",
  async (
    _input: Record<string, never>,
    principal: Principal,
    _ctx: OperationContext
  ) => {
    if (principal.type !== "apiKey") {
      throw new OperationError(
        "unauthenticated",
        "API key authentication required"
      );
    }
    const plan = normalizeSubscriptionPlan(principal.plan);
    if (!(await canUsePlanCapability(plan, "externalApi.models.list"))) {
      throw new OperationError(
        "capability_required",
        "External API model listing is not enabled for this plan."
      );
    }
    return getExternalModelsForUser(principal.userId);
  }
);

// ---------------------------------------------------------------------------
// analytics 域
// ---------------------------------------------------------------------------

/** 判断单个统计读模型是否达到当前线上查询所需版本。 */
function isAnalyticsReadModelReady(state: AnalyticsReadModelState): boolean {
  return state?.version === 1 && state.status === "ready";
}

/** 查询统一 analytics readiness，未完成回填时返回相同的暂不可用错误。 */
async function assertAnalyticsReady(): Promise<void> {
  const states = await readAnalyticsReadModelStates();
  if (
    !isAnalyticsReadModelReady(states.outputUsage) ||
    !isAnalyticsReadModelReady(states.creditUsage)
  ) {
    throw new OperationError(
      "not_ready",
      "Analytics data is still being prepared",
      undefined,
      503
    );
  }
}

/** 绑定本人摘要 operation，用户 ID 只来自 Principal。 */
bindExecute(
  "analytics.getMyUsageSummary",
  async (_input: Record<string, never>, principal: Principal) => {
    if (principal.type !== "user" && principal.type !== "apiKey") {
      throw new OperationError("unauthenticated", "User identity required");
    }
    await assertAnalyticsReady();
    const timeZone = await getUserTimeZone(principal.userId);
    const asOf = new Date();
    const today = formatDateInputInTimeZone(asOf, timeZone);
    const todayStart = parseDateInputInTimeZone(today, { timeZone });
    if (!todayStart)
      throw new OperationError(
        "internal_error",
        "Unable to resolve analytics day"
      );
    const todayRange = {
      start: new Date(todayStart.getTime()),
      end: asOf,
    };
    const result = await loadOutputUsageSummary({
      userId: principal.userId,
      todayRange,
    });
    return usageSummaryOutputSchema.parse({
      asOf: asOf.toISOString(),
      timeZone,
      todayRange: {
        start: todayRange.start.toISOString(),
        end: todayRange.end.toISOString(),
      },
      today: result.today,
      lifetime: result.lifetime,
    });
  }
);

/** 绑定本人趋势 operation，统一解析时区范围并只执行一次输出事件查询。 */
bindExecute(
  "analytics.getMyUsageTrends",
  async (input: unknown, principal: Principal) => {
    if (principal.type !== "user" && principal.type !== "apiKey") {
      throw new OperationError("unauthenticated", "User identity required");
    }
    await assertAnalyticsReady();
    const parsed = usageTrendsInputSchema.parse(input);
    const timeZone = await getUserTimeZone(principal.userId);
    let range: ReturnType<typeof resolveUsageTimeRange>;
    try {
      range = resolveUsageTimeRange(parsed, {
        timeZone,
        asOf: new Date(),
      });
    } catch (error) {
      if (error instanceof RangeError) {
        throw new OperationError("validation_error", error.message);
      }
      throw error;
    }
    const result = await loadOutputUsageTrends({
      userId: principal.userId,
      range,
    });
    return usageTrendsOutputSchema.parse({
      asOf: range.asOf.toISOString(),
      timeZone,
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      granularity: range.granularity,
      metric: range.metric,
      unit: getAnalyticsMetricUnit(range.metric),
      buckets: result.buckets,
      distribution: result.distribution,
    });
  }
);

// ---------------------------------------------------------------------------
// credits（按金额充值）域
// ---------------------------------------------------------------------------

/** credits.getTopUpOptions - 返回已完成支付配置的充值选项。 */
bindExecute(
  "credits.getTopUpOptions",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => getCreditTopUpOptions()
);

/** credits.createTopUpCheckout - 创建带 per-user clientRequestId 幂等键的充值订单。 */
bindExecute(
  "credits.createTopUpCheckout",
  async (
    input: {
      clientRequestId: string;
      currency: string;
      amountMinor: number;
      provider: "alipay_f2f";
    },
    principal: Principal,
    _ctx: OperationContext
  ) => {
    if (principal.type !== "user") {
      throw new OperationError(
        "unauthenticated",
        "User session authentication required"
      );
    }
    // 充值下单会触发第三方预下单，按用户而非 IP 限流，避免 Server Action
    // 绕过 API middleware 后被反复调用消耗支付宝网关配额。
    const rateLimit = await checkRateLimit(
      `credit-top-up:${principal.userId}`,
      "payment"
    );
    if (!rateLimit.success) {
      throw new OperationError(
        "rate_limited",
        "Credit top-up requests are too frequent"
      );
    }
    return createCreditTopUpCheckout({ ...input, userId: principal.userId });
  }
);

/** credits.getTopUpOrderStatus - 订单查询按当前用户 ID 过滤，避免 IDOR。 */
bindExecute(
  "credits.getTopUpOrderStatus",
  async (
    input: { orderId: string },
    principal: Principal,
    _ctx: OperationContext
  ) => {
    if (principal.type !== "user") {
      throw new OperationError(
        "unauthenticated",
        "User session authentication required"
      );
    }
    return getCreditTopUpOrderStatus({
      userId: principal.userId,
      orderId: input.orderId,
    });
  }
);

/** credits.getPaymentStatus - 统一结果页按当前用户过滤支付订单，避免 IDOR。 */
bindExecute(
  "credits.getPaymentStatus",
  async (
    input: { orderId: string },
    principal: Principal,
    _ctx: OperationContext
  ) => {
    if (principal.type !== "user") {
      throw new OperationError(
        "unauthenticated",
        "User session authentication required"
      );
    }
    return getCreditPaymentStatus({
      userId: principal.userId,
      orderId: input.orderId,
    });
  }
);

/** credits.fulfillAlipayTopUp - 支付宝路由完成 RSA2 验签后经 UOL 履约。 */
bindExecute(
  "credits.fulfillAlipayTopUp",
  async (
    input: {
      outTradeNo: string;
      tradeNo: string;
      tradeStatus: string;
      totalAmount: string;
      appId: string;
      sellerId: string;
    },
    _principal: Principal,
    _ctx: OperationContext
  ) => fulfillAlipayCreditTopUp(input)
);

/**
 * pool.saveApi - 保存第三方 API 后端。
 *
 * 源：apps/web/src/features/image-backend-pool/service.ts。
 * WHY：server action 与 MCP 都通过同一 UOL 网关调用，避免参数映射等权限和校验
 * 逻辑在不同传输层漂移。
 */
bindExecute(
  "pool.saveApi",
  async (
    input: {
      id?: string;
      groupId?: string | null;
      groupIds?: string[];
      name: string;
      baseUrl: string;
      apiKey?: string;
      model?: string;
      supportedModelIds?: string[];
      interfaceMode: "images" | "responses" | "mixed";
      chatCompletionsUpstreamMode: "responses" | "chat_completions";
      imagesUpstreamMode: "images" | "responses";
      parameterMappings: RequestParameterMapping[];
      useStream: boolean;
      contentSafetyEnabled: boolean;
      isEnabled: boolean;
      alwaysActive: boolean;
      failureCooldownEnabled: boolean;
      priority: number;
      concurrency: number;
      adobeSourced: boolean;
      billingMultiplier: number;
      status: string;
    },
    _principal: Principal,
    _ctx: OperationContext
  ) => ({
    id: await upsertImageBackendApi({
      ...input,
      model: input.model || null,
    }),
  })
);

/**
 * pool.saveAdobe - 保存 Adobe 后端及开放模型白名单。
 *
 * 源：apps/web/src/features/image-backend-pool/service.ts。
 * WHY：后台表单与未来 MCP 调用必须共用同一个白名单校验与管理员权限入口，避免绕过
 * 调度器依赖的 enabledModels 配置。
 */
bindExecute(
  "pool.saveAdobe",
  async (
    input: {
      id?: string;
      groupId?: string | null;
      groupIds?: string[];
      name: string;
      mode: "gateway" | "direct";
      baseUrl: string;
      apiKey?: string;
      enabledModels?: z.infer<typeof adobeEnabledModelIdsSchema>;
      defaultRatio: string;
      defaultResolution: string;
      gptImageQuality: "low" | "medium" | "high";
      billingMultiplier: number;
      supportsVideo: boolean;
      contentSafetyEnabled: boolean;
      isEnabled: boolean;
      alwaysActive: boolean;
      failureCooldownEnabled: boolean;
      priority: number;
      concurrency: number;
      status: string;
    },
    _principal: Principal,
    _ctx: OperationContext
  ) => ({
    id: await upsertImageBackendAdobe(input),
  })
);

/** pool.listParameterMappingTemplates - 读取可复用的参数映射模板。 */
bindExecute(
  "pool.listParameterMappingTemplates",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => ({
    templates: await listImageBackendParameterMappingTemplates(),
  })
);

/** pool.saveParameterMappingTemplate - 保存独立的参数映射模板快照。 */
bindExecute(
  "pool.saveParameterMappingTemplate",
  async (
    input: {
      id?: string;
      name: string;
      parameterMappings: RequestParameterMapping[];
    },
    _principal: Principal,
    _ctx: OperationContext
  ) => ({
    id: await upsertImageBackendParameterMappingTemplate(input),
  })
);

/** pool.deleteParameterMappingTemplate - 删除模板，不影响已保存的 API 配置。 */
bindExecute(
  "pool.deleteParameterMappingTemplate",
  async (
    input: { id: string },
    _principal: Principal,
    _ctx: OperationContext
  ) => {
    await deleteImageBackendParameterMappingTemplate(input.id);
    return { success: true };
  }
);

/**
 * file.generatePpt / file.generatePsd - 可编辑文件(PPT/PSD)生成
 * 源: apps/web/src/features/image-generation/editable-file-operations.ts
 * clientRequestId 作计费幂等键(sourceRef=editable-file:{clientRequestId});PSD 强校验非空图。
 */
function bindEditableFile(name: "file.generatePpt" | "file.generatePsd") {
  const kind = name === "file.generatePsd" ? "psd" : "ppt";
  bindExecute(
    name,
    async (
      input: {
        userId: string;
        clientRequestId: string;
        prompt: string;
        base64Images?: string[];
      },
      _principal: Principal,
      _ctx: OperationContext
    ) => {
      const creditOperation = createEditableFileCreditOperation(
        kind,
        input.clientRequestId,
        new Date()
      );
      const result = await runEditableFileForUser({
        userId: input.userId,
        kind,
        prompt: input.prompt,
        base64Images: input.base64Images ?? [],
        taskId: input.clientRequestId,
        operation: creditOperation,
      });
      return {
        taskId: input.clientRequestId,
        conversationId: result.conversationId,
        primaryUrl: result.primaryUrl,
        zipUrl: result.zipUrl,
        creditsUsed: result.creditsCharged,
      };
    }
  );
}
bindEditableFile("file.generatePpt");
bindEditableFile("file.generatePsd");

// TODO: image.generateAction - 委托 image.generate
// TODO: image.delete - deleteGenerationAction 逻辑
// TODO: image.getStatus - getGenerationStatus 逻辑
// TODO: image.getUserGenerations - 分页查询逻辑
// TODO: image.getUserGenerationCount - 计数查询逻辑
// TODO: image.getUserRecentGenerations - 最近生成查询
// TODO: image.getGenerationById - 单条查询
// TODO: image.getGenerationStats - 管理员统计
// TODO: image.getUserApiConfig - getUserApiConfig 逻辑
// TODO: image.getEffectiveConfig - getEffectiveConfig 逻辑
// TODO: image.selectWebCandidate - selectChatGptWebImageCandidate 逻辑

// ---------------------------------------------------------------------------
// image-backend-pool 域
// ---------------------------------------------------------------------------

/**
 * pool.getAdminPool - 管理后台池总览
 * 源: apps/web/src/features/image-backend-pool/service.ts
 */
bindExecute(
  "pool.getAdminPool",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext
  ) => {
    const pool = await listAdminImageBackendPool();
    return pool;
  }
);

// TODO: pool.getSelectableGroups - getSelectableImageBackendGroupsAction 逻辑
// TODO: pool.setPreference - setUserImageBackendPreferenceAction 逻辑
// TODO: pool.getGroupOptions - getImageBackendGroupOptionsAction 逻辑
// TODO: pool.saveGroup - saveImageBackendGroupAction 逻辑
// TODO: pool.deleteGroup - deleteImageBackendGroupAction 逻辑
// TODO: pool.saveAccount - saveImageBackendAccountAction 逻辑
// TODO: pool.bulkUpdateAccounts - bulkUpdateImageBackendAccountsAction 逻辑
// TODO: pool.bulkDeleteAccounts - bulkDeleteImageBackendAccountsAction 逻辑
// TODO: pool.deleteMember - deleteImageBackendMemberAction 逻辑
// TODO: pool.importFromRefreshTokens - importImageBackendAccountsFromRefreshTokensAction
// TODO: pool.importWebFromAccessTokens - importImageBackendWebAccountsFromAccessTokensAction
// TODO: pool.refreshAccountInfo - refreshImageBackendAccountInfoAction 逻辑
// TODO: pool.refreshAccountsInfo - refreshImageBackendAccountsInfoAction 逻辑
// TODO: pool.getSub2ApiStatus - getSub2ApiSyncStatusAction 逻辑
// TODO: pool.getSub2ApiSourceGroups - getSub2ApiSourceGroupsAction 逻辑
// TODO: pool.getSub2ApiAutoSyncTasks - getSub2ApiAutoSyncTasksAction 逻辑
// TODO: pool.syncSub2ApiAccounts - syncImageBackendAccountsFromSub2ApiAction
// TODO: pool.runSub2ApiManualSync - runSub2ApiManualSyncAction 逻辑
// TODO: pool.runSub2ApiAutoSyncNow - runSub2ApiAutoSyncTaskNowAction 逻辑
// TODO: pool.setSub2ApiTaskEnabled - setSub2ApiAutoSyncTaskEnabledAction
// TODO: pool.setSub2ApiTaskOverwrite - setSub2ApiAutoSyncTaskOverwriteLocalUnavailableStateAction
// TODO: pool.updateSub2ApiTaskOptions - updateSub2ApiAutoSyncTaskOptionsAction
// TODO: pool.deleteSub2ApiTask - deleteSub2ApiAutoSyncTaskAction
// TODO: pool.cronSub2ApiSync - cron 调度逻辑
// TODO: pool.cronRefreshStale - cron 调度逻辑

// ---------------------------------------------------------------------------
// user-auth 域
// ---------------------------------------------------------------------------

// TODO: user.list - getAllUsersAction 逻辑（DB 查询在 packages/shared 但需运行时 DB 连接）
// TODO: user.getDetail - getUserDetailAction 逻辑
// TODO: user.updateRole - updateUserRoleAction 逻辑
// TODO: user.ban - banUserAction 逻辑
// TODO: user.grantCredits - adminGrantCreditsAction 逻辑
// TODO: user.adjustCredits - adminAdjustCreditsAction 逻辑
// TODO: user.setSubscription - setUserPlanAction 逻辑
// TODO: user.setCreditsStatus - setUserCreditsStatusAction 逻辑
// TODO: user.setExternalApiKeyStatus - setExternalApiKeyStatusAction 逻辑
// TODO: user.create - createUserAction 逻辑
// TODO: user.updateProfile - updateUserProfileAction 逻辑
// TODO: user.setPassword - setUserPasswordAction 逻辑

// ---------------------------------------------------------------------------
// external-api 域
// ---------------------------------------------------------------------------

// TODO: externalApi.handleImageGenerations - image-generations handler 逻辑
// TODO: externalApi.handleImageEdits - image-edits handler 逻辑
// TODO: externalApi.handleChatCompletions - chat-completions handler 逻辑
// TODO: externalApi.handleResponses - responses handler 逻辑
// TODO: externalApi.handleAgentImages - agent-images handler 逻辑

// ---------------------------------------------------------------------------
// support 域
// ---------------------------------------------------------------------------

// TODO: support.createTicket - createTicketAction 逻辑
// TODO: support.listTickets - getTicketsAction 逻辑
// TODO: support.getTicketDetail - getTicketDetailAction 逻辑
// TODO: support.replyTicket - replyTicketAction 逻辑
// TODO: support.closeTicket - closeTicketAction 逻辑
// TODO: support.adminListTickets - adminGetTicketsAction 逻辑
// TODO: support.adminReplyTicket - adminReplyTicketAction 逻辑
// TODO: support.adminUpdateTicketStatus - adminUpdateTicketStatusAction 逻辑
