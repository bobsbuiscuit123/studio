"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { useCurrentUserRole } from "@/lib/data-hooks";
import { useNotificationsContext } from "@/components/notifications-provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { allNavItems } from "@/components/app-sidebar-nav";
import { cn } from "@/lib/utils";

const assistantHref = "/assistant";
const visibleNavHrefs = ["/dashboard", "/calendar", "/messages"] as const;

export function AppMobileTabBar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markTabViewed } = useNotificationsContext();
  const isDemoApp = pathname === "/demo/app" || pathname.startsWith("/demo/app/");

  const allowedItems = allNavItems.filter(item => item.roles.includes(role || "Member"));
  const visibleItems = allowedItems.filter(item =>
    visibleNavHrefs.includes(item.href as (typeof visibleNavHrefs)[number])
  );
  const assistantItem = allowedItems.find(item => item.href === assistantHref);
  const overflowItems = allowedItems.filter(
    item => !visibleNavHrefs.includes(item.href as (typeof visibleNavHrefs)[number]) && item.href !== assistantHref
  );

  const buildHref = (href: string) =>
    isDemoApp ? (href === "/dashboard" ? "/demo/app" : `/demo/app${href}`) : href;

  const isItemActive = (href: string) => {
    const resolvedHref = buildHref(href);
    return isDemoApp
      ? href === "/dashboard"
        ? pathname === "/demo/app" || pathname === "/demo/app/dashboard"
        : pathname === resolvedHref || pathname.startsWith(`${resolvedHref}/`)
      : pathname === href || pathname.startsWith(`${href}/`);
  };

  const isMoreActive = overflowItems.some(item => isItemActive(item.href));

  if (visibleItems.length === 0 && !assistantItem) {
    return null;
  }

  return (
    <>
      <nav className="bottom-nav md:hidden">
        <div className="nav-inner mx-auto max-w-screen-md">
          <div className="left-tabs">
            {visibleItems.slice(0, 2).map(item => (
              <MobileTabLink
                key={item.href}
                href={buildHref(item.href)}
                icon={item.icon}
                label={item.label}
                active={isItemActive(item.href)}
                hasNotification={Boolean(item.notificationKey && unread[item.notificationKey as keyof typeof unread]) && !isItemActive(item.href)}
                onClick={() => item.notificationKey && markTabViewed(item.notificationKey)}
              />
            ))}
          </div>

          {assistantItem ? (
            <div className="ai-button-wrapper">
              <Link
                href={buildHref(assistantItem.href)}
                onClick={() => assistantItem.notificationKey && markTabViewed(assistantItem.notificationKey)}
                className="ai-button z-[1001]"
                aria-label={assistantItem.label}
              >
                <assistantItem.icon className="h-6 w-6 text-white" />
              </Link>
            </div>
          ) : null}

          <div className="right-tabs">
            {visibleItems.slice(2, 3).map(item => (
              <MobileTabLink
                key={item.href}
                href={buildHref(item.href)}
                icon={item.icon}
                label={item.label}
                active={isItemActive(item.href)}
                hasNotification={Boolean(item.notificationKey && unread[item.notificationKey as keyof typeof unread]) && !isItemActive(item.href)}
                onClick={() => item.notificationKey && markTabViewed(item.notificationKey)}
              />
            ))}

            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex min-h-11 w-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition-all active:scale-95",
                    isMoreActive ? "bg-primary/15 text-primary" : "text-muted-foreground"
                  )}
                >
                  <MoreHorizontal className="h-5 w-5" />
                  <span>More</span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-[2rem] px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
                <SheetHeader className="mb-4">
                  <SheetTitle>More</SheetTitle>
                </SheetHeader>
                <div className="grid grid-cols-2 gap-3">
                  {overflowItems.map(item => (
                    <Link
                      key={item.href}
                      href={buildHref(item.href)}
                      onClick={() => item.notificationKey && markTabViewed(item.notificationKey)}
                      className={cn(
                        "flex min-h-14 items-center gap-3 rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm font-medium transition-all active:scale-95",
                        isItemActive(item.href) ? "border-primary/40 bg-primary/10 text-primary" : "text-foreground"
                      )}
                    >
                      <div className="relative">
                        <item.icon className="h-5 w-5" />
                        {Boolean(item.notificationKey && unread[item.notificationKey as keyof typeof unread]) && !isItemActive(item.href) ? (
                          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                        ) : null}
                      </div>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </>
  );
}

function MobileTabLink({
  href,
  icon: Icon,
  label,
  active,
  hasNotification,
  onClick,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  hasNotification: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition-all active:scale-95",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground"
      )}
    >
      <div className="relative">
        <Icon className="h-5 w-5" />
        {hasNotification ? (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" />
        ) : null}
      </div>
      <span className="truncate">{label}</span>
    </Link>
  );
}
