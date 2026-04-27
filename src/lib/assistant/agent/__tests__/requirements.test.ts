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
    expect(result.clarificationMessage).toBe('Missing message recipients.');
  });

  it('requires date and time for a completed create_event payload', () => {
    const result = evaluateRequiredFields('create_event', {
      title: 'Election Night',
    });

    expect(result.missingFields).toEqual(['date', 'time']);
    expect(result.clarificationMessage).toBe('Missing event date and time.');
  });

  it('requires body for a completed create_message payload', () => {
    const result = evaluateRequiredFields('create_message', {
      recipients: [{ email: 'team@example.com' }],
    });

    expect(result.missingFields).toEqual(['body']);
    expect(result.clarificationMessage).toBe('Missing message body.');
  });

  it('allows update_message payloads when recipients are preserved but only the audience changes', () => {
    const result = evaluateRequiredFields('update_message', {
      recipients: [{ email: 'team@example.com' }],
    });

    expect(result.missingFields).toEqual([]);
    expect(result.clarificationMessage).toBeNull();
  });

  it('requires subject and body for a completed create_email payload', () => {
    const result = evaluateRequiredFields('create_email', {});

    expect(result.missingFields).toEqual(['subject', 'body']);
    expect(result.clarificationMessage).toBe('Missing email subject and body.');
  });

  it('requires actual edit content for update_email payloads', () => {
    const result = evaluateRequiredFields('update_email', {});

    expect(result.missingFields).toEqual(['subject', 'body']);
    expect(result.clarificationMessage).toBe('Missing email update content.');
  });

  it('requires both title and body for create announcements', () => {
    const result = evaluateRequiredFields('create_announcement', {
      title: 'Volunteer Day',
    });

    expect(result.missingFields).toEqual(['body']);
    expect(result.clarificationMessage).toBe('Missing announcement body.');
  });

  it('accepts announcements when both title and body are present', () => {
    const result = evaluateRequiredFields('create_announcement', {
      title: 'Volunteer Day',
      body: 'Please join us for volunteer day on Saturday.',
    });

    expect(result.missingFields).toEqual([]);
    expect(result.clarificationMessage).toBeNull();
  });

  it('requires actual update content for update_event payloads', () => {
    const result = evaluateRequiredFields('update_event', {
      targetRef: 'evt-1',
    });

    expect(result.missingFields).toEqual(['title', 'description', 'date', 'time', 'location']);
    expect(result.clarificationMessage).toBe('Missing event update content.');
  });
});
