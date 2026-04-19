"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Bot, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";

import type { AiChatClientMessage } from "@/lib/ai-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AIChatModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: AiChatClientMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetry: (retryInput: string) => void;
  isSending: boolean;
  anchorRef: RefObject<HTMLElement | null>;
};

type PopupLayout = {
  left: number;
  width: number;
  bottom: number;
  maxHeight: number;
  tailOffset: number;
};

const POPUP_HORIZONTAL_MARGIN = 10;
const POPUP_MAX_WIDTH = 360;
const POPUP_MAX_HEIGHT = 520;
const POPUP_HEIGHT_RATIO = 0.56;
const POPUP_MIN_BOTTOM = 92;
const POPUP_MIN_TAIL_OFFSET = 34;
const POPUP_GAP = 18;
const EMPTY_STATE_TEXT = "Ask about your group or draft something quick.";

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getViewportHeight = () => window.visualViewport?.height ?? window.innerHeight;

const getKeyboardInset = () => Math.max(0, window.innerHeight - getViewportHeight());

export function AIChatModal({
  open,
  onOpenChange,
  messages,
  input,
  onInputChange,
  onSend,
  onRetry,
  isSending,
  anchorRef,
}: AIChatModalProps) {
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<PopupLayout | null>(null);
  const [typedCount, setTypedCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setTypedCount(0);
      return;
    }
    if (messages.length > 0) {
      setTypedCount(EMPTY_STATE_TEXT.length);
      return;
    }

    setTypedCount(0);
    const intervalId = window.setInterval(() => {
      setTypedCount(current => {
        if (current >= EMPTY_STATE_TEXT.length) {
          window.clearInterval(intervalId);
          return current;
        }
        return current + 1;
      });
    }, 24);

    return () => window.clearInterval(intervalId);
  }, [messages.length, open]);

  useEffect(() => {
    if (!open) return;

    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [messages, open]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;

    element.style.height = "0px";
    const nextHeight = Math.min(element.scrollHeight, 132);
    element.style.height = `${Math.max(nextHeight, 50)}px`;
  }, [input, open]);

  useEffect(() => {
    if (!open) return;

    const updateLayout = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        setLayout(null);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = getViewportHeight();
      const keyboardInset = getKeyboardInset();
      const width = Math.min(
        POPUP_MAX_WIDTH,
        Math.max(280, viewportWidth - POPUP_HORIZONTAL_MARGIN * 2)
      );
      const centeredLeft = rect.left + rect.width / 2 - width / 2;
      const left = clamp(
        centeredLeft,
        POPUP_HORIZONTAL_MARGIN,
        viewportWidth - POPUP_HORIZONTAL_MARGIN - width
      );
      const anchorCenter = rect.left + rect.width / 2;
      const tailOffset = clamp(
        anchorCenter - left,
        POPUP_MIN_TAIL_OFFSET,
        width - POPUP_MIN_TAIL_OFFSET
      );
      const anchoredBottom = window.innerHeight - rect.top + POPUP_GAP;
      const bottom = Math.max(POPUP_MIN_BOTTOM, anchoredBottom, keyboardInset + 12);
      const maxHeight = Math.min(
        POPUP_MAX_HEIGHT,
        Math.max(320, viewportHeight * POPUP_HEIGHT_RATIO)
      );

      setLayout({
        left,
        width,
        bottom,
        maxHeight,
        tailOffset,
      });
    };

    const frameId = window.requestAnimationFrame(updateLayout);
    window.addEventListener("resize", updateLayout);
    window.addEventListener("orientationchange", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    window.visualViewport?.addEventListener("resize", updateLayout);
    window.visualViewport?.addEventListener("scroll", updateLayout);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("orientationchange", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
      window.visualViewport?.removeEventListener("resize", updateLayout);
      window.visualViewport?.removeEventListener("scroll", updateLayout);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  const emptyStateText = useMemo(
    () => EMPTY_STATE_TEXT.slice(0, typedCount),
    [typedCount]
  );

  if (!mounted || !open || !layout) {
    return null;
  }

  const popupHeight = Math.min(layout.maxHeight, 420);

  return createPortal(
    <>
      <button
        type="button"
        className="assistant-popup-backdrop"
        onClick={() => onOpenChange(false)}
        aria-label="Close assistant"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label="CASPO AI"
        className="assistant-popup-shell"
        data-ai-assistant-popup="true"
        style={{
          left: `${layout.left}px`,
          width: `${layout.width}px`,
          bottom: `${layout.bottom}px`,
          height: `${popupHeight}px`,
          maxHeight: `${layout.maxHeight}px`,
        }}
        onClick={event => event.stopPropagation()}
      >
        <div className="assistant-popup-card">
          <header className="assistant-popup-header">
            <div className="flex min-w-0 items-center gap-3">
              <div className="assistant-popup-badge">
                <Sparkles className="h-3.5 w-3.5" />
                <span>CASPO AI</span>
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  Group Assistant
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  Ask a question or draft something quick.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="assistant-popup-close"
              aria-label="Close assistant"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="assistant-popup-messages">
            {messages.length === 0 ? (
              <div className="assistant-popup-empty">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
                  Start Here
                </p>
                <p className="mt-3 text-sm leading-6 text-foreground/92">
                  {emptyStateText}
                  <span className="assistant-popup-cursor" />
                </p>
              </div>
            ) : null}

            {messages.map(message => {
              if (message.status === "error") {
                return (
                  <div
                    key={message.id}
                    className="assistant-message-row justify-start"
                  >
                    <div className="assistant-message assistant-message-error">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="assistant-message-label text-rose-100/85">
                            Assistant Error
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-rose-50/95">
                            {message.content}
                          </p>
                        </div>
                        {message.retryInput ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onRetry(message.retryInput!)}
                            className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5 text-foreground hover:bg-white/10"
                          >
                            <RotateCcw className="h-4 w-4" />
                            <span className="sr-only">Retry assistant request</span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              }

              const isUser = message.role === "user";
              const isPending = message.status === "pending";

              return (
                <div
                  key={message.id}
                  className={cn(
                    "assistant-message-row",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "assistant-message",
                      isUser
                        ? "assistant-message-user"
                        : "assistant-message-assistant"
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {isUser ? (
                        <span className="text-emerald-950/70">You</span>
                      ) : (
                        <>
                          <Bot className="h-3.5 w-3.5 text-emerald-300" />
                          <span className="assistant-message-label">Assistant</span>
                        </>
                      )}
                    </div>

                    {isPending ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="assistant-thinking-dot" />
                          <span className="assistant-thinking-dot" />
                          <span className="assistant-thinking-dot" />
                        </div>
                        <span className="text-sm text-muted-foreground">
                          Thinking through that…
                        </span>
                      </div>
                    ) : (
                      <p
                        className={cn(
                          "whitespace-pre-wrap text-sm leading-6",
                          isUser ? "text-emerald-950" : "text-foreground/92"
                        )}
                      >
                        {message.content}
                      </p>
                    )}

                    <p
                      className={cn(
                        "mt-2 text-[11px]",
                        isUser
                          ? "text-emerald-950/65"
                          : "text-muted-foreground/80"
                      )}
                    >
                      {formatTimestamp(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>

          <div className="assistant-popup-composer">
            <div className="assistant-popup-composer-shell">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={inputRef}
                  value={input}
                  data-ai-assistant-popup="true"
                  onChange={event => onInputChange(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      onSend();
                    }
                  }}
                  placeholder="Ask CASPO AI anything about your group…"
                  className="max-h-32 min-h-[50px] resize-none border-0 bg-transparent px-3 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground/75 focus-visible:ring-0 focus-visible:ring-offset-0"
                  autoComplete="off"
                  disabled={isSending}
                />

                <Button
                  type="button"
                  onClick={onSend}
                  disabled={isSending || !input.trim()}
                  className="assistant-popup-send"
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span className="sr-only">Send message</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div
          className="assistant-popup-tail"
          style={{ left: `${layout.tailOffset}px` }}
          aria-hidden="true"
        />
      </section>
    </>,
    document.body
  );
}
