import { describe, expect, it } from 'vitest';

import { evaluateRequiredFields } from '@/lib/assistant/agent/requirements';

describe('evaluateRequiredFields', () => {
  it('requires date and time for create_event', () => {
    const result = evaluateRequiredFields('create_event', {
      title: 'Election Night',
    });

    expect(result.missingFields).toEqual(['date', 'time']);
    expect(result.clarificationMessage).toBe(
      'What date and time should this event be scheduled for?'
    );
  });

  it('requires recipients for create_message', () => {
    const result = evaluateRequiredFields('create_message', {
      body: 'Hello team',
    });

    expect(result.missingFields).toEqual(['recipients']);
    expect(result.clarificationMessage).toBe('Who should receive this message?');
  });

  it('accepts announcements with either title or body', () => {
    const result = evaluateRequiredFields('create_announcement', {
      title: 'Volunteer Day',
    });

    expect(result.missingFields).toEqual([]);
    expect(result.clarificationMessage).toBeNull();
  });
});
