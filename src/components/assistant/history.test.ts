import { describe, expect, it } from "vitest";

import {
  ASSISTANT_CONTEXT_HISTORY_LIMIT,
  buildAssistantHistoryPayload,
} from "@/components/assistant/history";
import type { AiChatClientMessage } from "@/lib/ai-chat";

const baseMessage = (
  overrides: Partial<AiChatClientMessage> & Pick<AiChatClientMessage, "id" | "role" | "content">
): AiChatClientMessage => ({
  createdAt: "2026-04-24T00:00:00.000Z",
  ...overrides,
});

describe("buildAssistantHistoryPayload", () => {
  it("keeps the latest 3 rich history messages including draft payloads", () => {
    expect(ASSISTANT_CONTEXT_HISTORY_LIMIT).toBe(3);

    const history = buildAssistantHistoryPayload([
      baseMessage({
        id: "older-user",
        role: "user",
        content: "older message",
      }),
      baseMessage({
        id: "draft-user",
        role: "user",
        content: "send an announcement reminding everyone to pay dues",
      }),
      baseMessage({
        id: "draft-assistant",
        role: "assistant",
        content: "Here is a draft announcement.",
        turn: {
          state: "draft_preview",
          conversationId: "6c35d83c-7d59-4e9e-9cab-37253097598a",
          turnId: "8c7d132f-fd89-49ae-b1d5-06f24fd900cb",
          reply: "Here is a draft announcement. You can edit it, regenerate it, or confirm it when you're ready.",
          preview: {
            kind: "announcement",
            title: "Dues Reminder",
            body: "This is a reminder that dues still need to be paid.",
          },
          pendingActionId: "182ef2d1-3f77-4b24-88b8-75be9fbd9c50",
          ui: {
            canEdit: true,
            canRegenerate: true,
            canConfirm: true,
            canCancel: true,
            editableFields: ["title", "body"],
          },
          retryCount: 0,
          timeoutFlag: false,
        },
      }),
      baseMessage({
        id: "follow-up-user",
        role: "user",
        content: "make it more concise",
      }),
    ]);

    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({
      role: "user",
      content: "send an announcement reminding everyone to pay dues",
    });
    expect(history[1].role).toBe("assistant");
    expect(history[1].content).toContain("assistant_reply:");
    expect(history[1].content).toContain("draft_payload:");
    expect(history[1].content).toContain('"kind":"announcement"');
    expect(history[1].content).toContain('"title":"Dues Reminder"');
    expect(history[1].content).toContain('"body":"This is a reminder that dues still need to be paid."');
    expect(history[2]).toEqual({
      role: "user",
      content: "make it more concise",
    });
  });

  it("preserves the latest draft turn and its source request across a clarification follow-up", () => {
    const history = buildAssistantHistoryPayload([
      baseMessage({
        id: "draft-user",
        role: "user",
        content: "send an announcement reminding everyone to pay dues",
      }),
      baseMessage({
        id: "draft-assistant",
        role: "assistant",
        content: "Here is a draft announcement.",
        turn: {
          state: "draft_preview",
          conversationId: "6c35d83c-7d59-4e9e-9cab-37253097598a",
          turnId: "8c7d132f-fd89-49ae-b1d5-06f24fd900cb",
          reply: "Here is a draft announcement. You can edit it, regenerate it, or confirm it when you're ready.",
          preview: {
            kind: "announcement",
            title: "Dues Reminder",
            body: "This is a reminder that dues still need to be paid.",
          },
          pendingActionId: "182ef2d1-3f77-4b24-88b8-75be9fbd9c50",
          ui: {
            canEdit: true,
            canRegenerate: true,
            canConfirm: true,
            canCancel: true,
            editableFields: ["title", "body"],
          },
          retryCount: 0,
          timeoutFlag: false,
        },
      }),
      baseMessage({
        id: "follow-up-user",
        role: "user",
        content: "make it more concise",
      }),
      baseMessage({
        id: "clarification-assistant",
        role: "assistant",
        content: "Which announcement would you like me to update?",
        turn: {
          state: "needs_clarification",
          conversationId: "6c35d83c-7d59-4e9e-9cab-37253097598a",
          turnId: "8c7d132f-fd89-49ae-b1d5-06f24fd900cd",
          message: "Which announcement would you like me to update?",
          missingFields: ["targetRef"],
          pendingActionId: "182ef2d1-3f77-4b24-88b8-75be9fbd9c50",
          retryCount: 0,
          timeoutFlag: false,
        },
      }),
      baseMessage({
        id: "clarification-user",
        role: "user",
        content: "the dues one",
      }),
    ]);

    expect(history.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(history[0].content).toBe("send an announcement reminding everyone to pay dues");
    expect(history[1].content).toContain("draft_payload:");
    expect(history[1].content).toContain('"title":"Dues Reminder"');
    expect(history[2].content).toBe("make it more concise");
    expect(history[3].content).toContain("assistant_state: needs_clarification");
    expect(history[4].content).toBe("the dues one");
  });

  it("includes clarification metadata in assistant history content", () => {
    const history = buildAssistantHistoryPayload([
      baseMessage({
        id: "assistant-clarify",
        role: "assistant",
        content: "Which announcement would you like me to update?",
        turn: {
          state: "needs_clarification",
          conversationId: "6c35d83c-7d59-4e9e-9cab-37253097598a",
          turnId: "8c7d132f-fd89-49ae-b1d5-06f24fd900cb",
          message: "Which announcement would you like me to update?",
          missingFields: ["targetRef"],
          pendingActionId: "182ef2d1-3f77-4b24-88b8-75be9fbd9c50",
          retryCount: 0,
          timeoutFlag: false,
        },
      }),
    ]);

    expect(history[0].content).toContain("assistant_state: needs_clarification");
    expect(history[0].content).toContain('missing_fields: ["targetRef"]');
    expect(history[0].content).toContain("pending_action_id: 182ef2d1-3f77-4b24-88b8-75be9fbd9c50");
  });
});
