import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/telemetry', () => ({
  addBreadcrumb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/assistant/agent/pending-actions', () => ({
  createPendingAction: vi.fn().mockResolvedValue({
    id: '7cbec480-fd92-4213-a81f-d531f8ff2fb0',
    expiresAt: '2026-04-23T20:00:00.000Z',
    idempotencyKey: 'idem-1',
  }),
  getLatestValidPendingAction: vi.fn(),
  getOrCreateConversation: vi.fn().mockResolvedValue('6c35d83c-7d59-4e9e-9cab-37253097598a'),
  getScopedPendingActionById: vi.fn(),
  markPendingActionCancelled: vi.fn(),
  markPendingActionExpired: vi.fn(),
  persistAssistantTurn: vi.fn().mockResolvedValue(undefined),
  updatePendingActionPayload: vi.fn(),
}));

vi.mock('@/lib/assistant/agent/context', () => ({
  getAgentContext: vi.fn().mockResolvedValue({
    role: 'admin',
    permissions: {
      canCreateAnnouncements: true,
      canUpdateAnnouncements: true,
      canCreateEvents: true,
      canUpdateEvents: true,
      canMessageMembers: true,
    },
  }),
}));

vi.mock('@/lib/assistant/agent/authorize', () => ({
  authorizeAction: vi.fn().mockReturnValue({ ok: true }),
}));

vi.mock('@/lib/assistant/agent/feature-flags', () => ({
  getAssistantActionFlag: vi.fn().mockReturnValue({
    draftEnabled: true,
    executeEnabled: true,
  }),
}));

vi.mock('@/lib/assistant/agent/retrieval', () => ({
  fetchAgentRetrievalContext: vi.fn().mockResolvedValue({
    context: {},
    usedEntities: [],
  }),
}));

vi.mock('@/lib/assistant/agent/drafts', () => ({
  generateDraftPreview: vi.fn(),
}));

vi.mock('@/lib/assistant/agent/executor', () => ({
  executePendingAction: vi.fn(),
}));

vi.mock('@/lib/assistant/agent/retry', () => ({
  runLlmStepWithRetry: vi.fn(),
}));

import { createPendingAction } from '@/lib/assistant/agent/pending-actions';
import { handleAssistantTurn } from '@/lib/assistant/agent/handle-turn';
import { runLlmStepWithRetry } from '@/lib/assistant/agent/retry';

const announcementPlannerValue = {
  intent: 'draft_action' as const,
  summary: 'Draft an announcement.',
  needsRetrieval: false,
  action: {
    type: 'create_announcement' as const,
    fieldsProvided: {},
    fieldsMissing: [],
    requiresPreview: true,
    requiresConfirmation: true,
  },
  confidence: 0.9,
};

const messagePlannerValue = {
  intent: 'draft_action' as const,
  summary: 'Draft a message.',
  needsRetrieval: false,
  action: {
    type: 'create_message' as const,
    fieldsProvided: {
      recipients: ['alex@example.com'],
    },
    fieldsMissing: [],
    requiresPreview: true,
    requiresConfirmation: true,
  },
  confidence: 0.9,
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
    if (step === 'planner') {
      return {
        ok: true,
        value: {
          ...announcementPlannerValue,
          action: { ...announcementPlannerValue.action },
        },
        retryCount: 0,
        timeoutFlag: false,
      };
    }

    if (step === 'field_validator') {
      return {
        ok: true,
        value: {
          inferredFields: {
            body: 'Reminder that dues are due this week.',
          },
          missingFields: [],
          usedInference: true,
          telemetry: {
            confidence: 0.88,
          },
        },
        retryCount: 0,
        timeoutFlag: false,
      };
    }

    return {
      ok: true,
      value: {
        kind: 'announcement',
        body: 'Reminder that dues are due this week.',
      },
      retryCount: 0,
      timeoutFlag: false,
    };
  });
});

