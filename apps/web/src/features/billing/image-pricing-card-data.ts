/**
 * 账单用量页的生图计价卡数据装配器。
 *
 * 使用方只有 Billing 的 Usage 服务端分支。该文件聚合运行时定价、
 * 用户套餐能力和后端分组偏好，不将数据查询带入 Dashboard 首屏。
 */

import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";

import {
  getUserImageBackendPreference,
  listImageBackendGroupOptions,
} from "@/features/image-backend-pool/service";
import { getRuntimeImageBaseCreditPricing } from "@/features/image-generation/pricing-settings";
import {
  getImageBaseCreditPricing,
  type ImageBaseCreditPricing,
} from "@/features/image-generation/resolution";

export type ImagePricingCardData = {
  billing: {
    agentRoundCredits: number;
    chatRoundCredits: number;
    groupMultiplier: number;
    groupName: string | null;
    moderationBlockingEnabled: boolean;
    monthlyCredits: number;
    planName: string;
  };
  pricing: ImageBaseCreditPricing;
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
  const [runtimePricing, userPlanInfo] = await Promise.all([
    getRuntimeImageBaseCreditPricing(),
    getUserPlan(userId),
  ]);
  const [capabilities, backendGroups, selectedBackendGroupId] =
    await Promise.all([
      getPlanCapabilitySnapshot(userPlanInfo.plan),
      listImageBackendGroupOptions({ plan: userPlanInfo.plan }),
      getUserImageBackendPreference(userId, userPlanInfo.plan),
    ]);
  const activeBackendGroup =
    backendGroups.find((group) => group.id === selectedBackendGroupId) ??
    backendGroups.find((group) => group.isDefault) ??
    backendGroups[0] ??
    null;

  return {
    billing: {
      agentRoundCredits: capabilities.billing.agentRoundCredits,
      chatRoundCredits: capabilities.billing.chatRoundCredits,
      groupMultiplier: activeBackendGroup?.billingMultiplier ?? 1,
      groupName: activeBackendGroup?.name ?? null,
      moderationBlockingEnabled: capabilities.features["moderation.blocking"],
      monthlyCredits: capabilities.limits.monthlyCredits,
      planName: userPlanInfo.planName,
    },
    pricing: getImageBaseCreditPricing(runtimePricing),
  };
}
