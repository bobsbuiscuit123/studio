"use client";

import { useEffect, useRef, useState } from "react";

import {
  AI_CHAT_HISTORY_LIMIT,
  aiChatErrorResponseSchema,
  aiChatResponseSchema,
  type AiChatClientMessage,
  type AiChatFailureStage,
  type AiChatHistoryMessage,
} from "@/lib/ai-chat";
import {
  ASSISTANT_OPEN_EVENT,
  clearAssistantPrefill,
} from "@/lib/assistant/prefill";

type AssistantOpenEventDetail = {
  prefill?: string;
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

  const { message, code, requestId, stage, detail } = parsed.data;
  const stageText = stageLabel(stage);
  const extras = [stageText, code, requestId ? `trace ${requestId.slice(0, 8)}` : null].filter(Boolean);
  const detailText = typeof detail === "string" && detail.trim() ? `\n${detail.trim()}` : "";

  return `${extras.length ? `${message} (${extras.join(" • ")})` : message}${detailText}`;
};

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

const buildHistoryPayload = (
  messages: AiChatClientMessage[]
): AiChatHistoryMessage[] =>
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

export function useAssistantChat({
  enableExternalOpen = false,
}: {
  enableExternalOpen?: boolean;
} = {}) {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AiChatClientMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [isAssistantSending, setIsAssistantSending] = useState(false);
  const assistantButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!enableExternalOpen || typeof window === "undefined") {
      return;
    }

    const handleAssistantOpen = (event: Event) => {
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

  const sendAssistantMessage = async (
    rawMessage: string,
    { appendUserMessage }: { appendUserMessage: boolean }
  ) => {
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

  return {
    assistantButtonRef,
    assistantInput,
    assistantMessages,
    handleAssistantRetry,
    handleAssistantSend,
    isAssistantOpen,
    isAssistantSending,
    setAssistantInput,
    setIsAssistantOpen,
  };
}
