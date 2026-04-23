import { describe, expect, it } from 'vitest';

import {
  announcementPatchSchema,
  assistantCommandSchema,
  eventPatchSchema,
  geminiFieldValidationResultSchema,
  messagePatchSchema,
} from '@/lib/assistant/agent/schemas';

describe('preview patch schemas', () => {
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

  it('parses strict Gemini field-validator payloads', () => {
    const parsed = geminiFieldValidationResultSchema.safeParse({
      inferredFields: {
        body: 'Reminder about dues',
      },
      usedInference: true,
      telemetry: {
        confidence: 0.74,
        modelMissingFields: ['title'],
      },
    });

    expect(parsed.success).toBe(true);
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
