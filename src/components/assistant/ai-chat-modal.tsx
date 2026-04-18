"use client";

import { useEffect, useRef } from 'react';
import { Bot, Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';

import type { AiChatClientMessage } from '@/lib/ai-chat';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type AIChatModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: AiChatClientMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onRetry: (retryInput: string) => void;
  isSending: boolean;
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
};

export function AIChatModal({
  open,
  onOpenChange,
  messages,
  input,
  onInputChange,
  onSend,
  onRetry,
  isSending,
}: AIChatModalProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [messages, open]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;

    element.style.height = '0px';
    const nextHeight = Math.min(element.scrollHeight, 144);
    element.style.height = `${Math.max(nextHeight, 52)}px`;
  }, [input, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={event => event.preventDefault()}
        className={cn(
          'ai-chat-sheet h-[min(78dvh,720px)] rounded-t-[28px] border-white/15 px-0 pt-0',
          '[&>button]:right-5 [&>button]:top-5 [&>button]:rounded-full [&>button]:border [&>button]:border-white/15 [&>button]:bg-white/10 [&>button]:text-white [&>button]:backdrop-blur-xl'
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>CASPO AI</SheetTitle>
          <SheetDescription>Ask about members, events, announcements, and messages.</SheetDescription>
        </SheetHeader>

        <div className="ai-chat-grid flex h-full min-h-0 flex-col text-white">
          <div className="relative overflow-hidden border-b border-white/10 px-5 pb-5 pt-4">
            <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/20" />

            <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.28),transparent_62%)]" />
            <div className="absolute right-6 top-4">
              <div className="ai-chat-orb flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-[0_12px_30px_rgba(34,197,94,0.24)] backdrop-blur-2xl">
                <Sparkles className="h-5 w-5 text-emerald-200" />
              </div>
            </div>

            <div className="relative pr-16">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100/90">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(134,239,172,0.85)]" />
                CASPO AI
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-white">Your in-app group copilot</h2>
              <p className="mt-2 max-w-[32rem] text-sm leading-6 text-white/70">
                Ask about members, announcements, messages, and events. I&apos;ll only answer from the data your group context allows.
              </p>
            </div>
          </div>

          <div
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
          >
            {messages.length === 0 ? (
              <div className="ai-chat-message-card mt-4 rounded-[26px] border border-white/12 bg-white/8 p-4 text-sm text-white/80 backdrop-blur-xl">
                Start with something like “Summarize our latest announcement” or “Who&apos;s in this group?”
              </div>
            ) : null}

            {messages.map(message => {
              if (message.status === 'error') {
                return (
                  <div
                    key={message.id}
                    className="ai-chat-message-card rounded-[24px] border border-rose-300/18 bg-rose-400/10 p-4 text-sm text-rose-50 backdrop-blur-xl"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-100/80">
                          Assistant error
                        </p>
                        <p className="mt-2 leading-6 text-rose-50/95">{message.content}</p>
                      </div>
                      {message.retryInput ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onRetry(message.retryInput!)}
                          className="h-10 w-10 rounded-full border border-white/12 bg-white/8 text-white hover:bg-white/12"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span className="sr-only">Retry assistant request</span>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              }

              const isUser = message.role === 'user';
              const isPending = message.status === 'pending';

              return (
                <div
                  key={message.id}
                  className={cn('ai-chat-message-card flex w-full', isUser ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[86%] rounded-[26px] px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.18)]',
                      isUser
                        ? 'bg-[linear-gradient(135deg,rgba(74,222,128,0.94),rgba(34,197,94,0.92))] text-emerald-950'
                        : 'border border-white/12 bg-white/8 text-white backdrop-blur-xl'
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {isUser ? (
                        <span className="text-emerald-950/75">You</span>
                      ) : (
                        <>
                          <Bot className="h-3.5 w-3.5 text-emerald-200" />
                          <span className="text-white/65">Assistant</span>
                        </>
                      )}
                    </div>

                    {isPending ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="ai-chat-thinking-dot" />
                          <span className="ai-chat-thinking-dot" />
                          <span className="ai-chat-thinking-dot" />
                        </div>
                        <span className="text-sm text-white/75">Thinking through that…</span>
                      </div>
                    ) : (
                      <p className={cn('whitespace-pre-wrap text-sm leading-6', isUser ? 'text-emerald-950' : 'text-white/92')}>
                        {message.content}
                      </p>
                    )}

                    <p className={cn('mt-2 text-[11px]', isUser ? 'text-emerald-950/70' : 'text-white/45')}>
                      {formatTimestamp(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-white/10 px-4 pb-[calc(1rem+var(--safe-area-bottom-runtime))] pt-3">
            <div className="rounded-[28px] border border-white/12 bg-white/8 p-2 shadow-[0_18px_48px_rgba(8,15,28,0.26)] backdrop-blur-2xl">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={event => onInputChange(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      onSend();
                    }
                  }}
                  placeholder="Ask CASPO AI anything about your group…"
                  className="max-h-36 min-h-[52px] resize-none border-0 bg-transparent px-3 py-3 text-sm leading-6 text-white placeholder:text-white/35 focus-visible:ring-0 focus-visible:ring-offset-0"
                  autoComplete="off"
                  disabled={isSending}
                />

                <Button
                  type="button"
                  onClick={onSend}
                  disabled={isSending || !input.trim()}
                  className="h-12 w-12 shrink-0 rounded-full border border-emerald-200/25 bg-[linear-gradient(135deg,rgba(74,222,128,1),rgba(34,197,94,0.92))] p-0 text-emerald-950 shadow-[0_14px_34px_rgba(34,197,94,0.35)] hover:brightness-105"
                >
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span className="sr-only">Send message</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
