"use server";

/**
 * 获取当前用户订阅计划 Action
 */

import { getUserPlan } from "../services/user-plan";
import { protectedAction } from "../../safe-action";
import { getPlanCapabilitySnapshot } from "../services/plan-capabilities";

/**
 * 获取当前用户的订阅计划
 */
export const getMyPlanAction = protectedAction
  .metadata({ action: "subscription.getMyPlan" })
  .action(async ({ ctx }) => {
    const userPlan = await getUserPlan(ctx.userId);
    const capabilities = await getPlanCapabilitySnapshot(userPlan.plan);

    return {
      plan: userPlan.plan,
      planName: userPlan.planName,
      capabilities,
      hasActiveSubscription: userPlan.hasActiveSubscription,
      currentPeriodEnd: userPlan.currentPeriodEnd?.toISOString() ?? null,
      priceId: userPlan.priceId,
      cancelAtPeriodEnd: userPlan.cancelAtPeriodEnd,
    };
  });
