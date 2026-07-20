/**
 * 在自用模式首次启动时创建超级管理员。
 *
 * 由 Next.js instrumentation 调用；依赖数据库、Better Auth 密码哈希和环境变量凭据。
 * 只处理尚无超级管理员的实例，绝不在后续启动时覆盖已有密码。
 */
import { randomUUID } from "node:crypto";
import { db, account, user } from "@repo/database";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { getBootstrapSuperAdminCredentials } from "./bootstrap-super-admin-config";
import { normalizeUserRole } from "./roles";
import { isSelfUseModeEnabled } from "./self-use-mode";

let bootstrapped = false;

/**
 * 按配置邮箱查找待引导的已有账号。
 *
 * @param email - 已由配置解析器校验并规范化的超管邮箱。
 * @returns 匹配的用户记录；不存在时为 undefined。
 * @sideEffects 只读数据库。
 */
async function findBootstrapAdmin(email: string) {
  const [record] = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  return record;
}

/**
 * 判断用户是否已有 Better Auth credential 登录账号。
 *
 * @param userId - 用户主键。
 * @returns 有 credential 账号时为 true。
 * @sideEffects 只读数据库。
 */
async function hasCredentialAccount(userId: string) {
  const [record] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential"))
    )
    .limit(1);

  return Boolean(record);
}

/**
 * 为用户创建 Better Auth credential 登录账号。
 *
 * @param userId - 用户主键。
 * @param password - 从环境变量读取的原始密码，仅用于计算哈希。
 * @sideEffects 写入密码哈希；不会持久化或记录明文密码。
 */
async function createCredentialAccount(userId: string, password: string) {
  await db.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * 引导自用模式的首个超级管理员。
 *
 * 自用模式关闭、已有超管或本进程已执行时直接返回。需要创建或补齐 credential
 * 账号时，必须从环境变量读取有效凭据；缺失时安全跳过，不生成默认账号或密码。
 *
 * @returns 无返回值。
 * @sideEffects 可能创建或提升用户，并写入密码哈希；异常会记录后被启动流程吸收。
 */
export async function bootstrapSelfUseSuperAdmin() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    if (!(await isSelfUseModeEnabled())) return;

    const [existingSuperAdmin] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "super_admin"))
      .limit(1);

    if (existingSuperAdmin) return;

    const credentials = getBootstrapSuperAdminCredentials();
    if (!credentials) {
      console.warn(
        "[FluxMedia] Self-use super admin bootstrap skipped: FLUXMEDIA_SUPER_ADMIN_EMAIL and FLUXMEDIA_SUPER_ADMIN_PASSWORD must be configured."
      );
      return;
    }

    const existingBootstrapAdmin = await findBootstrapAdmin(credentials.email);
    if (existingBootstrapAdmin) {
      if (normalizeUserRole(existingBootstrapAdmin.role) !== "super_admin") {
        await db
          .update(user)
          .set({
            role: "super_admin",
            emailVerified: true,
            updatedAt: new Date(),
          })
          .where(eq(user.id, existingBootstrapAdmin.id));
      }

      if (!(await hasCredentialAccount(existingBootstrapAdmin.id))) {
        await createCredentialAccount(
          existingBootstrapAdmin.id,
          credentials.password
        );
      }
      return;
    }

    const userId = randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "FluxMedia Super Admin",
      email: credentials.email,
      emailVerified: true,
      role: "super_admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createCredentialAccount(userId, credentials.password);
  } catch (error) {
    console.warn(
      `[FluxMedia] Self-use super admin bootstrap skipped: ${
        error instanceof Error ? error.name : "unknown error"
      }`
    );
  }
}
