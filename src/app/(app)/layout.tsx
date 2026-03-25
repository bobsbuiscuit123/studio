
'use client';

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { initializeRevenueCat } from "@/lib/token-purchases";

import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { AppMobileTabBar } from "@/components/app-mobile-tab-bar";
import { ImportLocalData } from "@/components/import-local-data";
import { OfflineCallout } from "@/components/network-status";
import { NotificationsProvider } from "@/components/notifications-provider";
import { PushNotificationClient } from "@/components/push-notifications";
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

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      console.log("Not native, skipping RevenueCat");
      return;
    }

    void initializeRevenueCat();
  }, []);

  return (
    <NotificationsProvider>
      <PushNotificationClient />
      <div className="app-shell w-full md:grid md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr] print:block print:md:grid-cols-1 print:lg:grid-cols-1">
        <div className="hidden print:hidden md:block">
          <AppSidebar />
        </div>
        <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <div className="shrink-0 print:hidden">
            <AppHeader />
          </div>
          <main
            className={`main-container mx-auto flex w-full max-w-screen-md min-h-0 min-w-0 flex-1 flex-col overflow-x-clip bg-background print:p-0 ${
              isMessagesRoute
                ? "messages-route-shell gap-0 px-0 py-0"
                : "safe-bottom-space gap-4 px-4 py-0 sm:max-w-none sm:px-4 sm:py-0 lg:gap-6 lg:px-6 lg:py-0"
            }`}
          >
            <ImportLocalData />
            <OfflineCallout />
            <AppRouteContentBoundary>{children}</AppRouteContentBoundary>
          </main>
          <div className="shrink-0 print:hidden md:hidden">
            <AppMobileTabBar />
          </div>
        </div>
      </div>
    </NotificationsProvider>
  );
}
