"use client";

import {
  AI_CHAT_HISTORY_LIMIT,
  type AiChatClientMessage,
  type AiChatHistoryMessage,
} from "@/lib/ai-chat";

export const ASSISTANT_CONTEXT_HISTORY_LIMIT = Math.min(AI_CHAT_HISTORY_LIMIT, 3);
const HISTORY_MESSAGE_MAX_CHARS = 2_500;

const isDraftAssistantTurn = (message: AiChatClientMessage) =>
  message.role === "assistant" &&
  !message.status &&
  (message.turn?.state === "draft_preview" || message.turn?.state === "awaiting_confirmation");

const trimHistoryContent = (value: string) => {
  const normalized = value.trim();
  if (normalized.length <= HISTORY_MESSAGE_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, HISTORY_MESSAGE_MAX_CHARS - 1)}…`;
};

const serializeAssistantTurnForHistory = (message: AiChatClientMessage) => {
  const turn = message.turn;
  if (!turn) {
    return trimHistoryContent(message.content);
  }

  switch (turn.state) {
    case "draft_preview":
    case "awaiting_confirmation":
      return trimHistoryContent(
        [
          `assistant_state: ${turn.state}`,
          `assistant_reply: ${turn.reply}`,
          `draft_payload: ${JSON.stringify(turn.preview)}`,
          `pending_action_id: ${turn.pendingActionId}`,
          turn.missingFields?.length
            ? `missing_fields: ${JSON.stringify(turn.missingFields)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    case "retrieval_response":
      return trimHistoryContent(
        [
          `assistant_state: ${turn.state}`,
          `assistant_reply: ${turn.reply}`,
          turn.usedEntities.length
            ? `used_entities: ${JSON.stringify(turn.usedEntities)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    case "response":
    case "executing":
      return trimHistoryContent(
        [
          `assistant_state: ${turn.state}`,
          `assistant_reply: ${turn.reply}`,
        ].join("\n")
      );
    case "success":
      return trimHistoryContent(
        [
          `assistant_state: ${turn.state}`,
          `assistant_message: ${turn.message}`,
          turn.entityRef ? `entity_ref: ${JSON.stringify(turn.entityRef)}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    case "error":
      return trimHistoryContent(
        [
          `assistant_state: ${turn.state}`,
          `assistant_message: ${turn.message}`,
          turn.pendingActionId ? `pending_action_id: ${turn.pendingActionId}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    case "needs_clarification":
      return trimHistoryContent(
        [
          `assistant_state: ${turn.state}`,
          'assistant_reply: AI is temporarily unavailable. Please try again later.',
          turn.missingFields?.length
            ? `missing_fields: ${JSON.stringify(turn.missingFields)}`
            : null,
          turn.pendingActionId ? `pending_action_id: ${turn.pendingActionId}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    default:
      return trimHistoryContent(message.content);
  }
};

export const buildAssistantHistoryPayload = (
  messages: AiChatClientMessage[]
): AiChatHistoryMessage[] => {
  const relevantMessages = messages.filter(
    (message): message is AiChatClientMessage & { role: "user" | "assistant" } =>
      (message.role === "user" || message.role === "assistant") && !message.status
  );

  const trailingStartIndex = Math.max(0, relevantMessages.length - ASSISTANT_CONTEXT_HISTORY_LIMIT);
  const selectedIndexes = new Set<number>();

  for (let index = trailingStartIndex; index < relevantMessages.length; index += 1) {
    selectedIndexes.add(index);
  }

  for (let index = relevantMessages.length - 1; index >= 0; index -= 1) {
    if (!isDraftAssistantTurn(relevantMessages[index])) {
      continue;
    }

    selectedIndexes.add(index);
    if (index > 0 && relevantMessages[index - 1]?.role === "user") {
      selectedIndexes.add(index - 1);
    }
    break;
  }

  return relevantMessages
    .filter((_, index) => selectedIndexes.has(index))
    .map(message => ({
      role: message.role,
      content:
        message.role === "assistant"
          ? serializeAssistantTurnForHistory(message)
          : trimHistoryContent(message.content),
    }));
};
