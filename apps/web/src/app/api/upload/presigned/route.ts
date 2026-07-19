/**
 * 登录用户的通用文件预签名上传路由。
 *
 * 鉴权与响应字段保持原契约；存储 provider、bucket 和 endpoint 来自同一份运行时
 * 设置快照，因此后台切换 local/S3、轮换密钥或修改 bucket 后无需重启服务。
 */

import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { logError } from "@repo/shared/logger";
import { getStorageRuntimeSnapshot } from "@repo/shared/storage/providers";
import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";
import { validateUploadRequest } from "./validation";

/**
 * 获取预签名上传 URL
 *
 * POST /api/upload/presigned
 * Body: { filename: string, contentType: string, fileSize: number }
 */
export const POST = withApiLogging(async (request: NextRequest) => {
  try {
    // 验证用户登录
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { filename } = body as { filename: string };

    // 校验文件名、文件类型与大小（纯逻辑在 validation.ts，便于单测）。
    // 失败时返回 400；成功时拿到服务端派生的安全 Content-Type。
    const validation = validateUploadRequest(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { safeContentType } = validation;

    // 生成唯一的文件 key
    const fileExtension = filename.match(/\.[^.]+$/)?.[0] || "";
    const fileKey = `uploads/${session.user.id}/${nanoid()}${fileExtension}`;

    // provider、bucket 与 endpoint 必须来自同一快照，避免配置切换期间混用。
    const storage = await getStorageRuntimeSnapshot();
    const presignedUrl = await storage.provider.getSignedUploadUrl(
      fileKey,
      storage.bucketName,
      safeContentType,
      3600
    );

    // 构建文件访问 URL
    const fileUrl = storage.endpoint
      ? `${storage.endpoint}/${storage.bucketName}/${fileKey}`
      : `/api/storage/${storage.bucketName}/${fileKey}`;

    return NextResponse.json({
      presignedUrl,
      fileKey,
      fileUrl,
      contentType: safeContentType,
      expiresIn: 3600,
    });
  } catch (error) {
    logError(error, { source: "api.upload.presigned" });
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
});
