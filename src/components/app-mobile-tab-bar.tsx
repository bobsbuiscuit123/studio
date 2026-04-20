"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AIChatModal } from "@/components/assistant/ai-chat-modal";
import { useAssistantChat } from "@/components/assistant/use-assistant-chat";
import { useNotificationsContext } from "@/components/notifications-provider";
import { allNavItems } from "@/components/app-sidebar-nav";
import type { NotificationKey } from "@/lib/data-hooks";
import { syncSelectionCookies } from "@/lib/selection";
import { cn } from "@/lib/utils";

const assistantHref = "/assistant";
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
  const {
    assistantButtonRef,
    assistantInput,
    assistantMessages,
    handleAssistantRetry,
    handleAssistantSend,
    isAssistantOpen,
    isAssistantSending,
    setAssistantInput,
    setIsAssistantOpen,
  } = useAssistantChat();

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
      const isAssistantInput = Boolean(
        activeElement?.closest('[data-ai-assistant-popup="true"]')
      );
      const isEditable =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.isContentEditable === true;
      setIsInputActive(Boolean(isEditable) && !isAssistantInput);
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
    if (isMessageThreadRoute || (isMessagesListRoute && isInputActive)) {
      setIsAssistantOpen(false);
    }
  }, [isInputActive, isMessageThreadRoute, isMessagesListRoute]);

  if (isMessageThreadRoute || (navSets.length === 0 && !assistantItem) || (isMessagesListRoute && isInputActive)) {
    return null;
  }

  return (
    <>
      <AIChatModal
        open={isAssistantOpen}
        onOpenChange={setIsAssistantOpen}
        messages={assistantMessages}
        input={assistantInput}
        onInputChange={setAssistantInput}
        onSend={handleAssistantSend}
        onRetry={handleAssistantRetry}
        isSending={isAssistantSending}
        anchorRef={assistantButtonRef}
      />

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
            <button
              ref={assistantButtonRef}
              type="button"
              onClick={() => {
                setIsAssistantOpen(current => !current);
                if (assistantItem.notificationKey) {
                  markTabViewed(assistantItem.notificationKey, assistantItem.href);
                }
              }}
              className={cn(
                "ai-button z-[1001] transition-transform duration-200 hover:scale-[1.03]",
                isAssistantOpen && "ring-4 ring-emerald-200/35 ring-offset-2 ring-offset-background"
              )}
              aria-label={assistantItem.label}
              aria-expanded={isAssistantOpen}
            >
              <assistantItem.icon className="h-6 w-6 text-white" />
            </button>
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
    </>
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
