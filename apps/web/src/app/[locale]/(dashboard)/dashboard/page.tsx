/**
 * 用户控制台首页的服务端入口。
 *
 * 本页只负责会话鉴权、本人 Principal 和首屏快照装配；交互筛选、刷新状态与图表拆包
 * 由 dashboard feature 承担。摘要固定为今日/累计，默认趋势为按小时的近 24 小时。
 */
import type { UsageTrendsInput } from "@repo/shared/analytics/contracts";
import { auth } from "@repo/shared/auth";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { DashboardAnalyticsPanel } from "@/features/dashboard/components/dashboard-analytics-panel";
import { loadDashboardSnapshot } from "@/features/dashboard/dashboard-data";

const DEFAULT_TRENDS_INPUT = {
  granularity: "hour",
  metric: "imageCount",
  range: "last24Hours",
} satisfies UsageTrendsInput;

/**
 * 渲染已登录用户的分析优先控制台。
 *
 * @returns 今日/累计摘要、默认趋势、活动分布和近期创作；未登录时重定向登录页。
 */
export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const locale = await getLocale();
  if (!session?.user) redirect(`/${locale}/sign-in`);

  const role = await getUserRoleById(session.user.id);
  const snapshot = await loadDashboardSnapshot({
    userId: session.user.id,
    role,
    trendsInput: DEFAULT_TRENDS_INPUT,
  });

  return (
    <div className="container mx-auto px-4 py-6 md:px-6">
      <DashboardAnalyticsPanel
        initialSnapshot={snapshot}
        isZh={locale === "zh"}
        userName={session.user.name || session.user.email || "User"}
      />
    </div>
  );
}
