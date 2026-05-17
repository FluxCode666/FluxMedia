import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getServerSession } from "@repo/shared/auth/server";
import { SystemSettingsPanel } from "@repo/shared/system-settings/components";

export default async function DashboardAdminSettingsPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  if ((session.user as { role?: string }).role !== "admin") {
    redirect(`/${locale}/dashboard`);
  }

  return <SystemSettingsPanel />;
}
