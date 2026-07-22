/**
 * 账单用量页的生图计价卡数据装配器。
 *
 * 使用方只有 Billing 的 Usage 服务端分支。该文件聚合运行时定价、
 * 用户套餐能力和后端分组偏好，不将数据查询带入 Dashboard 首屏。
 */

import type {
  ImageCreditOverrides,
  ResolvedImageCreditPricing,
} from "@repo/shared/image-backend/group-image-pricing";
import { isContentModerationEnabled } from "@repo/shared/moderation";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";

import { getEffectiveImageBackendGroupForUser } from "@/features/image-backend-pool/service";
import {
  getRuntimeImageBaseCreditPricing,
  getRuntimeImageModelCreditPricing,
  getRuntimeImageModerationCreditPricing,
} from "@/features/image-generation/pricing-settings";
import type { ResolvedImageModerationCreditPricing } from "@/features/image-generation/resolution";

export type ImagePricingCardData = {
  billing: {
    agentRoundCredits: number;
    chatRoundCredits: number;
    groupName: string | null;
    moderationBlockingEnabled: boolean;
    monthlyCredits: number;
    planName: string;
  };
  fallbackPricing: ResolvedImageCreditPricing;
  globalModelPricing: ImageCreditOverrides;
  groupModelOverrides: ImageCreditOverrides;
  moderationPricing: ResolvedImageModerationCreditPricing;
};

/**
 * 为当前用户装配生图计价卡所需的全部数据。
 *
 * @param userId 已鉴权会话的用户 ID。
 * @returns 标准化定价、套餐能力与当前后端分组。
 * @throws 运行时设置或数据库查询失败时向上抛出，由路由错误边界处理。
 */
export async function loadImagePricingCardData(
  userId: string
): Promise<ImagePricingCardData> {
  const [
    fallbackPricing,
    globalModelPricing,
    moderationPricing,
    moderationSystemEnabled,
    userPlanInfo,
  ] = await Promise.all([
      getRuntimeImageBaseCreditPricing(),
      getRuntimeImageModelCreditPricing(),
      getRuntimeImageModerationCreditPricing(),
      isContentModerationEnabled(),
      getUserPlan(userId),
    ]);
  const [capabilities, activeBackendGroup] = await Promise.all([
    getPlanCapabilitySnapshot(userPlanInfo.plan),
    getEffectiveImageBackendGroupForUser(userId, userPlanInfo.plan),
  ]);

  return {
    billing: {
      agentRoundCredits: capabilities.billing.agentRoundCredits,
      chatRoundCredits: capabilities.billing.chatRoundCredits,
      groupName: activeBackendGroup?.name ?? null,
      moderationBlockingEnabled:
        moderationSystemEnabled &&
        capabilities.features["moderation.blocking"] &&
        activeBackendGroup?.contentSafetyEnabled !== false,
      monthlyCredits: capabilities.limits.monthlyCredits,
      planName: userPlanInfo.planName,
    },
    fallbackPricing,
    globalModelPricing,
    groupModelOverrides: activeBackendGroup?.imageCreditOverrides ?? {
      version: 1,
      byModel: {},
    },
    moderationPricing,
  };
}
