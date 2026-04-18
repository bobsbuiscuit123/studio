"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AIChatModal } from "@/components/assistant/ai-chat-modal";
import { useNotificationsContext } from "@/components/notifications-provider";
import { allNavItems } from "@/components/app-sidebar-nav";
import {
  AI_CHAT_HISTORY_LIMIT,
  aiChatErrorResponseSchema,
  aiChatResponseSchema,
  type AiChatClientMessage,
  type AiChatFailureStage,
  type AiChatHistoryMessage,
} from "@/lib/ai-chat";
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

const stageLabel = (stage?: AiChatFailureStage) => {
  switch (stage) {
    case "planner":
      return "planner step";
    case "group_data_fetch":
      return "group data fetch";
    case "responder":
      return "answer generation";
    case "context":
      return "group context lookup";
    case "membership":
      return "group access check";
    case "quota":
      return "AI quota check";
    case "request_validation":
      return "request validation";
    default:
      return null;
  }
};

const formatAssistantErrorMessage = (payload: unknown) => {
  const parsed = aiChatErrorResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return "Assistant unavailable right now.";
  }

  const { message, requestId, stage, detail } = parsed.data;
  const stageText = stageLabel(stage);
  const extras = [stageText, requestId ? `trace ${requestId.slice(0, 8)}` : null].filter(Boolean);
  const detailText = typeof detail === "string" && detail.trim() ? `\n${detail.trim()}` : "";

  return `${extras.length ? `${message} (${extras.join(" • ")})` : message}${detailText}`;
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
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AiChatClientMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [isAssistantSending, setIsAssistantSending] = useState(false);

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
    if (isMessageThreadRoute || (isMessagesListRoute && isInputActive)) {
      setIsAssistantOpen(false);
    }
  }, [isInputActive, isMessageThreadRoute, isMessagesListRoute]);

  if (isMessageThreadRoute || (navSets.length === 0 && !assistantItem) || (isMessagesListRoute && isInputActive)) {
    return null;
  }

  const createClientMessage = (
    role: AiChatClientMessage["role"],
    content: string,
    options?: Pick<AiChatClientMessage, "status" | "retryInput">
  ): AiChatClientMessage => ({
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...options,
  });

  const buildHistoryPayload = (messages: AiChatClientMessage[]): AiChatHistoryMessage[] =>
    messages
      .filter(
        (message): message is AiChatClientMessage & { role: "user" | "assistant" } =>
          (message.role === "user" || message.role === "assistant") && !message.status
      )
      .slice(-AI_CHAT_HISTORY_LIMIT)
      .map(message => ({
        role: message.role,
        content: message.content,
      }));

  const sendAssistantMessage = async (rawMessage: string, { appendUserMessage }: { appendUserMessage: boolean }) => {
    const message = rawMessage.trim();
    if (!message || isAssistantSending) {
      return;
    }

    const nextUserMessage = createClientMessage("user", message);
    const pendingMessage = createClientMessage("assistant", "", { status: "pending" });
    const nextMessages = (() => {
      const baseMessages = assistantMessages.filter(
        item => item.status !== "pending" && !(item.status === "error" && item.retryInput === message)
      );
      return appendUserMessage
        ? [...baseMessages, nextUserMessage, pendingMessage]
        : [...baseMessages, pendingMessage];
    })();

    setAssistantMessages(nextMessages);
    setAssistantInput("");
    setIsAssistantSending(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          history: buildHistoryPayload(nextMessages.filter(item => item.id !== pendingMessage.id)),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload) {
          console.error("[ai-chat] request failed", payload);
        }
        throw new Error(
          payload ? formatAssistantErrorMessage(payload) : "Assistant unavailable right now."
        );
      }

      const parsedPayload = aiChatResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        throw new Error("Assistant returned an invalid response.");
      }

      const assistantReply = createClientMessage("assistant", parsedPayload.data.reply);
      setAssistantMessages(currentMessages =>
        currentMessages.map(currentMessage =>
          currentMessage.id === pendingMessage.id ? assistantReply : currentMessage
        )
      );
    } catch (error) {
      const errorMessage = createClientMessage(
        "system",
        error instanceof Error ? error.message : "Assistant unavailable right now.",
        {
          status: "error",
          retryInput: message,
        }
      );
      setAssistantMessages(currentMessages =>
        currentMessages.map(currentMessage =>
          currentMessage.id === pendingMessage.id ? errorMessage : currentMessage
        )
      );
    } finally {
      setIsAssistantSending(false);
    }
  };

  const handleAssistantSend = () => {
    void sendAssistantMessage(assistantInput, { appendUserMessage: true });
  };

  const handleAssistantRetry = (retryInput: string) => {
    void sendAssistantMessage(retryInput, { appendUserMessage: false });
  };

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
