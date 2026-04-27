"use client";

import { useEffect, useRef, useState } from "react";

import {
  aiChatErrorResponseSchema,
  assistantTurnResponseSchema,
  type AiChatClientMessage,
  type AiChatFailureStage,
} from "@/lib/ai-chat";
import { buildAssistantHistoryPayload } from "@/components/assistant/history";
import type { AssistantCommand } from "@/lib/assistant/agent/types";
import {
  ASSISTANT_OPEN_EVENT,
  clearAssistantPrefill,
} from "@/lib/assistant/prefill";
import { publishAssistantEmailDraft } from "@/lib/assistant/email-draft-handoff";
import { useClubData } from "@/lib/data-hooks";

type AssistantOpenEventDetail = {
  prefill?: string;
};

const REQUEST_TIMEOUT_MS = 30_000;

const isVisibleAssistantHost = (element: HTMLElement | null) =>
  Boolean(element && element.getClientRects().length > 0);

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

  const { message, code, requestId, stage, detail } = parsed.data;
  const stageText = stageLabel(stage);
  const extras = [stageText, code, requestId ? `trace ${requestId.slice(0, 8)}` : null].filter(Boolean);
  const detailText = typeof detail === "string" && detail.trim() ? `\n${detail.trim()}` : "";

  return `${extras.length ? `${message} (${extras.join(" • ")})` : message}${detailText}`;
};

const getTransportErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Assistant request timed out. Please try again.";
  }

  return error instanceof Error
    ? error.message
    : "Assistant unavailable right now.";
};

const createClientMessage = (
  role: AiChatClientMessage["role"],
  content: string,
  options?: Omit<AiChatClientMessage, "id" | "role" | "content" | "createdAt">
): AiChatClientMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt: new Date().toISOString(),
  ...options,
});

const getTurnDisplayText = (turn: ReturnType<typeof assistantTurnResponseSchema.parse>) =>
  "reply" in turn ? turn.reply : turn.message;

const shouldOfferTurnRetry = (turn: ReturnType<typeof assistantTurnResponseSchema.parse>) =>
  turn.state === "needs_clarification" ||
  ((turn.state === "response" || turn.state === "error") && Boolean(turn.diagnostics));

const isRetryableMessageForInput = (
  item: AiChatClientMessage,
  retryInput?: string
) =>
  Boolean(
    retryInput &&
      item.retryInput === retryInput &&
      (item.status === "error" || (item.turn && shouldOfferTurnRetry(item.turn)))
  );

const getEmailDraftForSuccessTurn = ({
  command,
  messages,
  turn,
}: {
  command: AssistantCommand | null;
  messages: AiChatClientMessage[];
  turn: ReturnType<typeof assistantTurnResponseSchema.parse>;
}) => {
  if (turn.state !== "success" || turn.entityRef?.entityType !== "email") {
    return null;
  }

  if (
    command?.kind === "confirm" &&
    command.preview?.kind === "email"
  ) {
    const subject = command.preview.patch.subject?.trim() ?? "";
    const body = command.preview.patch.body?.trim() ?? "";
    if (subject && body) {
      return { subject, body };
    }
  }

  const pendingActionId = turn.entityRef.entityId;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidateTurn = messages[index]?.turn;
    if (!candidateTurn || !("preview" in candidateTurn)) {
      continue;
    }
    if (candidateTurn.pendingActionId !== pendingActionId || candidateTurn.preview.kind !== "email") {
      continue;
    }

    const subject = candidateTurn.preview.subject?.trim() ?? "";
    const body = candidateTurn.preview.body?.trim() ?? "";
    return subject && body ? { subject, body } : null;
  }

  return null;
};

