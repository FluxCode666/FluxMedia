import { getCurrentUser } from "@repo/shared/auth/server";

import { getCreditsBalance } from "@repo/shared/credits/core";
import { isContentModerationEnabled } from "@repo/shared/moderation";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getPlanUploadLimits } from "@repo/shared/subscription/services/upload-limits";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";
import { getUserTimeZone } from "@repo/shared/time-zone/server";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getEffectiveImageBackendGroupForUser } from "@/features/image-backend-pool/service";
import { CreatePageClient } from "@/features/image-generation/components/create-page-client";
import {
  getRuntimeImageBaseCreditPricing,
  getRuntimeImageModelCreditPricing,
  getRuntimeImageModerationCreditPricing,
} from "@/features/image-generation/pricing-settings";
import { getUserRecentGenerations } from "@/features/image-generation/queries";
import { getUserApiConfig } from "@/features/image-generation/service";
import { getVideoPricingForUser } from "@/features/image-generation/video-operations";
import { hasLayeredMeta } from "@/features/psd-export/layered-meta";

const DEFAULT_FORCE_WEB_MIN_PIXELS = 660_000;
const DEFAULT_FORCE_WEB_MAX_PIXELS = 2_000_000;

export default async function CreatePage() {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);

  const [creditsData, recentGenerations, plan, userApiConfig, timeZone] =
    await Promise.all([
      getCreditsBalance(user.id),
      getUserRecentGenerations(user.id, 6),
      getUserPlan(user.id),
      getUserApiConfig(user.id),
      getUserTimeZone(user.id),
    ]);
  const [uploadLimits, activeBackendGroup, moderationEnabled] =
    await Promise.all([
      getPlanUploadLimits(plan.plan),
      getEffectiveImageBackendGroupForUser(user.id, plan.plan),
      isContentModerationEnabled(),
    ]);
  const [
    capabilities,
    imageBasePricing,
    imageModelPricing,
    imageModerationPricing,
    forceWebMinPixels,
    forceWebMaxPixels,
    videoPricing,
  ] = await Promise.all([
    getPlanCapabilitySnapshot(plan.plan),
    getRuntimeImageBaseCreditPricing(),
    getRuntimeImageModelCreditPricing(),
    getRuntimeImageModerationCreditPricing(),
    getRuntimeSettingNumber(
      "IMAGE_FORCE_WEB_MIN_PIXELS",
      DEFAULT_FORCE_WEB_MIN_PIXELS,
      { nonNegative: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_FORCE_WEB_MAX_PIXELS",
      DEFAULT_FORCE_WEB_MAX_PIXELS,
      { positive: true }
    ),
    getVideoPricingForUser({ userId: user.id }),
  ]);
  const forceWebPixelRange = {
    minPixels: Math.min(forceWebMinPixels, forceWebMaxPixels),
    maxPixels: Math.max(forceWebMinPixels, forceWebMaxPixels),
  };

  const balance = creditsData?.balance || 0;

  const recents = recentGenerations.map((g) => ({
    id: g.id,
    prompt: g.prompt,
    revisedPrompt: g.revisedPrompt,
    model: g.model,
    size: g.size,
    creditsConsumed: g.creditsConsumed,
    status: g.status,
    imageUrl: buildSignedStorageImageUrl(g.storageKey, g.storageBucket),
    isLayered: hasLayeredMeta(g.metadata),
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <CreatePageClient
      balance={balance}
      recentGenerations={recents}
      plan={plan.plan}
      capabilities={capabilities}
      uploadLimits={uploadLimits}
      backendGroups={activeBackendGroup ? [activeBackendGroup] : []}
      selectedBackendGroupId={activeBackendGroup?.id ?? null}
      customApiActive={Boolean(userApiConfig)}
      moderationEnabled={moderationEnabled}
      imageBasePricing={imageBasePricing}
      imageModelPricing={imageModelPricing}
      imageModerationPricing={imageModerationPricing}
      forceWebPixelRange={forceWebPixelRange}
      timeZone={timeZone}
      videoPricing={videoPricing}
    />
  );
}
