"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Bot, CheckCircle2, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";

import type { AiChatClientMessage } from "@/lib/ai-chat";
import type {
  AssistantCommand,
  AssistantTurnDiagnostics,
  DraftPreview,
  RecipientRef,
} from "@/lib/assistant/agent/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  onCommand: (command: AssistantCommand) => void;
  isSending: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: "above" | "below";
};

type PopupLayout = {
  left: number;
  width: number;
  height: number;
  top?: number;
  bottom?: number;
  maxWidth: number;
  maxHeight: number;
  tailOffset: number;
  resizable: boolean;
};

type PopupSize = {
  width: number;
  height: number;
};

type PreviewEditorState = {
  title: string;
  body: string;
  description: string;
  date: string;
  time: string;
  location: string;
  recipientsText: string;
};

const POPUP_HORIZONTAL_MARGIN = 10;
const POPUP_MAX_WIDTH = 420;
const POPUP_MAX_HEIGHT = 560;
const POPUP_MAX_RESIZABLE_WIDTH = 760;
const POPUP_MAX_RESIZABLE_HEIGHT = 720;
const POPUP_MIN_WIDTH = 320;
const POPUP_MIN_HEIGHT = 340;
const POPUP_DEFAULT_HEIGHT_ABOVE = 460;
const POPUP_DEFAULT_HEIGHT_BELOW = 520;
const POPUP_HEIGHT_RATIO = 0.58;
const POPUP_MIN_BOTTOM = 92;
const POPUP_MIN_TAIL_OFFSET = 34;
const POPUP_GAP = 18;
const POPUP_VIEWPORT_EDGE_GAP = 18;
const EMPTY_STATE_TEXT = "Ask about your group or draft something quick.";
const POPUP_SIZE_STORAGE_KEY = "caspo-assistant-popup-size-v1";

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

const isIosEnvironment = () => {
  const platform = navigator.platform;
  const userAgent = navigator.userAgent;

  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
};

const canResizePopup = (placement: AIChatModalProps["placement"]) =>
  placement === "below" && window.innerWidth >= 768 && !isIosEnvironment();

const recipientsToText = (recipients?: RecipientRef[]) =>
  (recipients ?? []).map(recipient => recipient.email).join(", ");

const previewToEditorState = (preview: DraftPreview): PreviewEditorState => ({
  title: preview.kind === "announcement" || preview.kind === "event" ? preview.title ?? "" : "",
  body:
    preview.kind === "announcement" ? preview.body ?? "" : preview.kind === "message" ? preview.body ?? "" : "",
  description: preview.kind === "event" ? preview.description ?? "" : "",
  date: preview.kind === "event" ? preview.date ?? "" : "",
  time: preview.kind === "event" ? preview.time ?? "" : "",
  location: preview.kind === "event" ? preview.location ?? "" : "",
  recipientsText: preview.kind === "message" ? recipientsToText(preview.recipients) : "",
});

const parseRecipients = (value: string): RecipientRef[] | undefined => {
  const emails = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);

  return emails.length > 0 ? emails.map(email => ({ email })) : undefined;
};

const buildPatchFromEditorState = (preview: DraftPreview, editor: PreviewEditorState) => {
  switch (preview.kind) {
    case "announcement":
      return {
        kind: "announcement" as const,
        patch: {
          ...(editor.title.trim() ? { title: editor.title.trim() } : {}),
          ...(editor.body.trim() ? { body: editor.body.trim() } : {}),
        },
      };
    case "event":
      return {
        kind: "event" as const,
        patch: {
          ...(editor.title.trim() ? { title: editor.title.trim() } : {}),
          ...(editor.description.trim() ? { description: editor.description.trim() } : {}),
          ...(editor.date.trim() ? { date: editor.date.trim() } : {}),
          ...(editor.time.trim() ? { time: editor.time.trim() } : {}),
          ...(editor.location.trim() ? { location: editor.location.trim() } : {}),
        },
      };
    case "message":
      return {
        kind: "message" as const,
        patch: {
          ...(editor.body.trim() ? { body: editor.body.trim() } : {}),
          ...(parseRecipients(editor.recipientsText) ? { recipients: parseRecipients(editor.recipientsText) } : {}),
        },
      };
    default:
      return {
        kind: "announcement" as const,
        patch: {},
      };
  }
};

