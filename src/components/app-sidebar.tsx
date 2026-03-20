
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./icons";
import { AppSidebarNav } from "./app-sidebar-nav";
import { useCurrentUserRole } from "@/lib/data-hooks";
import { useNotificationsContext } from "@/components/notifications-provider";

export function AppSidebar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markTabViewed } = useNotificationsContext();
  const isDemoApp = pathname === '/demo/app' || pathname.startsWith('/demo/app/');
  const homeHref = isDemoApp ? '/demo/app' : '/';
  const appName = isDemoApp ? 'CASPO' : 'CASPO';

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-[100dvh] flex-col gap-2">
        <div className="flex h-14 shrink-0 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href={homeHref} className="flex items-center gap-2 font-semibold">
            <Logo className="h-6 w-6" />
            <span className="">{appName}</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            <AppSidebarNav 
              role={role || 'Member'}
              notifications={unread}
              onLinkClick={(key) => markTabViewed(key)}
            />
          </nav>
        </div>
      </div>
    </div>
  );
}

