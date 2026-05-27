import crypto from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import {
  destroyExpiredGenerationPhotos,
  expireStalePendingGenerations,
} from "@repo/shared/generation-maintenance";

function validateCronSecret(authHeader: string | null): boolean {
  if (!authHeader) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("CRON_SECRET environment variable is not set");
    return false;
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (!token) return false;

  const tokenHash = crypto
    .createHash("sha256")
    .update(Buffer.from(token))
    .digest();
  const secretHash = crypto
    .createHash("sha256")
    .update(Buffer.from(cronSecret))
    .digest();

  if (tokenHash.length !== secretHash.length) return false;
  return crypto.timingSafeEqual(tokenHash, secretHash);
}

export const POST = withApiLogging(async () => {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [pendingResults, photoRetention] = await Promise.all([
    expireStalePendingGenerations({ limit: 500 }),
    destroyExpiredGenerationPhotos({ limit: 500 }),
  ]);

  return NextResponse.json({
    success: true,
    expired: pendingResults.length,
    creditsRefunded: pendingResults.reduce(
      (total, item) => total + item.creditsRefunded,
      0
    ),
    details: pendingResults,
    photoRetention,
    timestamp: new Date().toISOString(),
  });
});

export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/images/expire-pending",
    method: "POST",
    description:
      "Expire pending image generations older than 20 minutes and destroy completed image files when configured",
    authentication: "Bearer token required (CRON_SECRET)",
  });
});
