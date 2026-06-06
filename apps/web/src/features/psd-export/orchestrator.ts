/**
 * PSD 导出编排:用 LayerD 把一张已生成的底图分解成分层 PSD,存储并返回签名下载链接。
 *
 * WHY:把"原图分解成可编辑分层"是图像分解问题;LayerD(Python:BiRefNet 抠图 + LaMa 补全)
 * 直接输出分层 PSD。本编排把底图写临时文件 → 调 LayerD CLI(子进程,见 layerd.ts)→ 读回 .psd
 * → 存入与底图同一存储桶。**不生成任何新图、不扣费**。
 *
 * 使用方:apps/web 的 server action / UOL image.exportPsd。CPU ~20-60s,由异步导出 + 前端轮询承载。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSignedStorageImageUrl } from "@repo/shared/storage";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { nanoid } from "nanoid";
import { getGenerationById } from "@/features/image-generation/queries";
import { runLayerD } from "./layerd";

/** PSD 签名下载链接有效期(秒)。 */
const PSD_SIGNED_URL_TTL_SECONDS = 7200;

export type ExportLayeredPsdInput = {
  userId: string;
  /** 底图所属 generation。 */
  generationId: string;
  /** 预先算好的 PSD 存储 key(异步导出:action 先返回签名 URL,后台用同一 key 写入)。 */
  psdStorageKey?: string;
};

export type ExportLayeredPsdResult = {
  psdStorageKey: string;
  psdSignedUrl: string;
};

/**
 * 执行 PSD 导出:底图 → LayerD 分层 → 存储 → 返回签名下载链接。
 *
 * @throws 底图不存在/无权/未完成,或 LayerD 失败时抛错。
 */
export async function exportLayeredPsdForUser(
  input: ExportLayeredPsdInput
): Promise<ExportLayeredPsdResult> {
  const base = await getGenerationById(input.generationId);
  if (!base || base.userId !== input.userId) {
    throw new Error("底图不存在或无权访问");
  }
  if (base.status !== "completed" || !base.storageKey) {
    throw new Error("底图尚未完成,无法导出 PSD");
  }
  const bucket = base.storageBucket || "generations";
  const storage = await getStorageProvider();
  const baseBytes = await storage.getObject(base.storageKey, bucket);

  const dir = await mkdtemp(path.join(tmpdir(), "psd-export-"));
  try {
    const inputPath = path.join(dir, "input.png");
    const outputPath = path.join(dir, "output.psd");
    await writeFile(inputPath, baseBytes);
    await runLayerD(inputPath, outputPath);
    const psdBuffer = await readFile(outputPath);

    const psdStorageKey =
      input.psdStorageKey || `${input.userId}/${nanoid(32)}.psd`;
    await storage.putObject(
      psdStorageKey,
      bucket,
      psdBuffer,
      "image/vnd.adobe.photoshop"
    );
    const psdSignedUrl =
      buildSignedStorageImageUrl(
        psdStorageKey,
        bucket,
        PSD_SIGNED_URL_TTL_SECONDS
      ) || "";
    return { psdStorageKey, psdSignedUrl };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
