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
const visibleNavHrefs = ["/dashboard", "/calendar", "/messages"] as const;

export function AppMobileTabBar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markTabViewed } = useNotificationsContext();
  const isDemoApp = pathname === "/demo/app" || pathname.startsWith("/demo/app/");
  const [page, setPage] = useState(0);

  const allowedItems = allNavItems.filter(item => item.roles.includes(role || "Member"));
  const orderedItems = [
    ...allowedItems.filter(item =>
      visibleNavHrefs.includes(item.href as (typeof visibleNavHrefs)[number]) && item.href !== assistantHref
    ),
    ...allowedItems.filter(
      item =>
        !visibleNavHrefs.includes(item.href as (typeof visibleNavHrefs)[number]) &&
        item.href !== assistantHref
    ),
  ];
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
  const currentPage = pages[page] ?? { left: [], right: [], hasPrev: false, hasNext: false };

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
            <MobileTabLink
              href={buildHref(currentPage.left[0]?.href ?? "")}
              icon={currentPage.left[0]?.icon}
              label={currentPage.left[0]?.label ?? ""}
              active={Boolean(currentPage.left[0] && isItemActive(currentPage.left[0].href))}
              hasNotification={Boolean(
                currentPage.left[0]?.notificationKey &&
                  unread[currentPage.left[0].notificationKey as keyof typeof unread] &&
                  !isItemActive(currentPage.left[0].href)
              )}
              onClick={() => currentPage.left[0]?.notificationKey && markTabViewed(currentPage.left[0].notificationKey)}
            />
          )}

          <MobileTabLink
            href={buildHref(currentPage.left[1]?.href ?? "")}
            icon={currentPage.left[1]?.icon}
            label={currentPage.left[1]?.label ?? ""}
            active={Boolean(currentPage.left[1] && isItemActive(currentPage.left[1].href))}
            hasNotification={Boolean(
              currentPage.left[1]?.notificationKey &&
                unread[currentPage.left[1].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPage.left[1].href)
            )}
            onClick={() => currentPage.left[1]?.notificationKey && markTabViewed(currentPage.left[1].notificationKey)}
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
            href={buildHref(currentPage.right[0]?.href ?? "")}
            icon={currentPage.right[0]?.icon}
            label={currentPage.right[0]?.label ?? ""}
            active={Boolean(currentPage.right[0] && isItemActive(currentPage.right[0].href))}
            hasNotification={Boolean(
              currentPage.right[0]?.notificationKey &&
                unread[currentPage.right[0].notificationKey as keyof typeof unread] &&
                !isItemActive(currentPage.right[0].href)
            )}
            onClick={() => currentPage.right[0]?.notificationKey && markTabViewed(currentPage.right[0].notificationKey)}
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
            <MobileTabLink
              href={buildHref(currentPage.right[1]?.href ?? "")}
              icon={currentPage.right[1]?.icon}
              label={currentPage.right[1]?.label ?? ""}
              active={Boolean(currentPage.right[1] && isItemActive(currentPage.right[1].href))}
              hasNotification={Boolean(
                currentPage.right[1]?.notificationKey &&
                  unread[currentPage.right[1].notificationKey as keyof typeof unread] &&
                  !isItemActive(currentPage.right[1].href)
              )}
              onClick={() => currentPage.right[1]?.notificationKey && markTabViewed(currentPage.right[1].notificationKey)}
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

function paginateTabs<T>(items: T[]) {
  const pages: Array<{ left: T[]; right: T[]; hasPrev: boolean; hasNext: boolean }> = [];
  let index = 0;
  let pageIndex = 0;

  while (index < items.length) {
    const hasPrev = pageIndex > 0;
    const remaining = items.length - index;
    const capacity = 4 - (hasPrev ? 1 : 0) - (remaining > 3 ? 1 : 0);
    const safeCapacity = Math.max(1, capacity);
    const pageItems = items.slice(index, index + safeCapacity);
    index += safeCapacity;
    const hasNext = index < items.length;
    const slots = hasPrev
      ? [...pageItems.slice(0, 1), ...pageItems.slice(1, 2), ...pageItems.slice(2)]
      : [...pageItems];

    pages.push({
      left: slots.slice(0, 2),
      right: slots.slice(2, 4),
      hasPrev,
      hasNext,
    });
    pageIndex += 1;
  }

  return pages;
}
