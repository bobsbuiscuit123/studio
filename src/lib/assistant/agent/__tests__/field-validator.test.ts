import { describe, expect, it } from 'vitest';

import {
  buildFieldValidatorPrompt,
  FIELD_VALIDATOR_SYSTEM_PROMPT,
} from '@/lib/assistant/agent/field-validator-prompt';

describe('field validator prompt', () => {
  it('requires usable generated values for every requested field', () => {
    expect(FIELD_VALIDATOR_SYSTEM_PROMPT).toContain(
      'inferredFields must include a usable non-empty value for every field listed in fields_to_generate.'
    );
    expect(FIELD_VALIDATOR_SYSTEM_PROMPT).toContain(
      'Every generated field must be ready for downstream storage and draft assembly without extra interpretation.'
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
});
