export type FailedGenerationSettlementReason =
  | "moderation_block"
  | "moderation_error"
  | "generation_error"
  | "storage_error"
  | "settlement_error";

export function getFailedGenerationTargetCredits(params: {
  reason: FailedGenerationSettlementReason;
  moderationFailureCredits: number;
  moderationOnlyCredits?: number;
}) {
  if (params.reason === "moderation_block") {
    return Math.max(0, params.moderationFailureCredits);
  }

  if (params.reason === "moderation_error") {
    return 0;
  }

  return Math.max(
    0,
    params.moderationOnlyCredits ?? params.moderationFailureCredits
  );
}

function readNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 仅按旧 generation metadata 还原历史扣费，保证失败退款不因新计费规则而漂移。
 */
function applyLegacyBillingMultiplier(value: number, multiplier: number) {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) {
    return value;
  }
  return Math.round((value * multiplier + Number.EPSILON) * 100) / 100;
}

export function getFailedGenerationTargetCreditsFromMetadata(params: {
  reason: FailedGenerationSettlementReason;
  chargedCredits: number;
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = params.metadata ?? {};
  const creditCost = readRecord(metadata.creditCost);
  const chargedCredits = Math.max(0, params.chargedCredits);
  // 兼容切换固定价格前已扣费、但切换后才失败的历史任务；新任务不再写入此字段。
  const legacyBillingMultiplier = readNumber(metadata.billingMultiplier) ?? 1;
  const moderationFailureCredits =
    readNumber(metadata.moderationFailureCredits) ?? chargedCredits;
  const moderationOnlyCredits =
    readNumber(creditCost?.moderationOnlyCredits) ??
    (readNumber(creditCost?.moderationCredits) !== undefined
      ? applyLegacyBillingMultiplier(
          readNumber(creditCost?.moderationCredits) ?? 0,
          legacyBillingMultiplier
        )
      : undefined);
  const settlementParams: Parameters<typeof getFailedGenerationTargetCredits>[0] =
    {
      reason: params.reason,
      moderationFailureCredits,
    };

  if (moderationOnlyCredits !== undefined) {
    settlementParams.moderationOnlyCredits = moderationOnlyCredits;
  }

  return Math.min(
    chargedCredits,
    getFailedGenerationTargetCredits(settlementParams)
  );
}
