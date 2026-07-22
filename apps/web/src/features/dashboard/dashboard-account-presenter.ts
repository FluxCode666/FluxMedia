/**
 * 控制台账户与支持卡片的纯展示转换。
 *
 * 组件使用本模块生成姓名回退、头像缩写和当前语言文案；保持 DB-free，覆盖空白
 * 会话字段与中英文配置边界。
 */
import type { DashboardSupportConfig } from "@repo/shared/support/dashboard-config";

export type DashboardAccountPresentation = {
  displayName: string;
  displayEmail: string;
  initials: string;
};

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
 * 把可空会话字段转换成账户卡可稳定展示的数据。
 *
 * @param input 会话中的姓名、邮箱与当前语言。
 * @returns 姓名、邮箱和最多两个 Unicode 字符的头像缩写。
 */
export function presentDashboardAccount(input: {
  name: string | null | undefined;
  email: string | null | undefined;
  isZh: boolean;
}): DashboardAccountPresentation {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const emailName = email.split("@")[0]?.trim() ?? "";
  const displayName =
    name || emailName || (input.isZh ? "未命名账户" : "Unnamed account");
  const displayEmail =
    email || (input.isZh ? "未提供邮箱" : "Email not provided");
  const words = displayName.split(/\s+/).filter(Boolean);
  const initialsSource =
    words.length > 1
      ? `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words[1] ?? "")[0] ?? ""}`
      : Array.from(displayName).slice(0, 2).join("");

  return {
    displayName,
    displayEmail,
    initials: initialsSource.toLocaleUpperCase() || "U",
  };
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
