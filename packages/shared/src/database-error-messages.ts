/**
 * 数据查询故障的安全用户文案。
 *
 * 本模块不依赖数据库驱动，可同时由 Server Action 和 Client Component 导入。文案必须
 * 保持脱敏，不得包含 SQL、绑定参数、连接配置或内部异常消息。
 */
export const DATABASE_QUERY_TIMEOUT_MESSAGE = "数据查询超时，请稍后重试";
export const DATABASE_QUERY_UNAVAILABLE_MESSAGE = "数据暂时不可用，请稍后重试";
