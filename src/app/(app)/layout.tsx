
'use client';

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { ImportLocalData } from "@/components/import-local-data";
import { OfflineCallout } from "@/components/network-status";
import { NotificationsProvider } from "@/components/notifications-provider";
import { AppRouteContentBoundary } from "@/components/app-route-content-boundary";
import { getSelectedGroupId, getSelectedOrgId } from "@/lib/selection";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const orgId = getSelectedOrgId();
    const groupId = getSelectedGroupId();
    if (orgId && !groupId && pathname !== "/clubs") {
      router.replace("/clubs");
    }
  }, [pathname, router]);

  return (
    <NotificationsProvider>
      <div className="app-shell grid w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr] print:block print:md:grid-cols-1 print:lg:grid-cols-1">
        <div className="print:hidden">
          <AppSidebar />
        </div>
        <div className="relative flex min-w-0 flex-col">
          <div className="print:hidden">
            <AppHeader />
          </div>
          <ImportLocalData />
          <main className="safe-bottom-space flex min-w-0 flex-1 flex-col gap-4 overflow-x-clip p-4 lg:gap-6 lg:p-6 print:p-0">
            <OfflineCallout />
            <AppRouteContentBoundary>{children}</AppRouteContentBoundary>
          </main>
        </div>
      </div>
    </NotificationsProvider>
  );
}
