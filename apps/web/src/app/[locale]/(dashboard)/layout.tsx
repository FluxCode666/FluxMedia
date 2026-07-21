/**
 * 已登录控制台路由组的公共布局。
 *
 * 负责首屏会话、角色、侧栏与创作运行时；查询暂不可用时降级为空侧栏会话，让子页面
 * 显示可重试状态，而不是由布局抛出包含服务端堆栈的错误页。
 */
// 直接从各模块导入(不经 barrel index.ts):barrel re-export 多个卡片组件,经它导入会把
// 这些组件及其依赖一并拖进每页必载的公共 bundle(tree-shaking 被 barrel 破坏)。

import { getUserRoleById } from "@repo/shared/auth/role-server";
import { getServerSession } from "@repo/shared/auth/server";
import { logError } from "@repo/shared/logger";
import type { CurrentSession } from "@/features/auth/hooks/use-current-session";
import { DashboardMainWrapper } from "@/features/dashboard/components/main-wrapper";
import { DashboardSidebar } from "@/features/dashboard/components/sidebar";
import { SidebarProvider } from "@/features/dashboard/context";
import { getDashboardLoadFailureReason } from "@/features/dashboard/dashboard-load-error";
import { CreateRuntimeProvider } from "@/features/image-generation/create-runtime-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 读取侧栏首屏会话；查询故障时记录脱敏事件并交由子页面展示重试状态。 */
async function loadInitialDashboardSession(): Promise<CurrentSession> {
  try {
    const serverSession = await getServerSession();
    return serverSession?.user?.id
      ? {
          user: {
            id: serverSession.user.id,
            name: serverSession.user.name || "",
            email: serverSession.user.email || "",
            image: serverSession.user.image,
            role: await getUserRoleById(serverSession.user.id),
          },
        }
      : null;
  } catch (error) {
    const reason = getDashboardLoadFailureReason(error);
    if (reason !== "query_timeout" && reason !== "query_unavailable") {
      throw error;
    }
    const isTimeout = reason === "query_timeout";
    logError(
      new Error(
        isTimeout
          ? "Dashboard layout database query timed out"
          : "Dashboard layout session data is temporarily unavailable"
      ),
      {
        source: "dashboard-layout",
        category: isTimeout ? "database-timeout" : "auth-session-unavailable",
      }
    );
    return null;
  }
}

/** 渲染控制台公共侧栏与主内容容器。 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialSession = await loadInitialDashboardSession();

  return (
    <SidebarProvider>
      <CreateRuntimeProvider>
        <div className="min-h-screen bg-muted">
          <DashboardSidebar initialSession={initialSession} />
          <DashboardMainWrapper>{children}</DashboardMainWrapper>
        </div>
      </CreateRuntimeProvider>
    </SidebarProvider>
  );
}