const getPreviewKindLabel = (preview: DraftPreview) => {
  switch (preview.kind) {
    case "announcement":
      return "Announcement";
    case "event":
      return "Event";
    case "message":
      return "Message";
    default:
      return "Draft";
  }
};

const getUsedEntitiesLabel = (usedEntities: string[]) =>
  usedEntities
    .map(entity => entity.replace(/_/g, " "))
    .join(", ");

const getDiagnosticPhaseLabel = (phase: AssistantTurnDiagnostics["phase"]) => {
  switch (phase) {
    case "planner":
      return "Planner";
    case "draft":
      return "Draft generator";
    case "field_validator":
      return "Field validator";
    case "orchestrator":
      return "Orchestrator";
    default:
      return "Assistant";
  }
};

function AssistantDiagnosticsBlock({
  diagnostics,
}: {
  diagnostics?: AssistantTurnDiagnostics;
}) {
  if (!diagnostics) {
    return null;
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground/85">
      <p>
        Failure step: <span className="font-medium text-foreground/90">{getDiagnosticPhaseLabel(diagnostics.phase)}</span>
      </p>
      {diagnostics.detail ? (
        <p className="mt-1 whitespace-pre-wrap break-words">
          Error: {diagnostics.detail}
        </p>
      ) : null}
      {diagnostics.requestId ? (
        <p className="mt-1">
          Trace: {diagnostics.requestId.slice(0, 8)}
        </p>
      ) : null}
    </div>
  );
}

