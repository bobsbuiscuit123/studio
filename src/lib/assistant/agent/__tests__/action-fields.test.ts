import { describe, expect, it } from 'vitest';

import {
  fillGeneratedActionFields,
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

const applyValidatorResultWithDefaults = (
  result: GeminiFieldValidationResult,
  overrides?: {
    actionType?: Parameters<typeof mergeInferredActionFields>[0]['actionType'];
    resolvedActionFields?: Parameters<typeof mergeInferredActionFields>[0]['resolvedActionFields'];
    userMessage?: string;
    recentHistory?: Parameters<typeof mergeInferredActionFields>[0]['recentHistory'];
    requestTimezone?: string;
    requestReceivedAt?: string;
  }
) => {
  const merged = applyValidatorResult(result, overrides);
  return fillGeneratedActionFields({
    actionType: overrides?.actionType ?? 'create_announcement',
    actionFields: merged.mergedFields,
    userMessage: overrides?.userMessage ?? 'send an announcement reminding everyone to pay dues',
    recentHistory: overrides?.recentHistory,
    requestTimezone: overrides?.requestTimezone ?? DEFAULT_TIMEZONE,
    requestReceivedAt: overrides?.requestReceivedAt ?? BEFORE_EVENING,
  });
};

describe('action field resolution', () => {
  it('requires members retrieval for create_message', () => {
    expect(getActionRequiredRetrievalResources('create_message')).toEqual(['members']);
  });

  it('requires members retrieval for update_message', () => {
    expect(getActionRequiredRetrievalResources('update_message')).toEqual(['members']);
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

  it('resolves updated recipients against retrieved members for update_message', () => {
    const fields = resolveActionFields({
      actionType: 'update_message',
      fieldsProvided: {
        recipients: ['Alice Smith'],
      },
      message: 'also send it to Alice Smith',
      retrieval: {
        context: {
          members: [
            { name: 'Alice Smith', email: 'alice@example.com' },
          ],
        },
        usedEntities: ['members'],
      },
    });

    expect(fields.recipients).toEqual([
      { email: 'alice@example.com', name: 'Alice Smith' },
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
    const filled = applyValidatorResultWithDefaults({
      inferredFields: {
        title: 'Dues Reminder',
        body: 'Reminder that dues are still outstanding.',
      },
      missingFields: [],
      usedInference: true,
    });

    const required = evaluateRequiredFields('create_announcement', filled.filledFields);
    expect(required.missingFields).toEqual([]);
  });

  it('ignores Gemini confidence for gating', () => {
    const lowConfidence = applyValidatorResult({
      inferredFields: {
        title: 'Dues Reminder',
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
        title: 'Dues Reminder',
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
    const filled = applyValidatorResultWithDefaults(
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

    expect(filled.filledFields.body).toBe('User body');
  });

  it('never overwrites deterministically resolved recipients or targets', () => {
    const filledMessage = applyValidatorResultWithDefaults(
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

    const filledUpdate = applyValidatorResultWithDefaults(
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

    expect(filledMessage.filledFields.recipients).toEqual([{ email: 'resolved@example.com' }]);
    expect(filledUpdate.filledFields.targetRef).toBe('resolved-target');
  });

  it('drops disallowed inferred fields', () => {
    const filled = applyValidatorResultWithDefaults(
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

    expect(filled.filledFields).toEqual({
      body: 'Hello team',
    });
  });

  it('keeps Gemini-provided event date and time fields after format normalization', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {
          date: '2026-04-30',
          time: '7:00 PM',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections on the 30th at 7',
      }
    );

    expect(filled.filledFields.date).toBe('2026-04-30');
    expect(filled.filledFields.time).toBe('19:00');
  });

  it('accepts Gemini-resolved ordinal dates without re-inferring them from the raw request', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {
          date: '2026-04-30',
          time: '18:00',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'put an ela test on the 30th on the calendar',
      }
    );

    expect(filled.filledFields.date).toBe('2026-04-30');
    expect(filled.filledFields.time).toBe('18:00');
  });

  it('backfills create_event scheduling fields when the validator returns nothing', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {},
        missingFields: [],
        usedInference: false,
      },
      {
        actionType: 'create_event',
        userMessage: 'put an ela test on the 30th on the calendar',
        requestTimezone: 'America/New_York',
        requestReceivedAt: '2026-04-26T16:59:00.000Z',
      }
    );

    expect(filled.filledFields.date).toBe('2026-04-30');
    expect(filled.filledFields.time).toBe('18:00');
    expect(filled.filledFields.location).toBe('TBD');
    expect(typeof filled.filledFields.title).toBe('string');
    expect(String(filled.filledFields.title).trim().length).toBeGreaterThan(0);
    expect(typeof filled.filledFields.description).toBe('string');
    expect(String(filled.filledFields.description).trim().length).toBeGreaterThan(0);

    const required = evaluateRequiredFields('create_event', filled.filledFields);
    expect(required.missingFields).toEqual([]);
  });

  it('strips assistant prompt scaffolding from fallback event copy', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {},
        missingFields: [],
        usedInference: false,
      },
      {
        actionType: 'create_event',
        userMessage: 'Create an event regarding the following: ela test on the 30h',
        requestTimezone: 'America/New_York',
        requestReceivedAt: '2026-04-26T16:59:00.000Z',
      }
    );

    expect(filled.filledFields.title).toBe('ELA Test');
    expect(String(filled.filledFields.description).toLowerCase()).not.toContain('following');
    expect(String(filled.filledFields.description)).not.toContain('30h');
    expect(filled.filledFields.date).toBe('2026-04-30');
  });

  it('uses prior user context to fill create_event scheduling follow-ups', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {},
        missingFields: [],
        usedInference: false,
      },
      {
        actionType: 'create_event',
        userMessage: 'at 7',
        recentHistory: [
          { role: 'user', content: 'put an ela test on the 30th on the calendar' },
          { role: 'assistant', content: 'AI is temporarily unavailable. Please try again later.' },
        ],
        requestTimezone: 'America/New_York',
        requestReceivedAt: '2026-04-26T16:59:00.000Z',
      }
    );

    expect(filled.filledFields.date).toBe('2026-04-30');
    expect(filled.filledFields.time).toBe('19:00');
    expect(filled.filledFields.location).toBe('TBD');
    expect(typeof filled.filledFields.title).toBe('string');
    expect(String(filled.filledFields.title).trim().length).toBeGreaterThan(0);
    expect(typeof filled.filledFields.description).toBe('string');
    expect(String(filled.filledFields.description).trim().length).toBeGreaterThan(0);
  });

  it('does not backfill announcement copy when the validator returns nothing', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {},
        missingFields: [],
        usedInference: false,
      },
      {
        userMessage: 'remind everyone in an announcement that they need to pay their dues',
      }
    );

    expect(filled.filledFields).toEqual({});
    expect(evaluateRequiredFields('create_announcement', filled.filledFields).missingFields).toEqual([
      'title',
      'body',
    ]);
  });

  it('does not backfill message copy when the validator returns nothing', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {},
        missingFields: [],
        usedInference: false,
      },
      {
        actionType: 'create_message',
        resolvedActionFields: {
          recipients: [{ email: 'alex@example.com' }],
        },
        userMessage: 'send Alex a reminder about dues',
      }
    );

    expect(filled.filledFields).toEqual({
      recipients: [{ email: 'alex@example.com' }],
    });
    expect(evaluateRequiredFields('create_message', filled.filledFields).missingFields).toEqual(['body']);
  });
});

describe('normalizeInferredField', () => {
  it('normalizes Gemini time strings without re-inferring them from chat history', () => {
    const result = normalizeInferredField({
      actionType: 'create_event',
      field: 'time',
      value: '7:00 PM',
      userMessage: 'at 7',
      recentHistory: [
        { role: 'assistant', content: 'AI is temporarily unavailable. Please try again later.' },
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

  it('accepts canonical Gemini date keys directly', () => {
    const result = normalizeInferredField({
      actionType: 'create_event',
      field: 'date',
      value: '2026-04-30',
      userMessage: 'put an ela test on the 30th on the calendar',
      requestTimezone: DEFAULT_TIMEZONE,
      requestReceivedAt: BEFORE_EVENING,
    });

    expect(result).toEqual({
      ok: true,
      value: '2026-04-30',
    });
  });
});
