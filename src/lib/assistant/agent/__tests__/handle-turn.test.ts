import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai-chat-server', () => ({
  AI_CHAT_RESPONDER_SYSTEM_PROMPT: 'test responder prompt',
  buildAiChatResponderPrompt: vi.fn().mockReturnValue('test responder request'),
  fetchAiChatDataContext: vi.fn().mockResolvedValue({
    context: {
      announcements: [],
      events: [],
    },
    usedEntities: [],
  }),
}));

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
      canCreateEmails: true,
      canUpdateEmails: true,
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
import {
  getLatestValidPendingAction,
  updatePendingActionPayload,
} from '@/lib/assistant/agent/pending-actions';
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

const emailPlannerValue = {
  intent: 'draft_action' as const,
  summary: 'Draft an email.',
  needsRetrieval: false,
  action: {
    type: 'create_email' as const,
    fieldsProvided: {},
    fieldsMissing: [],
    requiresPreview: true,
    requiresConfirmation: true,
  },
  confidence: 0.9,
};

const eventPlannerValue = {
  intent: 'draft_action' as const,
  summary: 'Draft an event.',
  needsRetrieval: false,
  action: {
    type: 'create_event' as const,
    fieldsProvided: {},
    fieldsMissing: [],
    requiresPreview: true,
    requiresConfirmation: true,
  },
  confidence: 0.9,
};

const updateMessagePlannerValue = {
  intent: 'draft_action' as const,
  summary: 'Revise the active message draft.',
  needsRetrieval: false,
  action: {
    type: 'update_message' as const,
    fieldsProvided: {},
    fieldsMissing: [],
    requiresPreview: true,
    requiresConfirmation: true,
  },
  confidence: 0.9,
};

const updateEmailPlannerValue = {
  intent: 'draft_action' as const,
  summary: 'Revise the active email draft.',
  needsRetrieval: false,
  action: {
    type: 'update_email' as const,
    fieldsProvided: {},
    fieldsMissing: [],
    requiresPreview: true,
    requiresConfirmation: true,
  },
  confidence: 0.9,
};

