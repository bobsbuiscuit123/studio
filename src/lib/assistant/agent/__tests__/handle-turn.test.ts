import { describe, expect, it, vi } from 'vitest';

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
  generateDraftPreview: vi.fn().mockResolvedValue({
    kind: 'announcement',
    body: 'Reminder that dues are due this week.',
  }),
}));

vi.mock('@/lib/assistant/agent/executor', () => ({
  executePendingAction: vi.fn(),
}));

vi.mock('@/lib/assistant/agent/retry', () => ({
  runLlmStepWithRetry: vi.fn(async ({ step }: { step: string }) => {
    if (step === 'planner') {
      return {
        ok: true,
        value: {
          intent: 'draft_action',
          summary: 'Draft an announcement.',
          needsRetrieval: false,
          action: {
            type: 'create_announcement',
            fieldsProvided: {},
            fieldsMissing: [],
            requiresPreview: true,
            requiresConfirmation: true,
          },
          confidence: 0.9,
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
  }),
}));

import { createPendingAction } from '@/lib/assistant/agent/pending-actions';
import { handleAssistantTurn } from '@/lib/assistant/agent/handle-turn';

describe('handleAssistantTurn', () => {
  it('preserves deterministic behavior when the Gemini field validator fails', async () => {
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
          body: 'reminding them to pay dues',
        }),
      })
    );
  });
});
