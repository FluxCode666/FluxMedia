/**
 * MCP 模块桶导出
 *
 * 职责：聚合 Admin MCP 与 User MCP 的公共 API。
 * 两套 MCP 物理隔离：独立鉴权、独立路由、独立工具集。
 */

export {
  authenticateMcpAdmin,
  type McpAuthResult,
} from "./admin-auth";
// --- Admin MCP ---
export {
  getMcpAdminSecret,
  getMcpDeniedOps,
  getMcpRateLimitPerMin,
  getMcpReadOnlyMode,
  isMcpAdminEnabled,
} from "./config";
export { redactSensitiveFields } from "./redact";
export {
  buildAdminMcpTools,
  type McpToolDefinition,
  operationNameToToolName,
  toolNameToOperationName,
} from "./tool-factory";
export {
  type AuthenticateMcpUserKeyFn,
  authenticateMcpUserKey,
  bindMcpUserAuth,
  McpAuthError,
} from "./user-auth";
// --- User MCP ---
export { getMcpUserRateLimitPerMin, isMcpUserEnabled } from "./user-config";
export { enrichUserMcpToolArguments } from "./user-tool-arguments";
export { buildUserMcpTools, type McpToolDescriptor } from "./user-tool-factory";
