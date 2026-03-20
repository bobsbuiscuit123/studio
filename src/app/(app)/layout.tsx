
'use client';

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { AppMobileTabBar } from "@/components/app-mobile-tab-bar";
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
  const isMessagesRoute =
    pathname === "/messages" ||
    pathname.startsWith("/messages/") ||
    pathname === "/demo/app/messages" ||
    pathname.startsWith("/demo/app/messages/");

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
      <div className="app-root app-shell grid w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr] print:block print:md:grid-cols-1 print:lg:grid-cols-1">
        <div className="print:hidden">
          <AppSidebar />
        </div>
        <div className="app-shell-main relative min-h-0 min-w-0">
          <div className="print:hidden">
            <AppHeader />
          </div>
          <ImportLocalData />
          <main
            className={`app-tab-stage main-container mx-auto w-full max-w-screen-md min-h-0 min-w-0 overflow-x-clip print:p-0 ${
              isMessagesRoute
                ? "messages-route-shell gap-0 px-0 py-0"
                : "safe-bottom-space gap-4 px-4 py-0 sm:max-w-none sm:px-4 sm:py-0 lg:gap-6 lg:px-6 lg:py-0"
            }`}
          >
            <OfflineCallout />
            <AppRouteContentBoundary>{children}</AppRouteContentBoundary>
          </main>
          <div className="print:hidden md:hidden">
            <AppMobileTabBar />
          </div>
        </div>
      </div>
    </NotificationsProvider>
  );
}