const updateAnnouncementPlannerValue = {
  intent: 'draft_action' as const,
  summary: 'Revise the active announcement draft.',
  needsRetrieval: false,
  action: {
    type: 'update_announcement' as const,
    fieldsProvided: {},
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
            title: 'Dues Reminder',
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
        title: 'Dues Reminder',
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
          title: 'Dues Reminder',
          body: 'Reminder that dues are due this week.',
        }),
      })
    );
  });

  it('creates editable email drafts from validator-owned subject and body fields', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...emailPlannerValue,
            action: { ...emailPlannerValue.action },
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
              subject: 'ELA Test Reminder',
              body: 'Please remember the ELA test on April 30 and plan accordingly.',
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
          kind: 'email',
          subject: 'ELA Test Reminder',
          body: 'Please remember the ELA test on April 30 and plan accordingly.',
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
      message: 'draft an email to members about the ela test on the 30th',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.preview.kind).toBe('email');
    if (result.preview.kind !== 'email') {
      throw new Error('Expected email preview.');
    }

    expect(result.preview.subject).toBe('ELA Test Reminder');
    expect(result.preview.body).toContain('April 30');
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'create_email',
        actionFields: expect.objectContaining({
          subject: 'ELA Test Reminder',
          body: 'Please remember the ELA test on April 30 and plan accordingly.',
        }),
        payload: expect.objectContaining({
          kind: 'email',
          subject: 'ELA Test Reminder',
        }),
      })
    );
  });

  it('keeps drafting create_event requests when local scheduling fallback fills validator gaps', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...eventPlannerValue,
            action: { ...eventPlannerValue.action },
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
            missingFields: [],
            usedInference: false,
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      return {
        ok: true,
        value: {
          kind: 'event',
          title: 'ELA Test',
          description: 'Prepare for the upcoming ELA test.',
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
      message: 'put an ela test on the 30th on the calendar',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.preview.kind).toBe('event');
    if (result.preview.kind !== 'event') {
      throw new Error('Expected event preview.');
    }

    expect(result.preview.title).toBe('ELA Test');
    expect(result.preview.description).toBe('Prepare for the upcoming ELA test.');
    expect(result.preview.date).toBe('2026-04-30');
    expect(result.preview.time).toBe('18:00');
    expect(result.preview.location).toBe('TBD');
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'create_event',
        actionFields: expect.objectContaining({
          title: expect.any(String),
          description: expect.any(String),
          date: '2026-04-30',
          time: '18:00',
          location: 'TBD',
        }),
      })
    );
    expect(vi.mocked(runLlmStepWithRetry).mock.calls.map(([args]) => args.step)).toEqual([
      'planner',
      'field_validator',
      'draft',
    ]);
  });

  it('prefers validator-owned event fields over a noisy draft preview', async () => {
    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...eventPlannerValue,
            action: { ...eventPlannerValue.action },
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
              title: 'ELA Test',
              description: 'Prepare for the upcoming ELA test.',
              date: '2026-04-30',
              time: '18:00',
              location: 'TBD',
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
          kind: 'event',
          title: 'Following: Ela Test 30h Event',
          description:
            'The following: ela test on the 30h Create an event regarding the following: ela test on the 30h.',
          date: '2026-04-30',
          time: '18:00',
          location: 'TBD',
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
      message: 'Create an event regarding the following: ela test on the 30h',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.preview.kind).toBe('event');
    if (result.preview.kind !== 'event') {
      throw new Error('Expected event preview.');
    }

    expect(result.preview.title).toBe('ELA Test');
    expect(result.preview.description).toBe('Prepare for the upcoming ELA test.');
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'event',
          title: 'ELA Test',
          description: 'Prepare for the upcoming ELA test.',
        }),
      })
    );
  });

  it('asks for clarification when the validator returns no message body', async () => {
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
            missingFields: [],
            usedInference: false,
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      return {
        ok: false,
        retryCount: 0,
        timeoutFlag: false,
        lastErrorMessage: 'Draft step should not run when required fields are missing.',
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
    expect(vi.mocked(runLlmStepWithRetry).mock.calls.map(([args]) => args.step)).toEqual([
      'planner',
      'field_validator',
    ]);
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

  it('asks for clarification when Gemini leaves required announcement fields empty', async () => {
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
        ok: false,
        retryCount: 0,
        timeoutFlag: false,
        lastErrorMessage: 'Draft step should not run when required fields are missing.',
      };
    });

    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      requestId: 'req-validator-underreported',
      message: 'reminding them to pay dues',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('needs_clarification');
    if (result.state !== 'needs_clarification') {
      throw new Error('Expected clarification result.');
    }

    expect(result.message).toBe('What title should this announcement use?');
    expect(result.missingFields).toEqual(['title']);
    expect(createPendingAction).not.toHaveBeenCalled();
    expect(vi.mocked(runLlmStepWithRetry).mock.calls.map(([args]) => args.step)).toEqual([
      'planner',
      'field_validator',
    ]);
  });

  it('preserves the authoritative announcement body when the draft preview omits it', async () => {
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
              title: 'Dues Reminder',
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
          title: 'Dues Reminder',
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
      requestId: 'req-draft-omitted-body',
      message: 'send an announcement reminding everyone to pay dues',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.preview).toEqual({
      kind: 'announcement',
      title: 'Dues Reminder',
      body: 'Reminder that dues are due this week.',
    });
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          kind: 'announcement',
          title: 'Dues Reminder',
          body: 'Reminder that dues are due this week.',
        },
      })
    );
  });

  it('falls back to an authoritative preview when the draft step times out', async () => {
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
              title: 'Quick Dues Reminder',
              body: 'Please pay your dues this week.',
            },
            missingFields: [],
            usedInference: true,
          },
          retryCount: 0,
          timeoutFlag: false,
        };
      }

      return {
        ok: false,
        retryCount: 2,
        timeoutFlag: true,
        lastErrorMessage: 'AI request timed out. Please try again.',
      };
    });

    const result = await handleAssistantTurn({
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      userEmail: 'leader@example.com',
      requestId: 'req-draft-timeout-fallback',
      message: 'make it shorter',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.preview).toEqual({
      kind: 'announcement',
      title: 'Quick Dues Reminder',
      body: 'Please pay your dues this week.',
    });
    expect(result.retryCount).toBe(2);
    expect(result.timeoutFlag).toBe(true);
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          kind: 'announcement',
          title: 'Quick Dues Reminder',
          body: 'Please pay your dues this week.',
        },
      })
    );
  });

  it('reuses the active pending announcement draft for update_announcement follow-ups', async () => {
    vi.mocked(getLatestValidPendingAction).mockResolvedValue({
      id: '182ef2d1-3f77-4b24-88b8-75be9fbd9c50',
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      actionType: 'create_announcement',
      actionFields: {
        title: 'Dues Reminder',
        body: 'This is a reminder that dues still need to be paid.',
      },
      originalDraftPayload: {
        kind: 'announcement',
        title: 'Dues Reminder',
        body: 'This is a reminder that dues still need to be paid.',
      },
      currentPayload: {
        kind: 'announcement',
        title: 'Dues Reminder',
        body: 'This is a reminder that dues still need to be paid.',
      },
      status: 'pending',
      idempotencyKey: 'idem-existing',
      createdAt: '2026-04-23T18:00:00.000Z',
      expiresAt: '2099-04-23T19:00:00.000Z',
      resultEntityId: null,
      resultEntityType: null,
      resultMessage: null,
    });

    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...updateAnnouncementPlannerValue,
            action: { ...updateAnnouncementPlannerValue.action },
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
              title: 'Quick Dues Reminder',
              body: 'Please pay your dues this week.',
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
          title: 'Quick Dues Reminder',
          body: 'Please pay your dues this week.',
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
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      message: 'make it shorter',
      history: [
        {
          role: 'assistant',
          content:
            'assistant_state: draft_preview\nassistant_reply: Here is a draft announcement.\ndraft_payload: {"kind":"announcement","title":"Dues Reminder","body":"This is a reminder that dues still need to be paid."}\npending_action_id: 182ef2d1-3f77-4b24-88b8-75be9fbd9c50',
        },
      ],
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.pendingActionId).toBe('182ef2d1-3f77-4b24-88b8-75be9fbd9c50');
    expect(result.preview).toEqual({
      kind: 'announcement',
      title: 'Quick Dues Reminder',
      body: 'Please pay your dues this week.',
    });
    expect(createPendingAction).not.toHaveBeenCalled();
    expect(updatePendingActionPayload).toHaveBeenCalledWith({
      id: '182ef2d1-3f77-4b24-88b8-75be9fbd9c50',
      currentPayload: {
        kind: 'announcement',
        title: 'Quick Dues Reminder',
        body: 'Please pay your dues this week.',
      },
      actionFields: {
        title: 'Quick Dues Reminder',
        body: 'Please pay your dues this week.',
      },
    });
  });

  it('reuses the active pending message draft for update_message follow-ups and keeps recipients', async () => {
    vi.mocked(getLatestValidPendingAction).mockResolvedValue({
      id: '8d3a2f1d-20de-49db-a240-7925fdc4fb0a',
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      actionType: 'create_message',
      actionFields: {
        recipients: [{ email: 'alex@example.com', name: 'Alex' }],
        body: 'Please remember to bring your form tomorrow.',
      },
      originalDraftPayload: {
        kind: 'message',
        recipients: [{ email: 'alex@example.com', name: 'Alex' }],
        body: 'Please remember to bring your form tomorrow.',
      },
      currentPayload: {
        kind: 'message',
        recipients: [{ email: 'alex@example.com', name: 'Alex' }],
        body: 'Please remember to bring your form tomorrow.',
      },
      status: 'pending',
      idempotencyKey: 'idem-message',
      createdAt: '2026-04-23T18:00:00.000Z',
      expiresAt: '2099-04-23T19:00:00.000Z',
      resultEntityId: null,
      resultEntityType: null,
      resultMessage: null,
    });

    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...updateMessagePlannerValue,
            action: { ...updateMessagePlannerValue.action },
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
              body: 'Quick reminder to bring your form tomorrow.',
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
          kind: 'message',
          body: 'Quick reminder to bring your form tomorrow.',
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
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      message: 'make it shorter',
      history: [
        {
          role: 'assistant',
          content:
            'assistant_state: draft_preview\nassistant_reply: Here is a draft message.\ndraft_payload: {"kind":"message","recipients":[{"email":"alex@example.com","name":"Alex"}],"body":"Please remember to bring your form tomorrow."}\npending_action_id: 8d3a2f1d-20de-49db-a240-7925fdc4fb0a',
        },
      ],
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.pendingActionId).toBe('8d3a2f1d-20de-49db-a240-7925fdc4fb0a');
    expect(result.preview).toEqual({
      kind: 'message',
      recipients: [{ email: 'alex@example.com', name: 'Alex' }],
      body: 'Quick reminder to bring your form tomorrow.',
    });
    expect(createPendingAction).not.toHaveBeenCalled();
    expect(updatePendingActionPayload).toHaveBeenCalledWith({
      id: '8d3a2f1d-20de-49db-a240-7925fdc4fb0a',
      currentPayload: {
        kind: 'message',
        recipients: [{ email: 'alex@example.com', name: 'Alex' }],
        body: 'Quick reminder to bring your form tomorrow.',
      },
      actionFields: {
        recipients: [{ email: 'alex@example.com', name: 'Alex' }],
        body: 'Quick reminder to bring your form tomorrow.',
      },
    });
  });

  it('reuses the active pending email draft for update_email follow-ups and keeps the subject', async () => {
    vi.mocked(getLatestValidPendingAction).mockResolvedValue({
      id: '80f96c38-a1b7-4cbf-a8f0-56f1bb4f4ab0',
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      actionType: 'create_email',
      actionFields: {
        subject: 'ELA Test Reminder',
        body: 'Please remember the ELA test on April 30 and plan accordingly.',
      },
      originalDraftPayload: {
        kind: 'email',
        subject: 'ELA Test Reminder',
        body: 'Please remember the ELA test on April 30 and plan accordingly.',
      },
      currentPayload: {
        kind: 'email',
        subject: 'ELA Test Reminder',
        body: 'Please remember the ELA test on April 30 and plan accordingly.',
      },
      status: 'pending',
      idempotencyKey: 'idem-email',
      createdAt: '2026-04-23T18:00:00.000Z',
      expiresAt: '2099-04-23T19:00:00.000Z',
      resultEntityId: null,
      resultEntityType: null,
      resultMessage: null,
    });

    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...updateEmailPlannerValue,
            action: { ...updateEmailPlannerValue.action },
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
              subject: 'ELA Test Reminder',
              body: 'Quick reminder that the ELA test is April 30.',
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
          kind: 'email',
          body: 'Quick reminder that the ELA test is April 30.',
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
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      message: 'make it shorter',
      history: [
        {
          role: 'assistant',
          content:
            'assistant_state: draft_preview\nassistant_reply: Here is a draft email.\ndraft_payload: {"kind":"email","subject":"ELA Test Reminder","body":"Please remember the ELA test on April 30 and plan accordingly."}\npending_action_id: 80f96c38-a1b7-4cbf-a8f0-56f1bb4f4ab0',
        },
      ],
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    if (result.state !== 'draft_preview') {
      throw new Error('Expected draft preview result.');
    }

    expect(result.pendingActionId).toBe('80f96c38-a1b7-4cbf-a8f0-56f1bb4f4ab0');
    expect(result.preview).toEqual({
      kind: 'email',
      subject: 'ELA Test Reminder',
      body: 'Quick reminder that the ELA test is April 30.',
    });
    expect(createPendingAction).not.toHaveBeenCalled();
    expect(updatePendingActionPayload).toHaveBeenCalledWith({
      id: '80f96c38-a1b7-4cbf-a8f0-56f1bb4f4ab0',
      currentPayload: {
        kind: 'email',
        subject: 'ELA Test Reminder',
        body: 'Quick reminder that the ELA test is April 30.',
      },
      actionFields: {
        subject: 'ELA Test Reminder',
        body: 'Quick reminder that the ELA test is April 30.',
      },
    });
  });

  it('keeps an explicit targetRef update separate from the active draft', async () => {
    vi.mocked(getLatestValidPendingAction).mockResolvedValue({
      id: '182ef2d1-3f77-4b24-88b8-75be9fbd9c50',
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      userId: 'a68cbbdb-b8db-4f70-b5fc-28afbdbf8f87',
      orgId: '764eb6cf-af13-4929-b897-019b8d1e17d0',
      groupId: '0df3d166-7e79-4f91-bc34-2b3fa555445f',
      actionType: 'create_announcement',
      actionFields: {
        title: 'Draft Dues Reminder',
        body: 'Current draft body.',
      },
      originalDraftPayload: {
        kind: 'announcement',
        title: 'Draft Dues Reminder',
        body: 'Current draft body.',
      },
      currentPayload: {
        kind: 'announcement',
        title: 'Draft Dues Reminder',
        body: 'Current draft body.',
      },
      status: 'pending',
      idempotencyKey: 'idem-existing',
      createdAt: '2026-04-23T18:00:00.000Z',
      expiresAt: '2099-04-23T19:00:00.000Z',
      resultEntityId: null,
      resultEntityType: null,
      resultMessage: null,
    });

    vi.mocked(runLlmStepWithRetry).mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'planner') {
        return {
          ok: true,
          value: {
            ...updateAnnouncementPlannerValue,
            action: {
              ...updateAnnouncementPlannerValue.action,
              fieldsProvided: { targetRef: '18' },
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
            inferredFields: {
              body: 'Updated posted announcement body.',
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
          title: 'Board Elections',
          body: 'Updated posted announcement body.',
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
      conversationId: '6c35d83c-7d59-4e9e-9cab-37253097598a',
      message: 'update the board elections announcement',
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-23T18:00:00.000Z',
    });

    expect(result.state).toBe('draft_preview');
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'update_announcement',
        actionFields: expect.objectContaining({
          targetRef: '18',
        }),
      })
    );
    expect(updatePendingActionPayload).not.toHaveBeenCalled();
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
