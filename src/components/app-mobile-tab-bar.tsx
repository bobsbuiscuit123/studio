"use client";

import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useCurrentUserRole } from "@/lib/data-hooks";
import { useNotificationsContext } from "@/components/notifications-provider";
import { allNavItems } from "@/components/app-sidebar-nav";
import { cn } from "@/lib/utils";

const assistantHref = "/assistant";
const visibleNavHrefs = ["/dashboard", "/calendar", "/messages"] as const;

export function AppMobileTabBar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markTabViewed } = useNotificationsContext();
  const isDemoApp = pathname === "/demo/app" || pathname.startsWith("/demo/app/");
  const [page, setPage] = useState<0 | 1>(0);

  const allowedItems = allNavItems.filter(item => item.roles.includes(role || "Member"));
  const primaryItems = allowedItems.filter(item =>
    visibleNavHrefs.includes(item.href as (typeof visibleNavHrefs)[number])
  );
  const assistantItem = allowedItems.find(item => item.href === assistantHref);
  const overflowItems = allowedItems.filter(
    item => !visibleNavHrefs.includes(item.href as (typeof visibleNavHrefs)[number]) && item.href !== assistantHref
  );
  const secondaryItems = overflowItems.slice(0, 3);

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

  const currentPageItems = useMemo(() => {
    if (page === 0) {
      return {
        left: primaryItems.slice(0, 2),
        right: primaryItems.slice(2, 3),
      };
    }
    return {
      left: secondaryItems.slice(0, 1),
      right: secondaryItems.slice(1, 3),
    };
  }, [page, primaryItems, secondaryItems]);

  if (primaryItems.length === 0 && !assistantItem) {
    return null;
  }

  return (
    <>
      <nav className="bottom-nav md:hidden">
        <div className="nav-inner mx-auto max-w-screen-md">
          <div className="left-tabs">
            {page === 1 ? (
              <button
                type="button"
                onClick={() => setPage(0)}
                className="flex min-h-11 w-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium text-muted-foreground transition-all active:scale-95"
              >
                <ChevronLeft className="h-5 w-5" />
                <span>Back</span>
              </button>
            ) : null}
            {currentPageItems.left.map(item => (
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
            {currentPageItems.right.map(item => (
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
            {page === 0 && secondaryItems.length > 0 ? (
              <button
                type="button"
                onClick={() => setPage(1)}
                className="flex min-h-11 w-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium text-muted-foreground transition-all active:scale-95"
              >
                <ChevronRight className="h-5 w-5" />
                <span>More</span>
              </button>
            ) : null}
            {page === 1 && currentPageItems.right.length === 0 ? (
                <button
                  type="button"
                  disabled
                  className="flex min-h-11 w-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium text-transparent"
                >
                  <ChevronRight className="h-5 w-5" />
                  <span>More</span>
                </button>
            ) : null}
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
