/**
 * 使用日志内部稳定排序键的解析契约。
 *
 * 使用方：service 在进入仓储前验证签名 cursor，repository 将全局排序键收窄为
 * 分支原始主键谓词。该值只存在于服务端，不进入错误消息或日志。
 */

import { z } from "zod";

/** SQL 四类事实生成的内部稳定键。 */
export const usageLogStableIdSchema = z.union([
  z.tuple([z.literal("generation"), z.string().min(1).max(500)]),
  z.tuple([z.literal("video"), z.string().min(1).max(500)]),
  z.tuple([
    z.literal("operation"),
    z.string().min(1).max(200),
    z.string().min(1).max(300),
  ]),
  z.tuple([z.literal("refund"), z.string().min(1).max(500)]),
]);

export type UsageLogStableId = z.infer<typeof usageLogStableIdSchema>;

/**
 * 解析服务端签发 cursor/eventRef 中的结构化稳定键。
 *
 * @param value PostgreSQL `json_build_array(... )::text` 生成的 JSON。
 * @returns 通过精确 schema 的分支键；格式或边界非法时返回 null。
 * @sideEffects 无；不会记录原始值。
 */
export function parseUsageLogStableId(value: string): UsageLogStableId | null {
  try {
    return usageLogStableIdSchema.parse(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

/**
 * 验证稳定键分支与全局事件 rank 的固定对应关系。
 *
 * @param stableId 已通过 schema 的内部稳定键。
 * @param eventKindRank cursor 中的全局次级排序值。
 * @returns generation 可为图片 3 或历史 1，其余分支各有唯一 rank。
 * @sideEffects 无。
 */
export function isUsageLogStableRankValid(
  stableId: UsageLogStableId,
  eventKindRank: number
): boolean {
  if (stableId[0] === "generation") {
    return eventKindRank === 3 || eventKindRank === 1;
  }
  if (stableId[0] === "video") return eventKindRank === 2;
  if (stableId[0] === "operation") return eventKindRank === 1;
  return eventKindRank === 0;
}
