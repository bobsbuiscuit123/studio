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

  it('infers event date and time for tomorrow at 7', () => {
    const filled = applyValidatorResultWithDefaults(
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

    expect(filled.filledFields.date).toBe('2026-04-24');
    expect(filled.filledFields.time).toBe('19:00');
  });

  it('infers event date and default evening time for next Friday evening', () => {
    const filled = applyValidatorResultWithDefaults(
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

    expect(filled.filledFields.date).toBe('2026-04-24');
    expect(filled.filledFields.time).toBe('19:00');
  });

  it('fills a default event time when the request gives only a date', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {
          date: 'candidate-date',
        },
        missingFields: [],
        usedInference: true,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections this Friday',
      }
    );

    expect(filled.filledFields.date).toBe('2026-04-24');
    expect(filled.filledFields.time).toBe('18:00');

    const required = evaluateRequiredFields('create_event', filled.filledFields);
    expect(required.missingFields).toEqual([]);
  });

  it('infers tonight only when evening is still upcoming', () => {
    const upcoming = applyValidatorResultWithDefaults(
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

    const late = applyValidatorResultWithDefaults(
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

    expect(upcoming.filledFields.date).toBe('2026-04-23');
    expect(upcoming.filledFields.time).toBe('19:00');
    expect(late.filledFields.date).toBe('2026-04-24');
    expect(late.filledFields.time).toBe('18:00');
  });

  it('infers this evening only when evening is still upcoming', () => {
    const upcoming = applyValidatorResultWithDefaults(
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

    const late = applyValidatorResultWithDefaults(
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

    expect(upcoming.filledFields.date).toBe('2026-04-23');
    expect(upcoming.filledFields.time).toBe('19:00');
    expect(late.filledFields.date).toBe('2026-04-24');
    expect(late.filledFields.time).toBe('18:00');
  });

  it('fills event defaults for an underspecified weekend request', () => {
    const filled = applyValidatorResultWithDefaults(
      {
        inferredFields: {},
        missingFields: [],
        usedInference: false,
      },
      {
        actionType: 'create_event',
        userMessage: 'create event for elections this weekend',
      }
    );

    expect(filled.filledFields.date).toBe('2026-04-24');
    expect(filled.filledFields.time).toBe('18:00');
    expect(filled.filledFields.location).toBe('TBD');
  });

  it('backfills announcement copy when the validator returns nothing', () => {
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

    expect(filled.filledFields).toEqual({
      title: 'Dues Reminder',
      body:
        'This is a reminder that dues still need to be paid. Please submit your dues as soon as possible. Thank you.',
    });
  });

  it('backfills message copy when the validator returns nothing', () => {
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
      body:
        'Just a quick reminder that dues are still due. Please submit yours when you can. Thank you.',
    });
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
