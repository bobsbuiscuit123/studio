"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useCurrentUserRole } from "@/lib/data-hooks";
import { useNotificationsContext } from "@/components/notifications-provider";
import { allNavItems, mobilePrimaryNavItems } from "@/components/app-sidebar-nav";

export function AppMobileTabBar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markTabViewed } = useNotificationsContext();
  const isDemoApp = pathname === "/demo/app" || pathname.startsWith("/demo/app/");

  const navItems = allNavItems.filter(
    item =>
      mobilePrimaryNavItems.includes(item.href as (typeof mobilePrimaryNavItems)[number]) &&
      item.roles.includes(role || "Member")
  );

  if (navItems.length === 0) {
    return null;
  }

  return (
    <nav className="sticky bottom-0 z-40 border-t border-border/80 bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-screen-md grid-cols-5 gap-1">
        {navItems.map(item => {
          const demoHref =
            item.href === "/dashboard" ? "/demo/app" : `/demo/app${item.href}`;
          const href = isDemoApp ? demoHref : item.href;
          const isActive = isDemoApp
            ? item.href === "/dashboard"
              ? pathname === "/demo/app" || pathname === "/demo/app/dashboard"
              : pathname === href || pathname.startsWith(`${href}/`)
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const hasNotification =
            Boolean(item.notificationKey && unread[item.notificationKey as keyof typeof unread]) &&
            !isActive;

          return (
            <Link
              key={item.href}
              href={href}
              onClick={() => item.notificationKey && markTabViewed(item.notificationKey)}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition-transform transition-colors active:scale-95",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <div className="relative">
                <item.icon className="h-5 w-5" />
                {hasNotification ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                ) : null}
              </div>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
