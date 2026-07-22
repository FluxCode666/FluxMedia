/**
 * 图像分辨率结算档位快照。
 *
 * 使用方：统一生图管线在请求与实际输出落库时写入不可变档位，历史详情只读取该
 * 快照，不使用当前价格配置反推旧记录。阈值复用分辨率模块的计价边界。
 */

import {
  IMAGE_1K_BASE_EDGE,
  IMAGE_2K_BASE_EDGE,
  IMAGE_4K_BASE_EDGE,
  parseImageSize,
} from "./resolution";

export type ImageResolutionSettlement = "1024" | "1K" | "2K" | "4K";

/**
 * 将可解析的像素尺寸映射到固定计价档位。
 *
 * @param size 请求或实际输出尺寸，例如 `2048x1152`。
 * @returns 按最长边确定的档位；`auto`、缺失或非法尺寸返回 `null`。
 */
export function resolveImageResolutionSettlement(
  size: string | null | undefined
): ImageResolutionSettlement | null {
  const dimensions = parseImageSize(size ?? "");
  if (!dimensions) return null;

  const longestEdge = Math.max(dimensions.width, dimensions.height);
  if (longestEdge >= IMAGE_4K_BASE_EDGE) return "4K";
  if (longestEdge >= IMAGE_2K_BASE_EDGE) return "2K";
  if (longestEdge >= IMAGE_1K_BASE_EDGE) return "1K";
  return "1024";
}
