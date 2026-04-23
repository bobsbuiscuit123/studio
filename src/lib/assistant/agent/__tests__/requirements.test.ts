import { describe, expect, it } from 'vitest';

import {
  evaluateRequiredFields,
  evaluateStructuralRequiredFields,
} from '@/lib/assistant/agent/requirements';

describe('evaluateRequiredFields', () => {
  it('requires recipients before validating a message draft', () => {
    const result = evaluateStructuralRequiredFields('create_message', {
      body: 'Hello team',
    });

    expect(result.missingFields).toEqual(['recipients']);
    expect(result.clarificationMessage).toBe('Who should receive this message?');
  });

  it('requires date and time for a completed create_event payload', () => {
    const result = evaluateRequiredFields('create_event', {
      title: 'Election Night',
    });

    expect(result.missingFields).toEqual(['date', 'time']);
    expect(result.clarificationMessage).toBe(
      'What date and time should this event be scheduled for?'
    );
  });

  it('requires body for a completed create_message payload', () => {
    const result = evaluateRequiredFields('create_message', {
      recipients: [{ email: 'team@example.com' }],
    });

    expect(result.missingFields).toEqual(['body']);
    expect(result.clarificationMessage).toBe('What should this message say?');
  });

  it('accepts announcements with either title or body', () => {
    const result = evaluateRequiredFields('create_announcement', {
      title: 'Volunteer Day',
    });

    expect(result.missingFields).toEqual([]);
    expect(result.clarificationMessage).toBeNull();
  });

  it('requires actual update content for update_event payloads', () => {
    const result = evaluateRequiredFields('update_event', {
      targetRef: 'evt-1',
    });

    expect(result.missingFields).toEqual(['title', 'description', 'date', 'time', 'location']);
    expect(result.clarificationMessage).toBe('What should I change in this event?');
  });
});
