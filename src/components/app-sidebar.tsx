
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./icons";
import { AppSidebarNav } from "./app-sidebar-nav";
import { useNotificationsContext } from "@/components/notifications-provider";

export function AppSidebar() {
  const pathname = usePathname();
  const { unread, markTabViewed, role } = useNotificationsContext();
  const isDemoApp = pathname === '/demo/app' || pathname.startsWith('/demo/app/');
  const homeHref = isDemoApp ? '/demo/app' : '/';
  const appName = isDemoApp ? 'CASPO' : 'CASPO';

  return (
    <div className="hidden h-full border-r md:block">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-[84px] shrink-0 items-center border-b bg-background px-4 py-4 lg:px-6">
          <Link href={homeHref} className="flex items-center gap-2 font-semibold">
            <Logo className="h-6 w-6" />
            <span className="">{appName}</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto bg-muted/40">
          <nav className="grid min-h-full content-start items-start px-2 py-2 text-sm font-medium lg:px-4">
            <AppSidebarNav 
              role={role || 'Member'}
              notifications={unread}
              onLinkClick={(key, href) => markTabViewed(key, href)}
            />
          </nav>
        </div>
      </div>
    </div>
  );
}