describe('handleAssistantTurn', () => {
  it('stores validator-generated action fields instead of the raw request text', async () => {
    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      message: 'reminding them to pay dues',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.preview.kind).toBe('announcement');
    if (result.preview.kind !== 'announcement') {
      throw new Error('Expected announcement preview.');
    }

    expect(result.preview.body).toBe('Reminder that dues are due this week.');
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionFields: expect.objectContaining({
          body: 'Reminder that dues are due this week.',
        }),
      })
    );
  });

  it('returns validator-driven clarification for missing content fields', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...messagePlannerValue,
            action: {
              ...messagePlannerValue.action,
              fieldsProvided: { ...messagePlannerValue.action.fieldsProvided },
            },
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      if (step === 'field_validator') {
        return {
          ok: true,
          value: {
            inferredFields: {},
            missingFields: ['body'],
            clarificationMessage: 'What should this message say?',
            usedInference: false,
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      return {
        ok: true,
        value: {
          kind: 'message',
        },
        retryCount: 0,
        timeoutFlag: false,
      };
    });

    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      message: 'send Alex a reminder',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('needs_clarification');
    if (result.state !== 'needs_clarification') {
      throw new Error('Expected clarification result.');
    }

    expect(result.message).toBe('What should this message say?');
    expect(result.missingFields).toEqual(['body']);
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it('clarifies structural fields before the validator runs', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...messagePlannerValue,
            action: {
              ...messagePlannerValue.action,
              fieldsProvided: {},
            },
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      return {
        ok: true,
        value: {
          inferredFields: {},
          missingFields: [],
          usedInference: false,
        },
        retryCount: 0,
        timeoutFlag: false,
      };
    });

    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      message: 'send a reminder',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('needs_clarification');
    if (result.state !== 'needs_clarification') {
      throw new Error('Expected clarification result.');
    }

    expect(result.message).toBe('Who should receive this message?');
    expect(result.missingFields).toEqual(['recipients']);
    expect(vi.mocked(runLlmStepWithRetry).mock.calls.map(([args]) => args.step)).toEqual(['planner']);
  });

  it('treats a validator failure as a pipeline failure instead of falling back to raw text', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...announcementPlannerValue,
            action: { ...announcementPlannerValue.action },
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      if (step === 'field_validator') {
        return {
          ok: false,
          retryCount: 2,
          timeoutFlag: true,
          lastErrorMessage: 'AI request timed out. Please try again.',
        };
      }

      throw new Error('Draft step should not run when validation fails.');
    });

    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      requestId: 'req-validator-failure',
      message: 'reminding them to pay dues',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('response');
    if (result.state !== 'response') {
      throw new Error('Expected fallback response result.');
    }

    expect(result.diagnostics).toEqual({
      phase: 'field_validator',
      detail: 'AI request timed out. Please try again.',
      requestId: 'req-validator-failure',
    });
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it('treats missing preview fields after validator success as a draft failure', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...announcementPlannerValue,
            action: { ...announcementPlannerValue.action },
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      if (step === 'field_validator') {
        return {
          ok: true,
          value: {
            inferredFields: {
              body: 'Reminder that dues are due this week.',
            },
            missingFields: [],
            usedInference: true,
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      return {
        ok: true,
        value: {
          kind: 'announcement',
        },
        retryCount: 0,
        timeoutFlag: false,
      };
    });

    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      requestId: 'req-draft-failure',
      message: 'reminding them to pay dues',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('response');
    if (result.state !== 'response') {
      throw new Error('Expected fallback response result.');
    }

    expect(result.diagnostics).toEqual({
      phase: 'draft',
      detail: 'Draft preview omitted required fields: title, body',
      requestId: 'req-draft-failure',
    });
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it('includes fallback diagnostics when the planner fails', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementationOnce(async () => ({
      ok: false,
      retryCount: 2,
      timeoutFlag: true,
      lastErrorMessage: 'AI request timed out. Please try again.',
    }));

    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      requestId: 'req-12345678',
      message: 'send an announcement reminding everyone to pay dues',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('response');
    if (result.state !== 'response') {
      throw new Error('Expected response result.');
    }

    expect(result.diagnostics).toEqual({
      phase: 'planner',
      detail: 'AI request timed out. Please try again.',
      requestId: 'req-12345678',
    });
    expect(result.reply).toContain("I'm having trouble processing that request right now");
  });
});
