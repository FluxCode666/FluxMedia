/**
 * 内容审核的纯逻辑工具。
 *
 * 职责：集中阿里云风险等级判定与文本分块，使其可在 DB-free 测试中验证。
 * 使用方：moderation/index.ts 的阿里云审核分支。
 * 关键依赖：policy-contract 提供管理员策略允许的拦截阈值类型。
 */
import type { ModerationBlockRiskLevel } from "./policy-contract";

export type AliyunRiskLevel = "none" | "low" | "medium" | "high";

// 阿里云单次内容审核的最大字符数，超出需分块提交。
export const ALIYUN_MAX_CONTENT_LENGTH = 2000;

// 风险等级权重，数值越大风险越高，用于与可信生效阈值比较。
export const ALIYUN_RISK_ORDER: Record<AliyunRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

// 判断某条阿里云审核结果是否应拦截。
// 边界与失败模式：
// - riskLevel 非 string 视为无效，返回 false（不拦截，由上层错误处理兜底）。
// - 未知标签按"非 pass 即拦截"处理（fail-closed：默认拦截未识别的风险）。
// - 已知标签按 ALIYUN_RISK_ORDER 与管理员生效阈值比较，达到即拦截。
export function shouldBlockAliyunRisk(
  riskLevel: unknown,
  blockRiskLevel: ModerationBlockRiskLevel
): boolean {
  if (typeof riskLevel !== "string") return false;
  const normalized = riskLevel.toLowerCase();
  if (!(normalized in ALIYUN_RISK_ORDER)) return normalized !== "pass";

  return (
    ALIYUN_RISK_ORDER[normalized as AliyunRiskLevel] >=
    ALIYUN_RISK_ORDER[blockRiskLevel]
  );
}

// 按阿里云单次审核长度上限把文本切分为多块；空文本返回单个空块，
// 保证调用方至少提交一次审核请求。
export function getContentChunks(content: string): string[] {
  const chunks: string[] = [];
  for (
    let index = 0;
    index < content.length;
    index += ALIYUN_MAX_CONTENT_LENGTH
  ) {
    chunks.push(content.slice(index, index + ALIYUN_MAX_CONTENT_LENGTH));
  }
  return chunks.length ? chunks : [content];
}
