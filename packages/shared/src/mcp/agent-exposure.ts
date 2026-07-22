/**
 * MCP Agent 暴露边界。
 *
 * 职责：为 Admin/User MCP 提供统一的 operation 暴露判定，确保标记为
 * human-only 的站内人工操作不会进入 tools/list，也无法经列表校验直调。
 * 使用方：tool-factory.ts、user-tool-factory.ts。
 */
import type { OperationDefinition } from "../uol/types";

/**
 * 判断 operation 是否允许投影为 Agent 工具。
 *
 * @param operation - 待投影的 UOL operation 定义
 * @returns 未标记 human-only 时返回 true
 * @sideEffects 无
 */
export function isOperationAgentExposable(
  operation: OperationDefinition
): boolean {
  return operation.agentExposure !== "human-only";
}
