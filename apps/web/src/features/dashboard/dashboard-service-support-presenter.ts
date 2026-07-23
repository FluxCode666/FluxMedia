/**
 * 控制台服务与支持卡片的纯展示转换。
 *
 * 组件使用本模块选择当前语言文案和过滤启用服务项；保持 DB-free，覆盖中英文配置
 * 与服务启停边界。
 */
import type { DashboardSupportConfig } from "@repo/shared/support/dashboard-config";

/**
 * 选择系统配置中的当前语言文案。
 *
 * @param value 已通过共享 schema 校验的中英文文案。
 * @param isZh 当前页面是否为中文。
 * @returns 与当前页面语言一致的文案。
 */
export function selectDashboardSupportText(
  value: { zh: string; en: string },
  isZh: boolean
): string {
  return isZh ? value.zh : value.en;
}

/**
 * 返回当前语言下启用的服务入口，保留管理员配置顺序。
 *
 * @param config 已校验的控制台支持配置。
 * @returns 仅包含 enabled 服务项的新数组。
 */
export function getEnabledDashboardServices(
  config: DashboardSupportConfig
): DashboardSupportConfig["services"] {
  return config.services.filter((service) => service.enabled);
}
