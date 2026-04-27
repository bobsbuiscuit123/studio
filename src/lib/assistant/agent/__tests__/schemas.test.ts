import { describe, expect, it } from 'vitest';

import {
  announcementDraftPreviewSchema,
  announcementPatchSchema,
  assistantCommandSchema,
  emailDraftPreviewSchema,
  emailPatchSchema,
  eventPatchSchema,
  geminiFieldValidationResultSchema,
  getGeminiFieldValidationResultSchema,
  messagePatchSchema,
} from '@/lib/assistant/agent/schemas';

describe('preview patch schemas', () => {
  it('parses assistant draft previews with a stable discriminator', () => {
    const parsed = announcementDraftPreviewSchema.safeParse({
      kind: 'announcement',
      title: 'Spring fundraiser',
      body: 'Please join us after school.',
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects unknown announcement patch keys', () => {
    const parsed = announcementPatchSchema.safeParse({
      title: 'Hello',
      unsafe: 'nope',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects unknown event patch keys', () => {
    const parsed = eventPatchSchema.safeParse({
      date: '2026-11-04',
      location: 'Gym',
      extra: true,
    });

    expect(parsed.success).toBe(false);
  });

  it('parses email draft previews with a stable discriminator', () => {
    const parsed = emailDraftPreviewSchema.safeParse({
      kind: 'email',
      subject: 'Bake Sale Reminder',
      body: 'Please stop by the bake sale after school.',
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects unknown email patch keys', () => {
    const parsed = emailPatchSchema.safeParse({
      subject: 'Hello',
      unsafe: 'nope',
    });

    expect(parsed.success).toBe(false);
  });

  it('requires valid recipient arrays for message patches', () => {
    const parsed = messagePatchSchema.safeParse({
      recipients: [{ email: 'not-an-email' }],
    });

    expect(parsed.success).toBe(false);
  });

  it('parses strict edit_preview commands', () => {
    const parsed = assistantCommandSchema.safeParse({
      kind: 'edit_preview',
      pendingActionId: '182ef2d1-3f77-4b24-88b8-75be9fbd9c50',
      preview: {
        kind: 'announcement',
        patch: {
          body: 'Updated body',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses confirm commands that include a preview patch', () => {
    const parsed = assistantCommandSchema.safeParse({
      kind: 'confirm',
      pendingActionId: '182ef2d1-3f77-4b24-88b8-75be9fbd9c50',
      preview: {
        kind: 'announcement',
        patch: {
          body: 'Updated body',
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses strict Gemini field-validator payloads', () => {
    const parsed = getGeminiFieldValidationResultSchema('create_message').safeParse({
      inferredFields: {
        body: 'Reminder about dues',
      },
      missingFields: [],
      usedInference: true,
      clarificationMessage: undefined,
      telemetry: {
        confidence: 0.74,
        notes: ['Used recent dues reminder context.'],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('requires action-specific Gemini-generated fields', () => {
    const parsed = getGeminiFieldValidationResultSchema('create_announcement').safeParse({
      inferredFields: {
        body: 'Reminder about dues',
      },
      missingFields: [],
      usedInference: true,
    });

    expect(parsed.success).toBe(false);
  });

  it('requires stored-format Gemini-generated event dates and times', () => {
    const parsed = getGeminiFieldValidationResultSchema('create_event').safeParse({
      inferredFields: {
        title: 'ELA Test',
        description: 'Prepare for the ELA test.',
        location: 'TBD',
        date: 'April 30',
        time: '6pm',
      },
      missingFields: [],
      usedInference: true,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects Gemini validator payloads that try to change action routing', () => {
    const parsed = geminiFieldValidationResultSchema.safeParse({
      inferredFields: {
        body: 'Reminder about dues',
      },
      usedInference: true,
      actionType: 'create_event',
      intent: 'execute_action',
    });

    expect(parsed.success).toBe(false);
  });
});
