/**
 * Dashboard Server Action 错误的客户端安全文案映射。
 *
 * 只把已知、安全的服务端提示转换为当前界面语言；其他字符串和未知结构统一使用
 * 调用方提供的兜底文案，防止开发环境把 SQL、参数或内部错误原样放进 Toast。
 */
import {
  DATABASE_QUERY_TIMEOUT_MESSAGE,
  DATABASE_QUERY_UNAVAILABLE_MESSAGE,
} from "@repo/shared/database-error-messages";

/** 返回适合 Dashboard Toast 展示的本地化安全错误文案。 */
export function getDashboardActionErrorMessage(
  serverError: unknown,
  isZh: boolean,
  fallback: string
): string {
  if (serverError === DATABASE_QUERY_TIMEOUT_MESSAGE) {
    return isZh
      ? DATABASE_QUERY_TIMEOUT_MESSAGE
      : "Data query timed out. Please try again.";
  }
  if (serverError === DATABASE_QUERY_UNAVAILABLE_MESSAGE) {
    return isZh
      ? DATABASE_QUERY_UNAVAILABLE_MESSAGE
      : "Data is temporarily unavailable. Please try again.";
  }
  return fallback;
}
