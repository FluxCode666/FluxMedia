/**
 * 使用日志 Action 的稳定用户错误文案。
 *
 * 使用方：Server Action、服务端页面和 DB-free 测试。常量必须与 `"use server"`
 * 模块分离，避免 Next.js 把非异步导出误判为 Server Action。
 */

/** 读模型尚未完成部署或准备时可安全透传的固定提示。 */
export const USAGE_LOG_NOT_READY_MESSAGE = "使用日志正在准备中，请稍后再试";
