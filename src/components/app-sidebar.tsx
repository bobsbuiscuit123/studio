"use client";

import Link from "next/link";
import { Logo } from "./icons";
import { AppSidebarNav } from "./app-sidebar-nav";

export function AppSidebar() {
  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo className="h-6 w-6" />
            <span className="">ClubHub</span>
          </Link>
        </div>
        <div className="flex-1">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            <AppSidebarNav />
          </nav>
        </div>
      </div>
    </div>
  );
}
