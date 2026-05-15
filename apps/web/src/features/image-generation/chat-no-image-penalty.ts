import { db } from "@repo/database";
import { chatNoImageState, generation } from "@repo/database/schema";
import { consumeCredits } from "@repo/shared/credits/core";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";
import { eq, sql } from "drizzle-orm";

const CHAT_NO_IMAGE_PENALTY_THRESHOLD = 3;
const CHAT_NO_IMAGE_PENALTY_CREDITS = 100;

async function getPenaltyConfig() {
  return {
    enabled: await getRuntimeSettingBoolean(
      "CHAT_NO_IMAGE_PENALTY_ENABLED",
      true
    ),
    threshold: Math.max(
      1,
      Math.round(
        await getRuntimeSettingNumber(
          "CHAT_NO_IMAGE_PENALTY_THRESHOLD",
          CHAT_NO_IMAGE_PENALTY_THRESHOLD,
          { positive: true }
        )
      )
    ),
    credits: await getRuntimeSettingNumber(
      "CHAT_NO_IMAGE_PENALTY_CREDITS",
      CHAT_NO_IMAGE_PENALTY_CREDITS,
      { positive: true }
    ),
  };
}

export async function resetChatNoImageState(userId: string) {
  await db
    .delete(chatNoImageState)
    .where(eq(chatNoImageState.userId, userId));
}

export async function recordChatNoImageResult(params: {
  userId: string;
  generationId: string;
  prompt: string;
  currentCreditsConsumed: number;
  useCredits: boolean;
}) {
  const [state] = await db
    .insert(chatNoImageState)
    .values({
      userId: params.userId,
      consecutiveCount: 1,
      lastGenerationId: params.generationId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: chatNoImageState.userId,
      set: {
        consecutiveCount: sql`${chatNoImageState.consecutiveCount} + 1`,
        lastGenerationId: params.generationId,
        updatedAt: new Date(),
      },
    })
    .returning({
      consecutiveCount: chatNoImageState.consecutiveCount,
    });

  const count = state?.consecutiveCount ?? 1;
  const config = await getPenaltyConfig();
  if (!params.useCredits || !config.enabled || count < config.threshold) {
    return {
      chargedCredits: params.currentCreditsConsumed,
      penaltyApplied: false,
      consecutiveCount: count,
    };
  }

  await consumeCredits({
    userId: params.userId,
    amount: config.credits,
    serviceName: "chat-no-image-penalty",
    description: `连续 ${count} 次对话未出图惩罚: ${params.prompt.substring(0, 50)}`,
    metadata: {
      generationId: params.generationId,
      consecutiveNoImageCount: count,
      penaltyCredits: config.credits,
    },
  });

  const chargedCredits =
    Math.round((params.currentCreditsConsumed + config.credits) * 100) / 100;

  await db
    .update(chatNoImageState)
    .set({
      consecutiveCount: 0,
      lastPenaltyAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chatNoImageState.userId, params.userId));

  await db
    .update(generation)
    .set({
      creditsConsumed: chargedCredits,
      metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify({
        chatNoImagePenalty: {
          credits: config.credits,
          threshold: config.threshold,
          consecutiveCount: count,
        },
      })}::jsonb`,
    })
    .where(eq(generation.id, params.generationId));

  return {
    chargedCredits,
    penaltyApplied: true,
    consecutiveCount: count,
  };
}
