/**
 * 解析启动期超级管理员的环境凭据。
 *
 * 由超级管理员引导流程使用；刻意不依赖数据库或系统设置，以便在启动前和单元测试中安全校验。
 */
import { z } from "zod";

export const SUPER_ADMIN_EMAIL_ENV = "FLUXMEDIA_SUPER_ADMIN_EMAIL";
export const SUPER_ADMIN_PASSWORD_ENV = "FLUXMEDIA_SUPER_ADMIN_PASSWORD";

/**
 * 自用模式初始化超管所需的环境变量。
 *
 * 密码保留原始值以确保登录凭据与部署环境完全一致；仅验证其不是空白字符串。
 */
export type BootstrapSuperAdminEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * 初始化超管的已校验凭据。
 *
 * 仅在启动期传递给密码哈希函数，绝不写入日志、数据库明文字段或本地文件。
 */
export interface BootstrapSuperAdminCredentials {
  email: string;
  password: string;
}

const bootstrapSuperAdminCredentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().refine((value) => value.trim().length > 0),
});

/**
 * 从环境变量读取首次初始化超管所需的账号与密码。
 *
 * @param environment - 默认读取当前进程环境，测试可传入独立配置。
 * @returns 规范化后的凭据；任一字段缺失或非法时返回 null。
 * @sideEffects 无；密码不会被记录、修改或持久化。
 */
export function getBootstrapSuperAdminCredentials(
  environment: BootstrapSuperAdminEnvironment = process.env
): BootstrapSuperAdminCredentials | null {
  const result = bootstrapSuperAdminCredentialsSchema.safeParse({
    email: environment[SUPER_ADMIN_EMAIL_ENV],
    password: environment[SUPER_ADMIN_PASSWORD_ENV],
  });

  if (!result.success) return null;

  return {
    email: result.data.email.toLowerCase(),
    password: result.data.password,
  };
}
