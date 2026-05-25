import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getUserRoleById } from "@repo/shared/auth/role-server";
import {
  canAccessAdminArea,
  canViewImageBackendPool,
} from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { getAppTimeZone } from "@repo/shared/time-zone/server";
import { ImageBackendPoolAdminPanel } from "@/features/image-backend-pool";
import { AdminSettingsTabs } from "./admin-settings-tabs";

export default async function DashboardAdminSettingsPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const role = await getUserRoleById(session.user.id);
  if (!canViewImageBackendPool(role)) {
    redirect(`/${locale}/dashboard`);
  }

  if (!canAccessAdminArea(role)) {
    const timeZone = await getAppTimeZone();
    return <ImageBackendPoolAdminPanel readOnly timeZone={timeZone} />;
  }
  const timeZone = await getAppTimeZone();

  return <AdminSettingsTabs timeZone={timeZone} />;
}
