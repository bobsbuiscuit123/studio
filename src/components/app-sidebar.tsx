
"use client";

import Link from "next/link";
import { Logo } from "./icons";
import { AppSidebarNav } from "./app-sidebar-nav";
import { useCurrentUserRole, useNotifications } from "@/lib/data-hooks";

export function AppSidebar() {
  const { role } = useCurrentUserRole();
  const { unread, markAllAsRead } = useNotifications();

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 shrink-0 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo className="h-6 w-6" />
            <span className="">ClubHub AI</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            <AppSidebarNav 
              role={role || ''} 
              notifications={unread}
              onLinkClick={(key) => markAllAsRead(key)}
            />
          </nav>
        </div>
      </div>
    </div>
  );
}