export function useAssistantChat({
  enableExternalOpen = false,
}: {
  enableExternalOpen?: boolean;
} = {}) {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AiChatClientMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [isAssistantSending, setIsAssistantSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const assistantButtonRef = useRef<HTMLButtonElement | null>(null);
  const { refreshData } = useClubData();

  useEffect(() => {
    if (!enableExternalOpen || typeof window === "undefined") {
      return;
    }

    const handleAssistantOpen = (event: Event) => {
      if (!isVisibleAssistantHost(assistantButtonRef.current)) {
        return;
      }

      const detail = (event as CustomEvent<AssistantOpenEventDetail>).detail;
      const prefill = detail?.prefill?.trim();

      if (prefill) {
        setAssistantInput(prefill);
        clearAssistantPrefill();
      }

      setIsAssistantOpen(true);
    };

    window.addEventListener(ASSISTANT_OPEN_EVENT, handleAssistantOpen as EventListener);
    return () =>
      window.removeEventListener(ASSISTANT_OPEN_EVENT, handleAssistantOpen as EventListener);
  }, [enableExternalOpen]);

  const sendAssistantRequest = async (
    message: string | AssistantCommand,
    options: {
      appendUserMessage: boolean;
      retryInput?: string;
    }
  ) => {
    const isTextMessage = typeof message === "string";
    const trimmedMessage = isTextMessage ? message.trim() : null;
    if ((isTextMessage && !trimmedMessage) || isAssistantSending) {
      return;
    }

    const nextUserMessage =
      options.appendUserMessage && trimmedMessage
        ? createClientMessage("user", trimmedMessage)
        : null;
    const pendingMessage = createClientMessage("assistant", "", { status: "pending" });
    const nextMessages = (() => {
      const baseMessages = assistantMessages.filter(
        item => item.status !== "pending" && !isRetryableMessageForInput(item, options.retryInput)
      );
      return nextUserMessage
        ? [...baseMessages, nextUserMessage, pendingMessage]
        : [...baseMessages, pendingMessage];
    })();

    setAssistantMessages(nextMessages);
    if (isTextMessage) {
      setAssistantInput("");
    }
    setIsAssistantSending(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: isTextMessage ? trimmedMessage : message,
          history: buildAssistantHistoryPayload(
            nextMessages.filter(item => item.id !== pendingMessage.id)
          ),
          conversationId,
        }),
        signal: controller.signal,
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

      const parsedPayload = assistantTurnResponseSchema.safeParse(payload);
      if (!parsedPayload.success) {
        throw new Error("Assistant returned an invalid response.");
      }

      const turn = parsedPayload.data;
      setConversationId(turn.conversationId);
      const assistantReply = createClientMessage("assistant", getTurnDisplayText(turn), {
        turn,
        retryInput: shouldOfferTurnRetry(turn)
          ? options.retryInput ?? trimmedMessage ?? undefined
          : undefined,
      });
      const resolvedMessages = nextMessages.map(currentMessage =>
        currentMessage.id === pendingMessage.id ? assistantReply : currentMessage
      );

      setAssistantMessages(resolvedMessages);

      if (turn.state === "success") {
        const emailDraft = getEmailDraftForSuccessTurn({
          command: isTextMessage ? null : message,
          messages: resolvedMessages,
          turn,
        });
        if (emailDraft) {
          publishAssistantEmailDraft(emailDraft);
        }
        void refreshData().catch(() => false);
      }
    } catch (error) {
      const errorMessage = createClientMessage(
        "system",
        getTransportErrorMessage(error),
        {
          status: "error",
          retryInput: options.retryInput ?? trimmedMessage ?? undefined,
        }
      );
      setAssistantMessages(currentMessages =>
        currentMessages.map(currentMessage =>
          currentMessage.id === pendingMessage.id ? errorMessage : currentMessage
        )
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsAssistantSending(false);
    }
  };

  const handleAssistantSend = () => {
    void sendAssistantRequest(assistantInput, {
      appendUserMessage: true,
      retryInput: assistantInput.trim(),
    });
  };

  const handleAssistantRetry = (retryInput: string) => {
    void sendAssistantRequest(retryInput, {
      appendUserMessage: false,
      retryInput,
    });
  };

  const handleAssistantCommand = (command: AssistantCommand) => {
    void sendAssistantRequest(command, {
      appendUserMessage: false,
    });
  };

  return {
    assistantButtonRef,
    assistantInput,
    assistantMessages,
    conversationId,
    handleAssistantCommand,
    handleAssistantRetry,
    handleAssistantSend,
    isAssistantOpen,
    isAssistantSending,
    setAssistantInput,
    setIsAssistantOpen,
  };
}
