/**
 * 头像上传大小限制解析与边界判断。
 * 设置资料页使用该模块消费套餐能力快照，并在快照缺失或非法时回退到
 * 调用方提供的保守上限；纯函数设计便于在 DB-free 的 Web 测试中验证边界。
 */

import type { PlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";

type AvatarUploadCapabilitySnapshot = {
  limits: Pick<PlanCapabilitySnapshot["limits"], "maxFileSizeBytes">;
};

/**
 * 从套餐能力快照解析头像单文件上限。
 *
 * @param capabilities - `getMyPlanAction` 返回的能力快照；加载失败时可为空。
 * @param fallbackMaxFileSizeBytes - 快照不可用时采用的保守字节上限。
 * @returns 有效的套餐字节上限；非法或缺失值返回保守上限。
 * @sideEffects 无。
 */
export function resolveAvatarMaxFileSizeBytes(
  capabilities: AvatarUploadCapabilitySnapshot | null | undefined,
  fallbackMaxFileSizeBytes: number
): number {
  const capabilityLimit = capabilities?.limits.maxFileSizeBytes;
  if (
    typeof capabilityLimit !== "number" ||
    !Number.isFinite(capabilityLimit) ||
    capabilityLimit <= 0
  ) {
    return fallbackMaxFileSizeBytes;
  }

  return Math.floor(capabilityLimit);
}

/**
 * 判断头像文件大小是否位于当前套餐允许范围内。
 *
 * @param fileSizeBytes - 浏览器 `File.size` 提供的文件字节数。
 * @param maxFileSizeBytes - 当前套餐允许的单文件最大字节数。
 * @returns 文件大小合法且未超过上限时返回 `true`；恰好等于上限也允许。
 * @sideEffects 无。
 */
export function isAvatarFileSizeAllowed(
  fileSizeBytes: number,
  maxFileSizeBytes: number
): boolean {
  return (
    Number.isFinite(fileSizeBytes) &&
    fileSizeBytes >= 0 &&
    fileSizeBytes <= maxFileSizeBytes
  );
}
