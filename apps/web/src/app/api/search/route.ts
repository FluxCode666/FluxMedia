/**
 * 管理员文档的全文搜索 API。
 *
 * 搜索索引包含 /docs 下的内部架构内容，因此在调用 Fumadocs 搜索处理器前执行与文档
 * 页面一致的真实角色校验，关闭绕过页面守卫直接枚举索引的旁路。
 */
import { withApiLogging } from "@repo/shared/api-logger";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { createFromSource } from "fumadocs-core/search/server";

import { docsSource } from "@/lib/source";

/**
 * Orama 搜索 API
 *
 * 基于 fumadocs-core 的 Orama 搜索实现
 * 自动索引文档内容，支持全文搜索
 */
const searchHandlers = createFromSource(docsSource);

/**
 * 校验管理员身份后执行搜索。
 *
 * @param request - Fumadocs 搜索请求。
 * @returns 未登录为 401、非管理员为 403，管理员返回原搜索响应。
 */
async function handleGet(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return searchHandlers.GET(request);
}

export const GET = withApiLogging(handleGet);
