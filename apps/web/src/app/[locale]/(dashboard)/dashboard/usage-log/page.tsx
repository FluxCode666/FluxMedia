/**
 * 旧使用日志地址的兼容重定向。
 *
 * 使用日志页面已并入历史记录；保留此无界面路由，避免旧书签和外部回链失效。
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

/** 将旧地址兼容迁移到当前语言的历史记录页。 */
export default async function LegacyUsageLogPage() {
  const locale = await getLocale();
  redirect(`/${locale}/dashboard/history`);
}
