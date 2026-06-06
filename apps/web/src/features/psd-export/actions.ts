"use server";

import { logError } from "@repo/shared/logger";
import { protectedAction } from "@repo/shared/safe-action";
import { buildSignedStorageImageUrl } from "@repo/shared/storage";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getGenerationById } from "@/features/image-generation/queries";
import { exportLayeredPsdForUser } from "./orchestrator";

/** PSD 签名下载链接有效期(秒):覆盖后台分解耗时 + 用户下载。 */
const PSD_SIGNED_URL_TTL_SECONDS = 7200;

/**
 * 导出分层 PSD(异步)。
 *
 * 用 LayerD 把当前底图分解成可编辑分层 PSD(不生成新图、不扣费)。WHY 异步:LayerD 在 CPU 上
 * ~20-60s、可能超 Cloudflare 100s。故先同步校验底图,算好 PSD 存储 key 与签名 URL,**后台开跑
 * (不 await)**,立即返回 URL;前端轮询该 URL(对象未写入时存储路由返回 404,写好返回 200)。
 */
const exportPsdSchema = z.object({
  generationId: z.string().min(1),
});

export const exportPsdAction = protectedAction
  .metadata({ action: "psd-export.export" })
  .schema(exportPsdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const base = await getGenerationById(parsedInput.generationId);
    if (!base || base.userId !== ctx.userId) {
      throw new Error("底图不存在或无权访问");
    }
    if (base.status !== "completed" || !base.storageKey) {
      throw new Error("底图尚未完成,无法导出 PSD");
    }

    const bucket = base.storageBucket || "generations";
    const psdStorageKey = `${ctx.userId}/${nanoid(32)}.psd`;
    const psdSignedUrl =
      buildSignedStorageImageUrl(
        psdStorageKey,
        bucket,
        PSD_SIGNED_URL_TTL_SECONDS
      ) || "";

    // 后台分解:不 await,避免请求阻塞超时。完成后 PSD 写到 psdStorageKey,前端轮询签名 URL。
    void exportLayeredPsdForUser({
      userId: ctx.userId,
      generationId: parsedInput.generationId,
      psdStorageKey,
    }).catch((error) => {
      logError(error, {
        source: "psd-export.background",
        userId: ctx.userId,
        psdStorageKey,
      });
    });

    return { psdSignedUrl };
  });