function AssistantRichText({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm leading-6 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.95em] [&_em]:italic [&_li]:pl-1 [&_li]:marker:text-muted-foreground/80 [&_ol]:my-0 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:m-0 [&_p+p]:mt-4 [&_strong]:font-semibold [&_ul]:my-0 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
        className
      )}
    >
      <ReactMarkdown
        components={{
          p: ({ node: _node, ...props }) => <p {...props} />,
          ul: ({ node: _node, ...props }) => <ul {...props} />,
          ol: ({ node: _node, ...props }) => <ol {...props} />,
          li: ({ node: _node, ...props }) => <li {...props} />,
          strong: ({ node: _node, className: strongClassName, ...props }) => (
            <strong className={cn("font-semibold text-foreground", strongClassName)} {...props} />
          ),
          em: ({ node: _node, ...props }) => <em {...props} />,
          a: ({ node: _node, className: linkClassName, ...props }) => (
            <a className={cn("text-foreground underline underline-offset-2", linkClassName)} {...props} />
          ),
          code: ({ node: _node, className: codeClassName, children, ...props }) => (
            <code className={cn("font-medium", codeClassName)} {...props}>
              {String(children).replace(/\n$/, "")}
            </code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AssistantTurnContent({
  message,
  isUser,
  onCommand,
  isSending,
}: {
  message: AiChatClientMessage;
  isUser: boolean;
  onCommand: (command: AssistantCommand) => void;
  isSending: boolean;
}) {
  const turn = message.turn;
  const preview = turn && ("preview" in turn ? turn.preview : null);
  const [editor, setEditor] = useState<PreviewEditorState | null>(
    preview ? previewToEditorState(preview) : null
  );

  useEffect(() => {
    setEditor(preview ? previewToEditorState(preview) : null);
  }, [preview, turn?.turnId]);

  if (!turn) {
    if (isUser) {
      return (
        <p className="whitespace-pre-wrap text-sm leading-6 text-emerald-950">
          {message.content}
        </p>
      );
    }

    return (
      <AssistantRichText
        content={message.content}
        className="text-foreground/92"
      />
    );
  }

  if (turn.state === "draft_preview" || turn.state === "awaiting_confirmation") {
    const currentEditor = editor ?? previewToEditorState(turn.preview);
    const isExecutionReady = turn.state === "awaiting_confirmation";
    const previewKindLabel = getPreviewKindLabel(turn.preview);

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
              isExecutionReady
                ? "bg-emerald-500/20 text-emerald-100"
                : "bg-white/10 text-muted-foreground"
            )}
          >
            {isExecutionReady ? "Confirmation Required" : "Draft Preview"}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/85">
            {previewKindLabel}
          </span>
        </div>
        <AssistantRichText content={turn.reply} className="text-foreground/92" />

        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
          {turn.preview.kind === "announcement" || turn.preview.kind === "event" ? (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                Title
              </label>
              <Input
                value={currentEditor.title}
                onChange={event =>
                  setEditor(current => ({
                    ...(current ?? currentEditor),
                    title: event.target.value,
                  }))
                }
                disabled={isSending || !turn.ui.canEdit}
                className="h-10 border-white/10 bg-white/5 text-sm"
              />
            </div>
          ) : null}

          {turn.preview.kind === "announcement" ? (
            <div className="mt-3 space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                Body
              </label>
              <Textarea
                value={currentEditor.body}
                onChange={event =>
                  setEditor(current => ({
                    ...(current ?? currentEditor),
                    body: event.target.value,
                  }))
                }
                disabled={isSending || !turn.ui.canEdit}
                className="min-h-[110px] border-white/10 bg-white/5 text-sm"
              />
            </div>
          ) : null}

          {turn.preview.kind === "event" ? (
            <>
              <div className="mt-3 space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                  Description
                </label>
                <Textarea
                  value={currentEditor.description}
                  onChange={event =>
                    setEditor(current => ({
                      ...(current ?? currentEditor),
                      description: event.target.value,
                    }))
                  }
                  disabled={isSending || !turn.ui.canEdit}
                  className="min-h-[100px] border-white/10 bg-white/5 text-sm"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                    Date
                  </label>
                  <Input
                    value={currentEditor.date}
                    onChange={event =>
                      setEditor(current => ({
                        ...(current ?? currentEditor),
                        date: event.target.value,
                      }))
                    }
                    disabled={isSending || !turn.ui.canEdit}
                    className="h-10 border-white/10 bg-white/5 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                    Time
                  </label>
                  <Input
                    value={currentEditor.time}
                    onChange={event =>
                      setEditor(current => ({
                        ...(current ?? currentEditor),
                        time: event.target.value,
                      }))
                    }
                    disabled={isSending || !turn.ui.canEdit}
                    className="h-10 border-white/10 bg-white/5 text-sm"
                  />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                  Location
                </label>
                <Input
                  value={currentEditor.location}
                  onChange={event =>
                    setEditor(current => ({
                      ...(current ?? currentEditor),
                      location: event.target.value,
                    }))
                  }
                  disabled={isSending || !turn.ui.canEdit}
                  className="h-10 border-white/10 bg-white/5 text-sm"
                />
              </div>
            </>
          ) : null}

          {turn.preview.kind === "message" ? (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                Message
              </label>
              <Textarea
                value={currentEditor.body}
                onChange={event =>
                  setEditor(current => ({
                    ...(current ?? currentEditor),
                    body: event.target.value,
                  }))
                }
                disabled={isSending || !turn.ui.canEdit}
                className="min-h-[110px] border-white/10 bg-white/5 text-sm"
              />
            </div>
          ) : null}

          {turn.preview.kind === "message" ? (
            <div className="mt-3 space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                Recipients
              </label>
              <Input
                value={currentEditor.recipientsText}
                onChange={event =>
                  setEditor(current => ({
                    ...(current ?? currentEditor),
                    recipientsText: event.target.value,
                  }))
                }
                placeholder="email1@example.com, email2@example.com"
                disabled={isSending || !turn.ui.canEdit}
                className="h-10 border-white/10 bg-white/5 text-sm"
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {turn.ui.canRegenerate ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSending}
              onClick={() =>
                onCommand({
                  kind: "regenerate",
                  pendingActionId: turn.pendingActionId,
                })
              }
            >
              Regenerate
            </Button>
          ) : null}

          {turn.ui.canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSending}
              onClick={() =>
                onCommand({
                  kind: "cancel",
                  pendingActionId: turn.pendingActionId,
                })
              }
            >
              Cancel
            </Button>
          ) : null}

          {turn.ui.canConfirm ? (
            <Button
              type="button"
              size="sm"
              variant={isExecutionReady ? "default" : "outline"}
              disabled={isSending}
              className={cn(
                isExecutionReady &&
                  "bg-emerald-500 text-white hover:bg-emerald-400"
              )}
              onClick={() =>
                onCommand({
                  kind: "confirm",
                  pendingActionId: turn.pendingActionId,
                  ...(turn.ui.canEdit
                    ? { preview: buildPatchFromEditorState(turn.preview, currentEditor) }
                    : {}),
                })
              }
            >
              {isExecutionReady ? `Confirm ${previewKindLabel}` : "Confirm"}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (turn.state === "retrieval_response") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Retrieved Context
          </span>
          {turn.usedEntities.length > 0 ? (
            <span className="text-xs text-muted-foreground/80">
              {getUsedEntitiesLabel(turn.usedEntities)}
            </span>
          ) : null}
        </div>
        <AssistantRichText content={turn.reply} className="text-foreground/92" />
      </div>
    );
  }

  if (turn.state === "executing") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-emerald-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">Executing</span>
        </div>
        <AssistantRichText content={turn.reply} className="text-foreground/92" />
      </div>
    );
  }

  if (turn.state === "success") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-sm font-medium">Completed</span>
        </div>
        <AssistantRichText content={turn.message} className="text-foreground/92" />
      </div>
    );
  }

  if (turn.state === "error") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-rose-100/90">Assistant Error</p>
        <AssistantRichText content={turn.message} className="text-rose-50/95" />
        <AssistantDiagnosticsBlock diagnostics={turn.diagnostics} />
      </div>
    );
  }

  if (turn.state === "needs_clarification") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-amber-100/90">Need Clarification</p>
        <AssistantRichText content={turn.message} className="text-foreground/92" />
        {turn.missingFields?.length ? (
          <p className="text-xs text-muted-foreground/80">
            Still needed: {turn.missingFields.join(", ")}
          </p>
        ) : null}
      </div>
    );
  }

  if (turn.state === "response") {
    return (
      <div className="space-y-2">
        <AssistantRichText content={turn.reply} className="text-foreground/92" />
        <AssistantDiagnosticsBlock diagnostics={turn.diagnostics} />
        {turn.retryCount > 0 || turn.timeoutFlag ? (
          <p className="text-xs text-muted-foreground/80">
            {turn.timeoutFlag ? "That request hit a timeout." : "That request needed retries."}
          </p>
        ) : null}
      </div>
    );
  }

  return <AssistantRichText content={turn.reply} className="text-foreground/92" />;
}

