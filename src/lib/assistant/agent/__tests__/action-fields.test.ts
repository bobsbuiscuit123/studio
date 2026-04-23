import { describe, expect, it } from 'vitest';

import {
  getActionRequiredRetrievalResources,
  mergeInferredActionFields,
  normalizeInferredField,
  resolveActionFields,
} from '@/lib/assistant/agent/action-fields';
import type { GeminiFieldValidationResult } from '@/lib/assistant/agent/types';
import { evaluateRequiredFields } from '@/lib/assistant/agent/requirements';

const DEFAULT_TIMEZONE = 'America/Chicago';
const BEFORE_EVENING = '2026-04-23T18:00:00.000Z';
const AFTER_EVENING = '2026-04-24T01:30:00.000Z';

const applyValidatorResult = (result: GeminiFieldValidationResult, overrides?: {
  actionType?: Parameters<typeof mergeInferredActionFields>[0]['actionType'];
  resolvedActionFields?: Parameters<typeof mergeInferredActionFields>[0]['resolvedActionFields'];
  userMessage?: string;
  recentHistory?: Parameters<typeof mergeInferredActionFields>[0]['recentHistory'];
  requestTimezone?: string;
  requestReceivedAt?: string;
}) =>
  mergeInferredActionFields({
    actionType: overrides?.actionType ?? 'create_announcement',
    resolvedActionFields: overrides?.resolvedActionFields ?? {},
    inferredFields: result.inferredFields,
    userMessage: overrides?.userMessage ?? 'send an announcement reminding everyone to pay dues',
    recentHistory: overrides?.recentHistory,
    requestTimezone: overrides?.requestTimezone ?? DEFAULT_TIMEZONE,
    requestReceivedAt: overrides?.requestReceivedAt ?? BEFORE_EVENING,
  });

describe('action field resolution', () => {
  it('requires members retrieval for create_message', () => {
    expect(getActionRequiredRetrievalResources('create_message')).toEqual(['members']);
  });

  it('resolves a unique event target from retrieved titles', () => {
    const fields = resolveActionFields({
      actionType: 'update_event',
      fieldsProvided: {},
      message: 'Update Spring Election Night to start at 7:00 PM',
      retrieval: {
        context: {
          events: [
            { id: 'evt-1', title: 'Spring Election Night' },
            { id: 'evt-2', title: 'Budget Review' },
          ],
        },
        usedEntities: ['events'],
      },
    });

    expect(fields.targetRef).toBe('evt-1');
  });

  it('does not accept a non-matching update target when retrieval data exists', () => {
    const fields = resolveActionFields({
      actionType: 'update_announcement',
      fieldsProvided: {
        targetRef: 'Something Else',
      },
      message: 'Update the volunteer announcement',
      retrieval: {
        context: {
          announcements: [{ id: '12', title: 'Volunteer Signup' }],
        },
        usedEntities: ['announcements'],
      },
    });

    expect(fields.targetRef).toBeUndefined();
  });

  it('resolves recipient names against retrieved members', () => {
    const fields = resolveActionFields({
      actionType: 'create_message',
      fieldsProvided: {
        recipients: ['Alice Smith', 'bob@example.com'],
      },
      message: 'Send Alice and Bob the budget note',
      retrieval: {
        context: {
          members: [
            { name: 'Alice Smith', email: 'alice@example.com' },
            { name: 'Bob Jones', email: 'bob@example.com' },
          ],
        },
        usedEntities: ['members'],
      },
    });

    expect(fields.recipients).toEqual([
      { email: 'alice@example.com', name: 'Alice Smith' },
      { email: 'bob@example.com' },
    ]);
  });

  it('leaves Gemini-owned announcement fields unset for validator generation', () => {
    const fields = resolveActionFields({
      actionType: 'create_announcement',
      fieldsProvided: {
        title: 'Dues Reminder',
        body: 'Please pay your dues this week.',
      },
      message: 'reminding them to pay dues',
      retrieval: {
        context: {},
        usedEntities: [],
      },
    });

    expect(fields).toEqual({});
  });

  it('keeps structural target refs while stripping Gemini-owned update fields', () => {
    const fields = resolveActionFields({
      actionType: 'update_announcement',
      fieldsProvided: {
        targetRef: '12',
        body: 'Updated announcement body',
      },
      message: 'update announcement 12',
      retrieval: {
        context: {},
        usedEntities: [],
      },
    });

    expect(fields).toEqual({
      targetRef: '12',
    });
  });
});

