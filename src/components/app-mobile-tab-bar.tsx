"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useCurrentUserRole } from "@/lib/data-hooks";
import { useNotificationsContext } from "@/components/notifications-provider";
import { allNavItems } from "@/components/app-sidebar-nav";
import type { NotificationKey } from "@/lib/data-hooks";
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

type NavPage = {
  left: NavSlot;
  leftCenter: NavSlot;
  rightCenter: NavSlot;
  right: NavSlot;
};

type MobileNavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  notificationKey?: NotificationKey | null;
};

type NavSlot =
  | {
      type: "item";
      href: string;
      label: string;
      icon: ComponentType<{ className?: string }>;
      notificationKey?: NotificationKey | null;
    }
  | {
      type: "control";
      direction: "back" | "next";
      label: string;
    }
  | {
      type: "empty";
    };

export function AppMobileTabBar() {
  const pathname = usePathname();
  const { role } = useCurrentUserRole();
  const { unread, markTabViewed } = useNotificationsContext();
  const isDemoApp = pathname === "/demo/app" || pathname.startsWith("/demo/app/");
  const isMessagesRoute =
    pathname === "/messages" ||
    pathname.startsWith("/messages/") ||
    pathname === "/demo/app/messages" ||
    pathname.startsWith("/demo/app/messages/");
  const [page, setPage] = useState(0);
  const [isInputActive, setIsInputActive] = useState(false);

  const allowedItems = allNavItems.filter(item => item.roles.includes(role || "Member"));
  const orderedItems: MobileNavItem[] = mobileNavOrder
    .map(href => allowedItems.find(item => item.href === href))
    .filter((item): item is (typeof allowedItems)[number] => Boolean(item))
    .map(item => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      notificationKey: item.notificationKey as NotificationKey | null | undefined,
    }));
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

  const pages = useMemo(() => buildPages(orderedItems), [orderedItems]);
  const currentPage = pages[page] ?? pages[0];

  useEffect(() => {
    if (page > pages.length - 1) {
      setPage(Math.max(0, pages.length - 1));
    }
  }, [page, pages.length]);

  useEffect(() => {
    if (!isMessagesRoute) {
      setIsInputActive(false);
      return;
    }

    const updateInputState = () => {
      const activeElement = document.activeElement as HTMLElement | null;
      const isEditable =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.isContentEditable === true;
      setIsInputActive(Boolean(isEditable));
    };

    updateInputState();
    document.addEventListener("focusin", updateInputState);
    document.addEventListener("focusout", updateInputState);

    return () => {
      document.removeEventListener("focusin", updateInputState);
      document.removeEventListener("focusout", updateInputState);
    };
  }, [isMessagesRoute]);

  if ((!currentPage && !assistantItem) || (isMessagesRoute && isInputActive)) {
    return null;
  }

  return (
    <nav className="bottom-nav md:hidden">
      <div className="nav-inner mx-auto max-w-screen-md">
        <MobileNavSlot
          slot={currentPage.left}
          buildHref={buildHref}
          isItemActive={isItemActive}
          unread={unread}
          onMarkViewed={markTabViewed}
          onBack={() => setPage(current => Math.max(0, current - 1))}
          onNext={() => setPage(current => Math.min(pages.length - 1, current + 1))}
        />
        <MobileNavSlot
          slot={currentPage.leftCenter}
          buildHref={buildHref}
          isItemActive={isItemActive}
          unread={unread}
          onMarkViewed={markTabViewed}
          onBack={() => setPage(current => Math.max(0, current - 1))}
          onNext={() => setPage(current => Math.min(pages.length - 1, current + 1))}
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
        ) : (
          <div className="tab opacity-0" aria-hidden="true" />
        )}

        <MobileNavSlot
          slot={currentPage.rightCenter}
          buildHref={buildHref}
          isItemActive={isItemActive}
          unread={unread}
          onMarkViewed={markTabViewed}
          onBack={() => setPage(current => Math.max(0, current - 1))}
          onNext={() => setPage(current => Math.min(pages.length - 1, current + 1))}
        />
        <MobileNavSlot
          slot={currentPage.right}
          buildHref={buildHref}
          isItemActive={isItemActive}
          unread={unread}
          onMarkViewed={markTabViewed}
          onBack={() => setPage(current => Math.max(0, current - 1))}
          onNext={() => setPage(current => Math.min(pages.length - 1, current + 1))}
        />
      </div>
    </nav>
  );
}

function MobileNavSlot({
  slot,
  buildHref,
  isItemActive,
  unread,
  onMarkViewed,
  onBack,
  onNext,
}: {
  slot: NavSlot;
  buildHref: (href: string) => string;
  isItemActive: (href: string) => boolean;
  unread: Record<string, boolean>;
  onMarkViewed: (key: NotificationKey) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  if (slot.type === "empty") {
    return <div className="tab opacity-0" aria-hidden="true" />;
  }

  if (slot.type === "control") {
    const Icon = slot.direction === "back" ? ChevronLeft : ChevronRight;
    return (
      <button type="button" onClick={slot.direction === "back" ? onBack : onNext} className="tab text-muted-foreground">
        <Icon className="h-6 w-6" />
        <span className="tab-label">{slot.label}</span>
      </button>
    );
  }

  const href = buildHref(slot.href);
  const active = isItemActive(slot.href);
  const hasNotification = Boolean(
    slot.notificationKey &&
      unread[slot.notificationKey] &&
      !active
  );
  const Icon = slot.icon;

  return (
    <Link
      href={href}
      onClick={() => slot.notificationKey && onMarkViewed(slot.notificationKey)}
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
      <span className="tab-label">{slot.label}</span>
    </Link>
  );
}

function buildPages(items: MobileNavItem[]): NavPage[] {
  const pages: NavPage[] = [];
  const firstSet = items.slice(0, 4);
  const remaining = items.slice(4);

  if (firstSet.length > 0) {
    pages.push({
      left: toItemSlot(firstSet[0]),
      leftCenter: toItemSlot(firstSet[1]),
      rightCenter: toItemSlot(firstSet[2]),
      right: remaining.length > 0 ? { type: "control", direction: "next", label: "More" } : toItemSlot(firstSet[3]),
    });
  }

  for (let index = 0; index < remaining.length; index += 3) {
    const chunk = remaining.slice(index, index + 3);
    const hasNext = index + 3 < remaining.length;
    pages.push({
      left: { type: "control", direction: "back", label: "Back" },
      leftCenter: toItemSlot(chunk[0]),
      rightCenter: toItemSlot(chunk[1]),
      right: hasNext ? { type: "control", direction: "next", label: "More" } : toItemSlot(chunk[2]),
    });
  }

  return pages.length > 0
    ? pages
    : [
        {
          left: { type: "empty" },
          leftCenter: { type: "empty" },
          rightCenter: { type: "empty" },
          right: { type: "empty" },
        },
      ];
}

function toItemSlot(item: MobileNavItem | undefined): NavSlot {
  if (!item) {
    return { type: "empty" };
  }

  return {
    type: "item",
    href: item.href,
    label: item.label,
    icon: item.icon,
    notificationKey: item.notificationKey,
  };
}