export function AIChatModal({
  open,
  onOpenChange,
  messages,
  input,
  onInputChange,
  onSend,
  onRetry,
  onCommand,
  isSending,
  anchorRef,
  placement = "above",
}: AIChatModalProps) {
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<PopupLayout | null>(null);
  const [preferredSize, setPreferredSize] = useState<PopupSize | null>(null);
  const [typedCount, setTypedCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeSessionRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    try {
      const rawValue = window.localStorage.getItem(POPUP_SIZE_STORAGE_KEY);
      if (!rawValue) return;

      const parsedValue = JSON.parse(rawValue) as Partial<PopupSize>;
      if (
        typeof parsedValue.width !== "number" ||
        !Number.isFinite(parsedValue.width) ||
        typeof parsedValue.height !== "number" ||
        !Number.isFinite(parsedValue.height)
      ) {
        return;
      }

      setPreferredSize({
        width: parsedValue.width,
        height: parsedValue.height,
      });
    } catch {
      window.localStorage.removeItem(POPUP_SIZE_STORAGE_KEY);
    }
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !preferredSize) return;

    window.localStorage.setItem(POPUP_SIZE_STORAGE_KEY, JSON.stringify(preferredSize));
  }, [mounted, preferredSize]);

  useEffect(
    () => () => {
      resizeSessionRef.current?.abort();
    },
    []
  );

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
      const isResizable = canResizePopup(placement);
      const maxWidth = Math.min(
        isResizable ? POPUP_MAX_RESIZABLE_WIDTH : POPUP_MAX_WIDTH,
        viewportWidth - POPUP_HORIZONTAL_MARGIN * 2
      );
      const minWidth = Math.min(isResizable ? POPUP_MIN_WIDTH : 300, maxWidth);
      const width = clamp(
        isResizable ? preferredSize?.width ?? POPUP_MAX_WIDTH : POPUP_MAX_WIDTH,
        minWidth,
        maxWidth
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
      if (placement === "below") {
        const preferredLeft = rect.right - width;
        const anchoredLeft = clamp(
          preferredLeft,
          POPUP_HORIZONTAL_MARGIN,
          viewportWidth - POPUP_HORIZONTAL_MARGIN - width
        );
        const anchoredTop = rect.bottom + POPUP_GAP;
        const availableHeight = viewportHeight - anchoredTop - POPUP_VIEWPORT_EDGE_GAP;
        const maxHeight = Math.min(
          isResizable ? POPUP_MAX_RESIZABLE_HEIGHT : POPUP_MAX_HEIGHT,
          Math.max(POPUP_MIN_HEIGHT, availableHeight)
        );
        const minHeight = Math.min(POPUP_MIN_HEIGHT, maxHeight);
        const height = clamp(
          isResizable ? preferredSize?.height ?? POPUP_DEFAULT_HEIGHT_BELOW : POPUP_DEFAULT_HEIGHT_BELOW,
          minHeight,
          maxHeight
        );

        setLayout({
          left: anchoredLeft,
          width,
          height,
          top: anchoredTop,
          maxWidth,
          maxHeight,
          tailOffset: clamp(
            anchorCenter - anchoredLeft,
            POPUP_MIN_TAIL_OFFSET,
            width - POPUP_MIN_TAIL_OFFSET
          ),
          resizable: isResizable,
        });
        return;
      }

      const anchoredBottom = window.innerHeight - rect.top + POPUP_GAP;
      const bottom = Math.max(POPUP_MIN_BOTTOM, anchoredBottom, keyboardInset + 12);
      const maxHeight = Math.min(
        POPUP_MAX_HEIGHT,
        Math.max(POPUP_MIN_HEIGHT, viewportHeight * POPUP_HEIGHT_RATIO)
      );
      const height = Math.min(maxHeight, POPUP_DEFAULT_HEIGHT_ABOVE);

      setLayout({
        left,
        width,
        height,
        bottom,
        maxWidth,
        maxHeight,
        tailOffset,
        resizable: false,
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
  }, [anchorRef, open, placement, preferredSize]);

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

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layout?.resizable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeSessionRef.current?.abort();

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = layout.width;
    const startHeight = layout.height;
    const maxWidth = layout.maxWidth;
    const maxHeight = layout.maxHeight;
    const minWidth = Math.min(POPUP_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(POPUP_MIN_HEIGHT, maxHeight);
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    const controller = new AbortController();

    resizeSessionRef.current = controller;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nesw-resize";

    const stopResize = () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;

      if (resizeSessionRef.current === controller) {
        resizeSessionRef.current = null;
      }

      controller.abort();
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clamp(startWidth + (startX - moveEvent.clientX), minWidth, maxWidth);
      const nextHeight = clamp(startHeight + (moveEvent.clientY - startY), minHeight, maxHeight);

      setPreferredSize({
        width: nextWidth,
        height: nextHeight,
      });
    };

    window.addEventListener("pointermove", handlePointerMove, { signal: controller.signal });
    window.addEventListener("pointerup", stopResize, { signal: controller.signal });
    window.addEventListener("pointercancel", stopResize, { signal: controller.signal });
  };

  if (!mounted || !open || !layout) {
    return null;
  }

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
        data-placement={placement}
        style={{
          left: `${layout.left}px`,
          width: `${layout.width}px`,
          ...(layout.top !== undefined ? { top: `${layout.top}px` } : {}),
          ...(layout.bottom !== undefined ? { bottom: `${layout.bottom}px` } : {}),
          height: `${layout.height}px`,
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
                  Ask a question or safely draft actions.
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
                          <AssistantRichText
                            content={message.content}
                            className="mt-2 text-rose-50/95"
                          />
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
                      <AssistantTurnContent
                        message={message}
                        isUser={isUser}
                        onCommand={onCommand}
                        isSending={isSending}
                      />
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

        {layout.resizable ? (
          <div
            className="assistant-popup-resize-corner"
            onPointerDown={handleResizePointerDown}
            aria-hidden="true"
          />
        ) : null}

        <div
          className="assistant-popup-tail"
          data-placement={placement}
          style={{ left: `${layout.tailOffset}px` }}
          aria-hidden="true"
        />
      </section>
    </>,
    document.body
  );
}
