"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useCurrentUserRole } from "@/lib/data-hooks";
import { useNotificationsContext } from "@/components/notifications-provider";
import { allNavItems } from "@/components/app-sidebar-nav";
import { cn } from "@/lib/utils";

const assistantHref = "/assistant";
const mobileNavOrder = [
  "/dashboard",
  "/announcements",
  "/messages",
  "/calendar",
  "/forms",
  "/attendance",
  "/points",
  "/gallery",
  "/members",
  "/email",
  "/finances",
] as const;

export function AppMobileTabBar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markTabViewed } = useNotificationsContext();
  const isDemoApp = pathname === "/demo/app" || pathname.startsWith("/demo/app/");
  const [page, setPage] = useState(0);

  const allowedItems = allNavItems.filter(item => item.roles.includes(role || "Member"));
  const orderedItems = mobileNavOrder
    .map(href => allowedItems.find(item => item.href === href))
    .filter((item): item is (typeof allowedItems)[number] => Boolean(item));
  const assistantItem = allowedItems.find(item => item.href === assistantHref);

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

  const pages = useMemo(() => paginateTabs(orderedItems), [orderedItems]);
  const currentPage = pages[page] ?? { items: [], hasPrev: false, hasNext: false };

  useEffect(() => {
    if (page > pages.length - 1) {
      setPage(Math.max(0, pages.length - 1));
    }
  }, [page, pages.length]);

  if (orderedItems.length === 0 && !assistantItem) {
    return null;
  }

  return (
    <>
      <nav className="bottom-nav md:hidden">
        <div className="nav-inner mx-auto max-w-screen-md">
          {currentPage.hasPrev ? (
            <button
              type="button"
              onClick={() => setPage(current => Math.max(0, current - 1))}
              className="tab text-muted-foreground"
            >
              <ChevronLeft className="h-6 w-6" />
              <span className="text-xs">Back</span>
            </button>
          ) : (
            <div className="tab opacity-0" aria-hidden="true" />
          )}

          <MobileTabLink
            href={buildHref(currentPage.items[0]?.href ?? "")}
            icon={currentPage.items[0]?.icon}
            label={currentPage.items[0]?.label ?? ""}
            active={Boolean(currentPage.items[0] && isItemActive(currentPage.items[0].href))}
            hasNotification={Boolean(
              currentPage.items[0]?.notificationKey &&
                unread[currentPage.items[0].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPage.items[0].href)
            )}
            onClick={() => currentPage.items[0]?.notificationKey && markTabViewed(currentPage.items[0].notificationKey)}
          />

          <MobileTabLink
            href={buildHref(currentPage.items[1]?.href ?? "")}
            icon={currentPage.items[1]?.icon}
            label={currentPage.items[1]?.label ?? ""}
            active={Boolean(currentPage.items[1] && isItemActive(currentPage.items[1].href))}
            hasNotification={Boolean(
              currentPage.items[1]?.notificationKey &&
                unread[currentPage.items[1].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPage.items[1].href)
            )}
            onClick={() => currentPage.items[1]?.notificationKey && markTabViewed(currentPage.items[1].notificationKey)}
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
            href={buildHref(currentPage.items[2]?.href ?? "")}
            icon={currentPage.items[2]?.icon}
            label={currentPage.items[2]?.label ?? ""}
            active={Boolean(currentPage.items[2] && isItemActive(currentPage.items[2].href))}
            hasNotification={Boolean(
              currentPage.items[2]?.notificationKey &&
                unread[currentPage.items[2].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPage.items[2].href)
            )}
            onClick={() => currentPage.items[2]?.notificationKey && markTabViewed(currentPage.items[2].notificationKey)}
          />

          <MobileTabLink
            href={buildHref(currentPage.items[3]?.href ?? "")}
            icon={currentPage.items[3]?.icon}
            label={currentPage.items[3]?.label ?? ""}
            active={Boolean(currentPage.items[3] && isItemActive(currentPage.items[3].href))}
            hasNotification={Boolean(
              currentPage.items[3]?.notificationKey &&
                unread[currentPage.items[3].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPage.items[3].href)
            )}
            onClick={() => currentPage.items[3]?.notificationKey && markTabViewed(currentPage.items[3].notificationKey)}
          />

          {currentPage.hasNext ? (
            <button
              type="button"
              onClick={() => setPage(current => Math.min(pages.length - 1, current + 1))}
              className="tab text-muted-foreground"
            >
              <ChevronRight className="h-6 w-6" />
              <span className="text-xs">More</span>
            </button>
          ) : (
            <div className="tab opacity-0" aria-hidden="true" />
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

function paginateTabs<T>(items: T[]) {
  const pages: Array<{ items: T[]; hasPrev: boolean; hasNext: boolean }> = [];
  let index = 0;

  while (index < items.length) {
    const pageItems = items.slice(index, index + 4);
    index += 4;
    const hasNext = index < items.length;
    pages.push({
      items: pageItems,
      hasPrev: pages.length > 0,
      hasNext,
    });
  }

  return pages;
}
