/**
 * 用户用量统计共享契约桶导出。
 *
 * Web、UOL、MCP 和后续 Agent 传输统一从此入口读取 schema 与范围解析器，避免输入
 * 枚举、默认值、输出单位和日期边界在不同适配器间漂移。
 */

export * from "./contracts";
export * from "./range";
export * from "./series";