describe('Gemini authoritative field merging', () => {
  it('accepts Gemini-generated announcement fields for gating', () => {
    const merged = applyValidatorResult({
      inferredFields: {
        body: 'Reminder that dues are still outstanding.',
      },
      missingFields: [],
      usedInference: true,
    });

    const required = evaluateRequiredFields('create_announcement', merged.mergedFields);
    expect(required.missingFields).toEqual([]);
  });

  it('ignores Gemini confidence for gating', () => {
    const lowConfidence = applyValidatorResult({
      inferredFields: {
        body: 'Reminder that dues are still outstanding.',
      },
      missingFields: [],
      usedInference: true,
      telemetry: {
        confidence: 0.01,
      },
    });

    const highConfidence = applyValidatorResult({
      inferredFields: {
        body: 'Reminder that dues are still outstanding.',
      },
      missingFields: [],
      usedInference: true,
      telemetry: {
        confidence: 0.99,
      },
    });

    expect(lowConfidence).toEqual(highConfidence);
  });

  it('never overwrites user-provided fields', () => {
    const merged = applyValidatorResult(
      {
        inferredFields: {
          body: 'AI body',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        resolvedActionFields: {
          body: 'User body',
        },
      }
    );

    expect(merged.mergedFields.body).toBe('User body');
  });

  it('never overwrites deterministically resolved recipients or targets', () => {
    const mergedMessage = applyValidatorResult(
      {
        inferredFields: {
          body: 'AI body',
          recipients: [{ email: 'x@example.com' }],
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_message',
        resolvedActionFields: {
          recipients: [{ email: 'resolved@example.com' }],
        },
        userMessage: 'send them a reminder',
      }
    );

    const mergedUpdate = applyValidatorResult(
      {
        inferredFields: {
          title: 'Updated title',
          targetRef: 'ai-target',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'update_event',
        resolvedActionFields: {
          targetRef: 'resolved-target',
        },
        userMessage: 'update the election event tomorrow at 7',
      }
    );

    expect(mergedMessage.mergedFields.recipients).toEqual([{ email: 'resolved@example.com' }]);
    expect(mergedUpdate.mergedFields.targetRef).toBe('resolved-target');
  });

  it('drops disallowed inferred fields', () => {
    const merged = applyValidatorResult(
      {
        inferredFields: {
          recipients: [{ email: 'x@example.com' }],
          targetRef: 'event-1',
          body: 'Hello team',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_message',
        userMessage: 'write a message about dues',
      }
    );

    expect(merged.mergedFields).toEqual({
      body: 'Hello team',
    });
  });

  it('infers event date and time for tomorrow at 7', () => {
    const merged = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections tomorrow at 7',
      }
    );

    expect(merged.mergedFields.date).toBe('2026-04-24');
    expect(merged.mergedFields.time).toBe('19:00');
  });

  it('infers event date and default evening time for next Friday evening', () => {
    const merged = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections next Friday evening',
      }
    );

    expect(merged.mergedFields.date).toBe('2026-04-24');
    expect(merged.mergedFields.time).toBe('19:00');
  });

  it('keeps clarification path for this Friday without time', () => {
    const merged = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections this Friday',
      }
    );

    expect(merged.mergedFields.date).toBe('2026-04-24');
    expect(merged.mergedFields.time).toBeUndefined();

    const required = evaluateRequiredFields('create_event', merged.mergedFields);
    expect(required.missingFields).toEqual(['time']);
  });

  it('infers tonight only when evening is still upcoming', () => {
    const upcoming = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections tonight',
        requestReceivedAt: BEFORE_EVENING,
      }
    );

    const late = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections tonight',
        requestReceivedAt: AFTER_EVENING,
      }
    );

    expect(upcoming.mergedFields.date).toBe('2026-04-23');
    expect(upcoming.mergedFields.time).toBe('19:00');
    expect(late.mergedFields.date).toBeUndefined();
    expect(late.mergedFields.time).toBeUndefined();
  });

  it('infers this evening only when evening is still upcoming', () => {
    const upcoming = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections this evening',
        requestReceivedAt: BEFORE_EVENING,
      }
    );

    const late = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections this evening',
        requestReceivedAt: AFTER_EVENING,
      }
    );

    expect(upcoming.mergedFields.date).toBe('2026-04-23');
    expect(upcoming.mergedFields.time).toBe('19:00');
    expect(late.mergedFields.date).toBeUndefined();
    expect(late.mergedFields.time).toBeUndefined();
  });

  it('falls back to clarification for this weekend', () => {
    const merged = applyValidatorResult(
      {
        inferredFields: {
          date: 'candidate-date',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections this weekend',
      }
    );

    expect(merged.mergedFields.date).toBeUndefined();
    expect(merged.mergedFields.time).toBeUndefined();
  });
});

describe('normalizeInferredField', () => {
  it('supports recent-history continuation for time enrichment', () => {
    const result = normalizeInferredField({
      actionType: 'create_event',
      field: 'time',
      value: '7:00 PM',
      userMessage: 'at 7',
      recentHistory: [
        { role: 'assistant', content: 'What date and time should this event be scheduled for?' },
        { role: 'user', content: 'tomorrow' },
      ],
      requestTimezone: DEFAULT_TIMEZONE,
      requestReceivedAt: BEFORE_EVENING,
    });

    expect(result).toEqual({
      ok: true,
      value: '19:00',
    });
  });
});
