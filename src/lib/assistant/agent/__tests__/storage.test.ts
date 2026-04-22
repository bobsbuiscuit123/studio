import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_STORAGE_UNAVAILABLE_MESSAGE,
  buildAssistantStorageUnavailableTurn,
  isAssistantStorageMissingError,
} from '@/lib/assistant/agent/storage';

describe('assistant storage readiness', () => {
  it('detects missing assistant tables from schema cache errors', () => {
    expect(
      isAssistantStorageMissingError({
        code: 'PGRST205',
        message:
          "Could not find the table 'public.assistant_conversations' in the schema cache",
      })
    ).toBe(true);
  });

  it('detects missing assistant columns from postgres errors', () => {
    expect(
      isAssistantStorageMissingError({
        code: '42703',
        message:
          'column assistant_pending_actions.action_fields does not exist',
      })
    ).toBe(true);
  });

  it('builds a terminal assistant error turn', () => {
    expect(
      buildAssistantStorageUnavailableTurn({
        conversationId: 'conversation-1',
        turnId: 'turn-1',
      })
    ).toEqual({
      state: 'error',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      message: ASSISTANT_STORAGE_UNAVAILABLE_MESSAGE,
      retryCount: 0,
      timeoutFlag: false,
    });
  });
});
