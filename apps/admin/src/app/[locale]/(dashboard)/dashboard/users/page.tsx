import { AdminUsersManagement } from "@repo/shared/support/components";
import { getAppTimeZone } from "@repo/shared/time-zone/server";

export default async function AdminUsersPage() {
  const timeZone = await getAppTimeZone();
  return <AdminUsersManagement timeZone={timeZone} />;
}
