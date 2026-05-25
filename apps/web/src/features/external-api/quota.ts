import { db } from "@repo/database";
import { externalApiKey } from "@repo/database/schema";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";

const CREDIT_DECIMAL_PLACES = 2;
const CREDIT_DECIMAL_FACTOR = 10 ** CREDIT_DECIMAL_PLACES;

function roundQuotaCredits(value: number) {
  return (
    Math.round((value + Number.EPSILON) * CREDIT_DECIMAL_FACTOR) /
    CREDIT_DECIMAL_FACTOR
  );
}

export function normalizeExternalApiKeyCreditLimit(
  value: number | string | null | undefined
) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("API Key 额度必须是大于等于 0 的数字");
  }
  return roundQuotaCredits(numeric);
}

export class ExternalApiKeyQuotaExceededError extends Error {
  readonly code = "api_key_quota_exceeded";

  constructor(
    public readonly required: number,
    public readonly remaining: number,
    public readonly limit: number | null,
    public readonly used: number
  ) {
    super(
      `API key quota exceeded: required ${required}, remaining ${remaining}`
    );
    this.name = "ExternalApiKeyQuotaExceededError";
  }
}

export function isExternalApiKeyQuotaExceededError(
  error: unknown
): error is ExternalApiKeyQuotaExceededError {
  return error instanceof ExternalApiKeyQuotaExceededError;
}

export function getExternalApiKeyQuotaRemaining(
  creditLimit: number | null,
  creditsUsed: number
) {
  if (creditLimit === null) return null;
  return roundQuotaCredits(Math.max(0, creditLimit - creditsUsed));
}

export async function getExternalApiKeyQuota(params: {
  apiKeyId: string;
  userId: string;
}) {
  const [key] = await db
    .select({
      id: externalApiKey.id,
      name: externalApiKey.name,
      keyPrefix: externalApiKey.keyPrefix,
      lastFour: externalApiKey.lastFour,
      isActive: externalApiKey.isActive,
      creditLimit: externalApiKey.creditLimit,
      creditsUsed: externalApiKey.creditsUsed,
      lastUsedAt: externalApiKey.lastUsedAt,
      createdAt: externalApiKey.createdAt,
    })
    .from(externalApiKey)
    .where(
      and(
        eq(externalApiKey.id, params.apiKeyId),
        eq(externalApiKey.userId, params.userId)
      )
    )
    .limit(1);

  if (!key) {
    throw new Error("API key not found");
  }

  const creditLimit = key.creditLimit ?? null;
  const creditsUsed = roundQuotaCredits(Number(key.creditsUsed || 0));
  return {
    ...key,
    creditLimit,
    creditsUsed,
    creditsRemaining: getExternalApiKeyQuotaRemaining(
      creditLimit,
      creditsUsed
    ),
  };
}

export async function reserveExternalApiKeyCredits(params: {
  apiKeyId?: string;
  userId: string;
  amount: number;
}) {
  if (!params.apiKeyId) return;
  const amount = roundQuotaCredits(params.amount);
  if (amount <= 0) return;

  const [updated] = await db
    .update(externalApiKey)
    .set({
      creditsUsed: sql`${externalApiKey.creditsUsed} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalApiKey.id, params.apiKeyId),
        eq(externalApiKey.userId, params.userId),
        eq(externalApiKey.isActive, true),
        or(
          isNull(externalApiKey.creditLimit),
          gte(
            sql`${externalApiKey.creditLimit} - ${externalApiKey.creditsUsed}`,
            amount
          )
        )
      )
    )
    .returning({
      creditLimit: externalApiKey.creditLimit,
      creditsUsed: externalApiKey.creditsUsed,
    });

  if (updated) return updated;

  const quota = await getExternalApiKeyQuota({
    apiKeyId: params.apiKeyId,
    userId: params.userId,
  });
  const remaining = quota.creditsRemaining ?? Number.POSITIVE_INFINITY;
  throw new ExternalApiKeyQuotaExceededError(
    amount,
    Number.isFinite(remaining) ? remaining : amount,
    quota.creditLimit,
    quota.creditsUsed
  );
}

export async function refundExternalApiKeyCredits(params: {
  apiKeyId?: string;
  userId: string;
  amount: number;
}) {
  if (!params.apiKeyId) return;
  const amount = roundQuotaCredits(params.amount);
  if (amount <= 0) return;

  await db
    .update(externalApiKey)
    .set({
      creditsUsed: sql`GREATEST(0, ${externalApiKey.creditsUsed} - ${amount})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(externalApiKey.id, params.apiKeyId),
        eq(externalApiKey.userId, params.userId)
      )
    );
}
