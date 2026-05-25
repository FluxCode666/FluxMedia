import {
  DashboardMainWrapper,
  DashboardSidebar,
} from "@/features/dashboard/components";
import { SidebarProvider } from "@/features/dashboard/context";
import { CreateRuntimeProvider } from "@/features/image-generation/create-runtime-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <CreateRuntimeProvider>
        <div className="min-h-screen bg-muted">
          <DashboardSidebar />
          <DashboardMainWrapper>{children}</DashboardMainWrapper>
        </div>
      </CreateRuntimeProvider>
    </SidebarProvider>
  );
}
