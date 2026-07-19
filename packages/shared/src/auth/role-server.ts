import { db, user } from "@repo/database";
import { eq } from "drizzle-orm";

import { normalizeUserRole, type AppUserRole } from "./roles";

/**
 * 按 userId 解析当前角色。授权链根：adminAction/superAdminAction/checkAdmin
 * 与多数 dashboard 页面渲染都经此取角色。
 *
 * @param userId - 需要查询的用户主键。
 * @returns 已规范化的应用角色；用户不存在或角色非法时安全降级为 user。
 * @sideEffects 只读数据库。首次超管提权由 bootstrap 流程承担，避免读路径暗含写入。
 */
export async function getUserRoleById(userId: string): Promise<AppUserRole> {
  const [record] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return normalizeUserRole(record?.role);
}
