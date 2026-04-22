import { createSupabaseAdmin } from '@/lib/supabase/admin';
import type { AssistantTurnResponse } from '@/lib/assistant/agent/types';

const ASSISTANT_STORAGE_TABLE_NAMES = [
  'assistant_conversations',
  'assistant_turns',
  'assistant_pending_actions',
  'assistant_action_logs',
] as const;

export const ASSISTANT_STORAGE_UNAVAILABLE_MESSAGE =
  'Assistant setup is incomplete. Apply the latest Supabase database patches and try again.';

const getErrorText = (error: unknown) => {
  if (!error) return '';
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  if (typeof error === 'object') {
    const message = 'message' in error ? String(error.message ?? '') : '';
    const details = 'details' in error ? String(error.details ?? '') : '';
    const hint = 'hint' in error ? String(error.hint ?? '') : '';
    const code = 'code' in error ? String(error.code ?? '') : '';
    return `${message} ${details} ${hint} ${code}`.toLowerCase();
  }
  return String(error).toLowerCase();
};

export const isAssistantStorageMissingError = (error: unknown) => {
  const errorText = getErrorText(error);
  if (!errorText) return false;

  const referencesAssistantStorage = ASSISTANT_STORAGE_TABLE_NAMES.some(tableName =>
    errorText.includes(tableName)
  );

  return (
    referencesAssistantStorage &&
    (errorText.includes('does not exist') ||
      errorText.includes('schema cache') ||
      errorText.includes('could not find the table') ||
      errorText.includes('column') ||
      errorText.includes('pgrst205') ||
      errorText.includes('42p01') ||
      errorText.includes('42703'))
  );
};

export const buildAssistantStorageUnavailableTurn = ({
  conversationId,
  turnId,
}: {
  conversationId: string;
  turnId: string;
}): AssistantTurnResponse => ({
  state: 'error',
  conversationId,
  turnId,
  message: ASSISTANT_STORAGE_UNAVAILABLE_MESSAGE,
  retryCount: 0,
  timeoutFlag: false,
});

export async function ensureAssistantStorageReady() {
  const admin = createSupabaseAdmin();
  const checks = [
    { table: 'assistant_conversations', columns: 'id' },
    { table: 'assistant_turns', columns: 'id, retry_count, timeout_flag' },
    { table: 'assistant_pending_actions', columns: 'id, action_fields' },
    {
      table: 'assistant_action_logs',
      columns: 'id, confirmation_timestamp, execution_duration_ms',
    },
  ] as const;

  for (const check of checks) {
    const { error } = await admin.from(check.table).select(check.columns).limit(1);
    if (error) {
      return {
        ok: false as const,
        table: check.table,
        error,
        missing: isAssistantStorageMissingError(error),
      };
    }
  }

  return {
    ok: true as const,
  };
}
