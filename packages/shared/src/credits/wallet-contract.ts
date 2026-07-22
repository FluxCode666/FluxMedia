/**
 * 钱包资产与充值能力的传输无关契约。
 *
 * 使用方：credits UOL operations、Web 钱包 loader 与 Server Actions。
 * 契约只允许公开资产汇总和实际可结账的充值选项，不暴露账户或支付配置细节。
 */
import { z } from "zod";

export const walletBalanceSnapshotSchema = z.object({
  balance: z.number().finite(),
  totalSpent: z.number().finite().nonnegative(),
  totalRefunded: z.number().finite().nonnegative(),
  totalNetSpent: z.number().finite().nonnegative(),
  status: z.enum(["active", "frozen"]),
  asOf: z.string().datetime({ offset: true }),
});

export const walletTopUpOptionsSchema = z.object({
  enabled: z.boolean(),
  defaultCurrency: z.string().trim().length(3),
  currencies: z
    .array(
      z.object({
        currency: z.string().trim().length(3),
        creditsPerMajorUnit: z.number().finite().positive(),
        minAmountMinor: z.number().int().positive(),
        maxAmountMinor: z.number().int().positive(),
        providers: z.array(z.literal("alipay_f2f")).max(1),
      })
    )
    .max(16),
});

export type WalletBalanceSnapshot = z.infer<typeof walletBalanceSnapshotSchema>;
export type WalletTopUpOptions = z.infer<typeof walletTopUpOptionsSchema>;
