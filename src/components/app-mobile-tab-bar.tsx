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
          {page === 1 ? (
            <button
              type="button"
              onClick={() => setPage(0)}
              className="tab text-muted-foreground"
            >
              <ChevronLeft className="h-6 w-6" />
              <span className="text-xs">Back</span>
            </button>
          ) : (
            <MobileTabLink
              href={buildHref(currentPageItems.left[0]?.href ?? "")}
              icon={currentPageItems.left[0]?.icon}
              label={currentPageItems.left[0]?.label ?? ""}
              active={Boolean(currentPageItems.left[0] && isItemActive(currentPageItems.left[0].href))}
              hasNotification={Boolean(
                currentPageItems.left[0]?.notificationKey &&
                  unread[currentPageItems.left[0].notificationKey as keyof typeof unread] &&
                  !isItemActive(currentPageItems.left[0].href)
              )}
              onClick={() => currentPageItems.left[0]?.notificationKey && markTabViewed(currentPageItems.left[0].notificationKey)}
            />
          )}

          <MobileTabLink
            href={buildHref(currentPageItems.left[1]?.href ?? "")}
            icon={currentPageItems.left[1]?.icon}
            label={currentPageItems.left[1]?.label ?? ""}
            active={Boolean(currentPageItems.left[1] && isItemActive(currentPageItems.left[1].href))}
            hasNotification={Boolean(
              currentPageItems.left[1]?.notificationKey &&
                unread[currentPageItems.left[1].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPageItems.left[1].href)
            )}
            onClick={() => currentPageItems.left[1]?.notificationKey && markTabViewed(currentPageItems.left[1].notificationKey)}
          />

          {assistantItem ? (
            <Link
              href={buildHref(assistantItem.href)}
              onClick={() => assistantItem.notificationKey && markTabViewed(assistantItem.notificationKey)}
              className="ai-button z-[1001]"
              aria-label={assistantItem.label}
            >
              <assistantItem.icon className="h-6 w-6 text-white" />
            </Link>
          ) : null}

          <MobileTabLink
            href={buildHref(currentPageItems.right[0]?.href ?? "")}
            icon={currentPageItems.right[0]?.icon}
            label={currentPageItems.right[0]?.label ?? ""}
            active={Boolean(currentPageItems.right[0] && isItemActive(currentPageItems.right[0].href))}
            hasNotification={Boolean(
              currentPageItems.right[0]?.notificationKey &&
                unread[currentPageItems.right[0].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPageItems.right[0].href)
            )}
            onClick={() => currentPageItems.right[0]?.notificationKey && markTabViewed(currentPageItems.right[0].notificationKey)}
          />

          {page === 0 && secondaryItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setPage(1)}
              className="tab text-muted-foreground"
            >
              <ChevronRight className="h-6 w-6" />
              <span className="text-xs">More</span>
            </button>
          ) : (
            <MobileTabLink
              href={buildHref(currentPageItems.right[1]?.href ?? "")}
              icon={currentPageItems.right[1]?.icon}
              label={currentPageItems.right[1]?.label ?? ""}
              active={Boolean(currentPageItems.right[1] && isItemActive(currentPageItems.right[1].href))}
              hasNotification={Boolean(
                currentPageItems.right[1]?.notificationKey &&
                  unread[currentPageItems.right[1].notificationKey as keyof typeof unread] &&
                  !isItemActive(currentPageItems.right[1].href)
              )}
              onClick={() => currentPageItems.right[1]?.notificationKey && markTabViewed(currentPageItems.right[1].notificationKey)}
            />
          )}
        </div>
      </nav>
    </>
  );
}

function MobileTabLink({
  href,
  icon,
  label,
  active,
  hasNotification,
  onClick,
}: {
  href: string;
  icon?: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  hasNotification: boolean;
  onClick?: () => void;
}) {
  if (!href || !icon || !label) {
    return <div className="tab opacity-0" aria-hidden="true" />;
  }

  const Icon = icon;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "tab rounded-2xl text-xs font-medium transition-all active:scale-95",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground"
      )}
    >
      <div className="relative">
        <Icon className="h-6 w-6" />
        {hasNotification ? (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" />
        ) : null}
      </div>
      <span className="truncate">{label}</span>
    </Link>
  );
}
