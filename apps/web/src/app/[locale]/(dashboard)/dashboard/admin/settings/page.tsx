import { redirect } from "next/navigation";

import { getServerSession } from "@repo/shared/auth/server";
import { SystemSettingsPanel } from "@repo/shared/system-settings/components";

export default async function DashboardAdminSettingsPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in");
  }

  if ((session.user as { role?: string }).role !== "admin") {
    redirect("/dashboard");
  }

  return <SystemSettingsPanel />;
}
