"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useNotificationsContext } from "@/components/notifications-provider";
import { allNavItems } from "@/components/app-sidebar-nav";
import type { NotificationKey } from "@/lib/data-hooks";
import { syncSelectionCookies } from "@/lib/selection";
import { cn } from "@/lib/utils";

const assistantHref = "/assistant";
const assistantComingSoonLabel = "CASPO AI Agent";
const assistantComingSoonMessage =
  "CASPO AI copilot is on the way.";
const mobileNavOrder = [
  "/dashboard",
  "/announcements",
  "/messages",
  "/calendar",
  "/forms",
  "/email",
  "/attendance",
  "/points",
  "/gallery",
  "/members",
] as const;

type MobileNavItem = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  notificationKey?: NotificationKey | null;
};

export function AppMobileTabBar() {
  const pathname = usePathname();
  const { unread, markTabViewed, role } = useNotificationsContext();
  const isDemoApp = pathname === "/demo/app" || pathname.startsWith("/demo/app/");
  const isMessagesListRoute = pathname === "/messages" || pathname === "/demo/app/messages";
  const isMessageThreadRoute =
    pathname.startsWith("/messages/") || pathname.startsWith("/demo/app/messages/");
  const isMessagesRoute = isMessagesListRoute || isMessageThreadRoute;
  const [navPage, setNavPage] = useState(0);
  const [isInputActive, setIsInputActive] = useState(false);
  const [showAssistantBubble, setShowAssistantBubble] = useState(false);
  const [typedAssistantMessage, setTypedAssistantMessage] = useState("");

  const allowedItems = allNavItems.filter(item => item.roles.includes(role || "Member"));
  const orderedItems: MobileNavItem[] = mobileNavOrder
    .map(href => allowedItems.find(item => item.href === href))
    .filter((item): item is (typeof allowedItems)[number] => Boolean(item))
    .map(item => ({
      href: item.href,
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

  const navSets = useMemo(() => chunkItems(orderedItems, 4), [orderedItems]);
  const currentTabs = navSets[navPage] ?? [];
  const leftTabs = currentTabs.slice(0, 2);
  const rightTabs = currentTabs.slice(2, 4);

  useEffect(() => {
    if (navPage > navSets.length - 1) {
      setNavPage(Math.max(0, navSets.length - 1));
    }
  }, [navPage, navSets.length]);

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

  useEffect(() => {
    if (!showAssistantBubble) {
      setTypedAssistantMessage("");
      return;
    }

    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setTypedAssistantMessage(assistantComingSoonMessage.slice(0, index));
      if (index >= assistantComingSoonMessage.length) {
        window.clearInterval(interval);
      }
    }, 35);

    return () => window.clearInterval(interval);
  }, [showAssistantBubble]);

  if (isMessageThreadRoute || (navSets.length === 0 && !assistantItem) || (isMessagesListRoute && isInputActive)) {
    return null;
  }

  return (
    <nav className="bottom-nav md:hidden">
      <div className="nav-inner mx-auto max-w-screen-md">
        {navPage > 0 ? (
          <button type="button" onClick={() => setNavPage(current => Math.max(0, current - 1))} className="tab nav-arrow">
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {navPage === 0 ? (
          <button type="button" disabled className="tab nav-arrow nav-arrow-disabled" aria-label="Previous tabs unavailable">
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}

        <div className="nav-group">
          {leftTabs[0] ? (
            <IconTab
              item={leftTabs[0]}
              href={buildHref(leftTabs[0].href)}
              active={isItemActive(leftTabs[0].href)}
              unread={unread}
              onMarkViewed={markTabViewed}
            />
          ) : (
            <div className="tab opacity-0" aria-hidden="true" />
          )}
        </div>

        <div className="nav-group">
          {leftTabs[1] ? (
            <IconTab
              item={leftTabs[1]}
              href={buildHref(leftTabs[1].href)}
              active={isItemActive(leftTabs[1].href)}
              unread={unread}
              onMarkViewed={markTabViewed}
            />
          ) : (
            <div className="tab opacity-0" aria-hidden="true" />
          )}
        </div>

        {assistantItem ? (
          <div className="relative flex items-center justify-center">
            {showAssistantBubble ? (
              <div className="assistant-bubble" role="status" aria-live="polite">
                <div className="assistant-bubble-content">
                  <span className="assistant-bubble-label">{assistantComingSoonLabel}</span>
                  <p className="assistant-bubble-copy">
                    {typedAssistantMessage}
                    <span className="assistant-bubble-cursor" aria-hidden="true" />
                  </p>
                </div>
                <span className="assistant-bubble-tail" aria-hidden="true" />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setShowAssistantBubble(current => !current);
                if (assistantItem.notificationKey) {
                  markTabViewed(assistantItem.notificationKey, assistantItem.href);
                }
              }}
              className="ai-button z-[1001]"
              aria-label={`${assistantItem.label} coming soon`}
              aria-expanded={showAssistantBubble}
            >
              <assistantItem.icon className="h-6 w-6 text-white" />
            </button>
            {/*
            <Link
              href={buildHref(assistantItem.href)}
              onClick={() => assistantItem.notificationKey && markTabViewed(assistantItem.notificationKey, assistantItem.href)}
              className="ai-button z-[1001]"
              aria-label={assistantItem.label}
            >
              <assistantItem.icon className="h-6 w-6 text-white" />
            </Link>
            */}
          </div>
        ) : (
          <div className="tab opacity-0" aria-hidden="true" />
        )}

        <div className="nav-group">
          {rightTabs[0] ? (
            <IconTab
              item={rightTabs[0]}
              href={buildHref(rightTabs[0].href)}
              active={isItemActive(rightTabs[0].href)}
              unread={unread}
              onMarkViewed={markTabViewed}
            />
          ) : (
            <div className="tab opacity-0" aria-hidden="true" />
          )}
        </div>

        <div className="nav-group">
          {rightTabs[1] ? (
            <IconTab
              item={rightTabs[1]}
              href={buildHref(rightTabs[1].href)}
              active={isItemActive(rightTabs[1].href)}
              unread={unread}
              onMarkViewed={markTabViewed}
            />
          ) : (
            <div className="tab opacity-0" aria-hidden="true" />
          )}
        </div>

        {navPage < navSets.length - 1 ? (
          <button type="button" onClick={() => setNavPage(current => Math.min(navSets.length - 1, current + 1))} className="tab nav-arrow">
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : (
          <button type="button" disabled className="tab nav-arrow nav-arrow-disabled" aria-label="More tabs unavailable">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </nav>
  );
}

function IconTab({
  item,
  href,
  active,
  unread,
  onMarkViewed,
}: {
  item: MobileNavItem;
  href: string;
  active: boolean;
  unread: Record<string, boolean>;
  onMarkViewed: (key: NotificationKey | null, href?: string) => void;
}) {
  const Icon = item.icon;
  const hasNotification = Boolean(item.notificationKey && unread[item.notificationKey] && !active);

  return (
    <Link
      href={href}
      onClick={() => {
        syncSelectionCookies();
        onMarkViewed(item.notificationKey ?? null, item.href);
      }}
      className={cn(
        "tab transition-all duration-200 active:scale-95",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <div className="relative">
        <Icon className="h-6 w-6" />
        {hasNotification ? (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" />
        ) : null}
      </div>
    </Link>
  );
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
