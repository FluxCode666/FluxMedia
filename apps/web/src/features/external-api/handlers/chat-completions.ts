import { withApiLogging } from "@repo/shared/api-logger";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import type { NextRequest } from "next/server";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import { openAIImageError } from "@/features/external-api/images";

export const postUnsupportedChatCompletions = withApiLogging(
  async (request: NextRequest) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }
    if (
      !(await canUsePlanCapability(
        auth.plan,
        "externalApi.chat.completions"
      ))
    ) {
      return openAIImageError(
        "External chat completions is not enabled for this plan.",
        403,
        "insufficient_plan"
      );
    }

    return openAIImageError(
      "GPT2Image does not support /v1/chat/completions. Use /v1/responses for Responses image models, or /v1/images/generations and /v1/images/edits for image models.",
      400,
      "unsupported_endpoint"
    );
  }
);
