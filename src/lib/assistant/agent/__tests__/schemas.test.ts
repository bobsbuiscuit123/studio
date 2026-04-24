import { describe, expect, it } from 'vitest';

import {
  announcementDraftPreviewSchema,
  announcementPatchSchema,
  assistantCommandSchema,
  eventPatchSchema,
  geminiFieldValidationResultSchema,
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
    const parsed = geminiFieldValidationResultSchema.safeParse({
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
