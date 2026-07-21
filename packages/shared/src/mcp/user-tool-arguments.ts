/**
 * User MCP 工具参数的身份收口规则。
 *
 * 旧 UOL 操作仍可能声明 userId，因此传输层需强制覆盖为当前 Principal；Analytics
 * 等本人操作刻意不接收 userId，只能由 execute 从 Principal 派生，避免身份字段进入
 * JSON Schema 或被客户端伪造。
 */
import type { Principal } from "../uol/principal";

/** 为 User MCP 工具生成不可越权的最终参数。 */
export function enrichUserMcpToolArguments(
  operationName: string,
  args: Record<string, unknown>,
  principal: Principal
): Record<string, unknown> {
  if (principal.type !== "apiKey" && principal.type !== "user") return args;
  if (operationName.startsWith("analytics.")) {
    const { userId: _discardedUserId, ...identityFreeArgs } = args;
    return identityFreeArgs;
  }
  return { ...args, userId: principal.userId };
}
