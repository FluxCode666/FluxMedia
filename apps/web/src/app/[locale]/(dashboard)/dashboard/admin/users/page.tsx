import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getServerSession } from "@repo/shared/auth/server";
import { AdminUsersManagement } from "@repo/shared/support/components";

export default async function DashboardAdminUsersPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  if ((session.user as { role?: string }).role !== "admin") {
    redirect(`/${locale}/dashboard`);
  }

  return <AdminUsersManagement />;
}
