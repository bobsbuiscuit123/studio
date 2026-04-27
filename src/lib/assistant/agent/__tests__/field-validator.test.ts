import { describe, expect, it, vi } from 'vitest';

vi.mock('@/ai/genkit', () => ({
  callAI: vi.fn(),
}));

import {
  buildFieldValidatorPrompt,
  FIELD_VALIDATOR_SYSTEM_PROMPT,
} from '@/lib/assistant/agent/field-validator-prompt';
import { validateGeminiGeneratedFields } from '@/lib/assistant/agent/field-validator';

describe('field validator prompt', () => {
  it('requires usable generated values for every requested field', () => {
    expect(FIELD_VALIDATOR_SYSTEM_PROMPT).toContain(
      'inferredFields must include a usable non-empty value for every field listed in fields_to_generate.'
    );
    expect(FIELD_VALIDATOR_SYSTEM_PROMPT).toContain(
      'Every generated field must be ready for downstream storage and draft assembly without extra interpretation.'
    );
    expect(FIELD_VALIDATOR_SYSTEM_PROMPT).toContain(
      'Never ask the user a follow-up question for Gemini-owned fields; choose a reasonable editable default instead.'
    );
  });

  it('includes strict stored-format instructions for event dates and times', () => {
    const prompt = buildFieldValidatorPrompt({
      actionType: 'create_event',
      userMessage: 'add an ela test on the calendar on the 30th',
      resolvedActionFields: {},
      requestTimezone: 'America/New_York',
      requestReceivedAt: '2026-04-26T16:59:00.000Z',
    });

    expect(prompt).toContain('action_field_contract: Event field contract:');
    expect(prompt).toContain('inferredFields.date must always be a concrete calendar date in exact YYYY-MM-DD format');
    expect(prompt).toContain('inferredFields.time must always be a concrete local time in exact HH:MM 24-hour format');
    expect(prompt).toContain('Never return natural-language dates or times such as "April 30", "the 30th"');
    expect(prompt).toContain('If the user gives a day without a time, choose a reasonable editable time');
  });

  it('extracts app launcher scaffolding into a semantic content hint', () => {
    const prompt = buildFieldValidatorPrompt({
      actionType: 'create_announcement',
      userMessage: 'Make and send an announcement regarding the following: ela teest on 30th',
      resolvedActionFields: {},
      requestTimezone: 'America/Chicago',
      requestReceivedAt: '2026-04-27T16:30:00.000Z',
    });

    expect(prompt).toContain('user_content_hint: ela teest on 30th');
    expect(FIELD_VALIDATOR_SYSTEM_PROMPT).toContain(
      'Never include phrases like "regarding the following", "following:", "the following", "create event", "create announcement", or "make and send" in user-facing fields'
    );
    expect(FIELD_VALIDATOR_SYSTEM_PROMPT).toContain(
      'Fix obvious typos and casing in final field values when the intent is clear'
    );
  });

  it('rejects missing generated fields before downstream fallback can invent them', () => {
    expect(validateGeminiGeneratedFields('create_announcement', { title: 'ELA Test' })).toEqual({
      ok: false,
      missingFields: ['body'],
      invalidFields: [],
    });
  });

  it('rejects malformed event dates and times', () => {
    expect(
      validateGeminiGeneratedFields('create_event', {
        title: 'ELA Test',
        description: 'Prepare for the ELA test.',
        location: 'TBD',
        date: 'April 30',
        time: '6pm',
      })
    ).toEqual({
      ok: false,
      missingFields: [],
      invalidFields: ['date', 'time'],
    });
  });

  it('rejects copied action scaffolding in user-facing generated fields', () => {
    expect(
      validateGeminiGeneratedFields('create_event', {
        title: 'Create Event ELA Test',
        description: 'Prepare for the ELA test.',
        location: 'TBD',
        date: '2026-04-30',
        time: '18:00',
      })
    ).toEqual({
      ok: false,
      missingFields: [],
      invalidFields: ['title'],
    });

    expect(
      validateGeminiGeneratedFields('create_announcement', {
        title: 'Following: ELA Test',
        body: 'Please prepare for the ELA test.',
      })
    ).toEqual({
      ok: false,
      missingFields: [],
      invalidFields: ['title'],
    });
  });
});
