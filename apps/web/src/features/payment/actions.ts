"use server";

import { db } from "@repo/database";
import { subscription } from "@repo/database/schema";

import { getUserRoleById } from "@repo/shared/auth/role-server";
import { logEvent } from "@repo/shared/logger";
import { ActionUserError, protectedAction } from "@repo/shared/safe-action";
import type { SubscriptionCheckoutOutput } from "@repo/shared/subscription/checkout-contract";
import { invokeOperation, OperationError } from "@repo/shared/uol";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PaymentType } from "@/features/payment/types";
import { ensureUolInitialized } from "@/server/uol-init";

import { creem } from "./creem";

/**
 * 创建订阅 Checkout Session 的兼容 Action。
 *
 * 输入和浏览器可见输出保持既有契约；客户端 type/回跳 URL 不参与支付渠道或目标
 * 决策。Action 只初始化 UOL、构造当前 session Principal 并映射 UOL 输出。
 */
export const createCheckoutSession = protectedAction
  .metadata({ action: "payment.createCheckoutSession" })
  .schema(
    z.object({
      priceId: z.string().min(1, "价格 ID 不能为空"),
      type: z.nativeEnum(PaymentType).optional(),
      successUrl: z.string().optional(),
      cancelUrl: z.string().optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    await ensureUolInitialized();
    const principal = {
      type: "user" as const,
      userId: ctx.userId,
      role: await getUserRoleById(ctx.userId),
    };
    let checkout: SubscriptionCheckoutOutput;
    try {
      checkout = await invokeOperation<SubscriptionCheckoutOutput>(
        "subscription.createCheckout",
        {
          priceId: parsedInput.priceId,
          successUrl: parsedInput.successUrl,
          cancelUrl: parsedInput.cancelUrl,
        },
        principal
      );
    } catch (error) {
      if (
        error instanceof OperationError &&
        error.code === "validation_error"
      ) {
        throw new ActionUserError(error.message);
      }
      throw error;
    }
    if (checkout.kind === "form_post") {
      return {
        url: checkout.url,
        params: checkout.fields,
        method: "POST" as const,
      };
    }
    return { url: checkout.url };
  });

/**
 * 创建订阅管理链接
 *
 * Creem 不提供类似 Stripe Customer Portal 的功能
 * 用户需要通过 Creem 的订阅管理页面或联系支持来管理订阅
 * 这里返回 null，前端可以显示取消订阅按钮或联系支持链接
 */
export const createCustomerPortal = protectedAction
  .metadata({ action: "payment.createCustomerPortal" })
  .schema(
    z
      .object({
        returnUrl: z.string().optional(),
      })
      .optional()
  )
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    // 查询用户的订阅
    const [userSubscription] = await db
      .select({ subscriptionId: subscription.subscriptionId })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription?.subscriptionId) {
      throw new Error("您还没有订阅任何计划");
    }

    // Creem 没有 Customer Portal，返回 null
    // 前端可以显示取消订阅按钮或联系支持链接
    return { url: null, subscriptionId: userSubscription.subscriptionId };
  });

/**
 * 取消订阅
 *
 * 调用 Creem API 取消用户的订阅
 */
export const cancelSubscription = protectedAction
  .metadata({ action: "payment.cancelSubscription" })
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    // 查询用户的订阅
    const [userSubscription] = await db
      .select({ subscriptionId: subscription.subscriptionId })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription?.subscriptionId) {
      throw new Error("您还没有订阅任何计划");
    }

    if (userSubscription.subscriptionId.startsWith("epay_")) {
      throw new Error("易支付订阅不支持自动取消，请等待当前周期结束");
    }

    // 调用 Creem API 取消订阅
    await creem.cancelSubscription(userSubscription.subscriptionId);

    // 更新数据库状态
    await db
      .update(subscription)
      .set({
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      })
      .where(eq(subscription.userId, userId));

    logEvent("payment.subscription.canceled", {
      userId,
      subscriptionId: userSubscription.subscriptionId,
    });

    return { success: true };
  });

/**
 * 获取用户当前订阅状态
 *
 * 用于在前端显示用户的订阅信息
 */
export const getUserSubscription = protectedAction
  .metadata({ action: "payment.getUserSubscription" })
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    // 查询用户的订阅信息
    const [userSubscription] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription) {
      return { subscription: null };
    }

    // 检查订阅是否有效
    const isActive = isSubscriptionCurrentlyActive(userSubscription);
    const isTrialing = userSubscription.status === "trialing";

    return {
      subscription: {
        id: userSubscription.id,
        status: userSubscription.status,
        priceId: userSubscription.priceId,
        currentPeriodStart: userSubscription.currentPeriodStart,
        currentPeriodEnd: userSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: userSubscription.cancelAtPeriodEnd,
        isActive,
        isTrialing,
      },
    };
  });

/**
 * 检查用户是否有有效订阅
 */
export const hasActiveSubscription = protectedAction
  .metadata({ action: "payment.hasActiveSubscription" })
  .action(async ({ ctx }) => {
    const { userId } = ctx;

    const [userSubscription] = await db
      .select({
        currentPeriodEnd: subscription.currentPeriodEnd,
        status: subscription.status,
      })
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    if (!userSubscription) {
      return { hasSubscription: false, status: null };
    }

    const isActive = isSubscriptionCurrentlyActive(userSubscription);

    return {
      hasSubscription: isActive,
      status: userSubscription.status,
    };
  });

function isSubscriptionCurrentlyActive(sub: {
  currentPeriodEnd: Date | null;
  status: string;
}) {
  if (sub.status === "lifetime") {
    return true;
  }

  return (
    (["active", "trialing"].includes(sub.status) &&
      isSubscriptionWithinPeriod(sub)) ||
    isCanceledSubscriptionWithinPeriod(sub)
  );
}

function isSubscriptionWithinPeriod(sub: { currentPeriodEnd: Date | null }) {
  return !sub.currentPeriodEnd || sub.currentPeriodEnd > new Date();
}

function isCanceledSubscriptionWithinPeriod(sub: {
  currentPeriodEnd: Date | null;
  status: string;
}) {
  return (
    sub.status === "canceled" &&
    Boolean(sub.currentPeriodEnd) &&
    isSubscriptionWithinPeriod(sub)
  );
}
