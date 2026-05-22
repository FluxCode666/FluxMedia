import { and, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "@repo/database";
import { creditsBatch, generation } from "@repo/database/schema";
import { grantCredits } from "./credits/core";
import { getFailedGenerationTargetCreditsFromMetadata } from "./generation-settlement";
import { logError } from "./logger";

export const IMAGE_GENERATION_PENDING_TIMEOUT_MS = 10 * 60 * 1000;
export const IMAGE_GENERATION_TIMEOUT_ERROR =
  "Image generation timed out after 10 minutes. Generation credits were refunded.";

type ExpireStalePendingGenerationsOptions = {
  userId?: string;
  now?: Date;
  limit?: number;
  timeoutMs?: number;
};

async function refundAlreadyGranted(userId: string, sourceRef: string) {
  const [existing] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.userId, userId),
        eq(creditsBatch.sourceType, "refund"),
        eq(creditsBatch.sourceRef, sourceRef)
      )
    )
    .limit(1);

  return Boolean(existing);
}

export async function refundGenerationCredits(params: {
  generationId: string;
  userId: string;
  amount: number;
  sourceRef: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  if (params.amount <= 0) {
    return { refunded: false, amount: 0 };
  }

  if (await refundAlreadyGranted(params.userId, params.sourceRef)) {
    return { refunded: false, amount: params.amount };
  }

  await grantCredits({
    userId: params.userId,
    amount: params.amount,
    sourceType: "refund",
    debitAccount: "SYSTEM:generation_refund",
    transactionType: "refund",
    sourceRef: params.sourceRef,
    description: params.description,
    metadata: {
      generationId: params.generationId,
      ...params.metadata,
    },
  });

  return { refunded: true, amount: params.amount };
}

export async function expireStalePendingGenerations(
  options: ExpireStalePendingGenerationsOptions = {}
) {
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? IMAGE_GENERATION_PENDING_TIMEOUT_MS;
  const cutoff = new Date(now.getTime() - timeoutMs);
  const conditions = [
    eq(generation.status, "pending" as const),
    lt(generation.createdAt, cutoff),
  ];

  if (options.userId) {
    conditions.push(eq(generation.userId, options.userId));
  }

  const staleRows = await db
    .select({
      id: generation.id,
      userId: generation.userId,
      prompt: generation.prompt,
      creditsConsumed: generation.creditsConsumed,
      metadata: generation.metadata,
      createdAt: generation.createdAt,
    })
    .from(generation)
    .where(and(...conditions))
    .orderBy(desc(generation.createdAt))
    .limit(options.limit ?? 100);

  const results: Array<{
    generationId: string;
    userId: string;
    creditsRefunded: number;
    refundGranted: boolean;
  }> = [];

  for (const row of staleRows) {
    const chargedCredits = Math.max(0, Number(row.creditsConsumed) || 0);
    const targetCredits = getFailedGenerationTargetCreditsFromMetadata({
      reason: "generation_error",
      chargedCredits,
      metadata: row.metadata,
    });
    const creditsToRefund = Math.max(0, chargedCredits - targetCredits);
    const sourceRef = `${row.id}:timeout-refund`;

    const [updated] = await db
      .update(generation)
      .set({
        status: "failed",
        error: IMAGE_GENERATION_TIMEOUT_ERROR,
        completedAt: now,
        metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
          {
            timeout: {
              reason: "pending_timeout",
              timeoutMs,
              expiredAt: now.toISOString(),
              targetCredits,
              refundSourceRef: sourceRef,
              refundCredits: creditsToRefund,
            },
          }
        )}::jsonb`,
      })
      .where(
        and(eq(generation.id, row.id), eq(generation.status, "pending" as const))
      )
      .returning({ id: generation.id });

    if (!updated) continue;

    let refundGranted = false;
    if (creditsToRefund > 0) {
      try {
        const refund = await refundGenerationCredits({
          generationId: row.id,
          userId: row.userId,
          amount: creditsToRefund,
          sourceRef,
          description: `Refund timed out image generation charge: ${row.prompt.slice(
            0,
            50
          )}`,
          metadata: {
            reason: "pending_timeout",
            createdAt: row.createdAt.toISOString(),
            expiredAt: now.toISOString(),
            timeoutMs,
          },
        });
        refundGranted = refund.refunded;

        await db
          .update(generation)
          .set({
            creditsConsumed: targetCredits,
            metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
              {
                timeoutRefund: {
                  sourceRef,
                  creditsRefunded: creditsToRefund,
                  granted: refund.refunded,
                  settledAt: now.toISOString(),
                },
              }
            )}::jsonb`,
          })
          .where(eq(generation.id, row.id));
      } catch (error) {
        logError(error, {
          source: "image-generation-timeout-refund",
          generationId: row.id,
          userId: row.userId,
          creditsToRefund,
        });
      }
    }

    results.push({
      generationId: row.id,
      userId: row.userId,
      creditsRefunded: refundGranted ? creditsToRefund : 0,
      refundGranted,
    });
  }

  return results;
}
