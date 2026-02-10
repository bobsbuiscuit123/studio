
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./icons";
import { AppSidebarNav } from "./app-sidebar-nav";
import { useCurrentUserRole, useNotifications } from "@/lib/data-hooks";

export function AppSidebar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markAllAsRead } = useNotifications();
  const isDemoApp = pathname === '/demo/app' || pathname.startsWith('/demo/app/');
  const homeHref = isDemoApp ? '/demo/app' : '/';
  const appName = isDemoApp ? 'CASPO' : 'ClubHub AI';

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
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
              onLinkClick={(key) => markAllAsRead(key)}
            />
          </nav>
        </div>
      </div>
    </div>
  );
}
