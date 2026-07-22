/**
 * 订阅 checkout 的传输无关输入输出契约。
 *
 * 使用方：UOL operation、Web app-level binding、checkout service 与兼容 Action。
 * 输出仅包含浏览器完成重定向或 POST form 所需字段，不暴露订单或支付配置。
 */
import { z } from "zod";

export const subscriptionCheckoutInputSchema = z
  .object({
    priceId: z.string().trim().min(1).max(512).describe("目标套餐的价格 ID"),
    successUrl: z
      .string()
      .url()
      .optional()
      .describe("兼容旧客户端；服务端始终使用同源钱包成功地址"),
    cancelUrl: z
      .string()
      .url()
      .optional()
      .describe("兼容旧客户端；服务端始终使用同源钱包取消地址"),
    provider: z
      .enum(["creem", "epay"])
      .optional()
      .describe("兼容旧客户端；实际支付渠道只读取服务端运行时配置"),
  })
  .strict();

export const subscriptionCheckoutOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("redirect"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("form_post"),
    url: z.string().url(),
    fields: z.record(z.string(), z.string()),
  }),
]);

export type SubscriptionCheckoutInput = z.infer<
  typeof subscriptionCheckoutInputSchema
>;
export type SubscriptionCheckoutOutput = z.infer<
  typeof subscriptionCheckoutOutputSchema
>;
