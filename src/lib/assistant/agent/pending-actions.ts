import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { PENDING_ACTION_TTL_MS, draftPreviewSchema } from '@/lib/assistant/agent/schemas';
import type { DraftPreview, PendingAction, PendingActionFields } from '@/lib/assistant/agent/types';

const mapPendingAction = (value: Record<string, unknown>): PendingAction => ({
  id: String(value.id ?? ''),
  conversationId: String(value.conversation_id ?? ''),
  userId: String(value.user_id ?? ''),
  orgId: String(value.org_id ?? ''),
  groupId: String(value.group_id ?? ''),
  actionType: String(value.action_type ?? '') as PendingAction['actionType'],
  actionFields:
    value.action_fields && typeof value.action_fields === 'object'
      ? (value.action_fields as PendingActionFields)
      : {},
  originalDraftPayload: draftPreviewSchema.parse(value.original_draft_payload),
  currentPayload: draftPreviewSchema.parse(value.current_payload),
  status: String(value.status ?? '') as PendingAction['status'],
  idempotencyKey: String(value.idempotency_key ?? ''),
  createdAt: String(value.created_at ?? ''),
  expiresAt: String(value.expires_at ?? ''),
  resultEntityId: typeof value.result_entity_id === 'string' ? value.result_entity_id : null,
  resultEntityType:
    value.result_entity_type === 'announcement' ||
    value.result_entity_type === 'event' ||
    value.result_entity_type === 'message'
      ? value.result_entity_type
      : null,
  resultMessage: typeof value.result_message === 'string' ? value.result_message : null,
});

export async function getOrCreateConversation({
  conversationId,
  userId,
  orgId,
  groupId,
}: {
  conversationId?: string | null;
  userId: string;
  orgId: string;
  groupId: string;
}) {
  const admin = createSupabaseAdmin();
  let resolvedConversationId = conversationId || crypto.randomUUID();

  if (conversationId) {
    const { data: existingConversation, error: existingConversationError } = await admin
      .from('assistant_conversations')
      .select('id, user_id, org_id, group_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (existingConversationError) {
      throw new Error(existingConversationError.message);
    }

    if (
      existingConversation &&
      (existingConversation.user_id !== userId ||
        existingConversation.org_id !== orgId ||
        existingConversation.group_id !== groupId)
    ) {
      resolvedConversationId = crypto.randomUUID();
    }
  }

  const { error } = await admin
    .from('assistant_conversations')
    .upsert(
      {
        id: resolvedConversationId,
        user_id: userId,
        org_id: orgId,
        group_id: groupId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (error) {
    throw new Error(error.message);
  }

  return resolvedConversationId;
}

export async function persistAssistantTurn(input: {
  conversationId: string;
  turnId: string;
  userId: string;
  orgId: string;
  groupId: string;
  requestPayload: Record<string, unknown>;
  normalizedPlan?: Record<string, unknown> | null;
  retrievalPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  state: string;
  pendingActionId?: string | null;
  retryCount: number;
  timeoutFlag: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('assistant_turns')
    .upsert(
      {
        id: input.turnId,
        conversation_id: input.conversationId,
        user_id: input.userId,
        org_id: input.orgId,
        group_id: input.groupId,
        request_payload: input.requestPayload,
        normalized_plan: input.normalizedPlan ?? null,
        retrieval_payload: input.retrievalPayload ?? null,
        response_payload: input.responsePayload ?? null,
        state: input.state,
        pending_action_id: input.pendingActionId ?? null,
        retry_count: input.retryCount,
        timeout_flag: input.timeoutFlag,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function createPendingAction(args: {
  conversationId: string;
  userId: string;
  orgId: string;
  groupId: string;
  actionType: PendingAction['actionType'];
  actionFields?: PendingActionFields;
  payload: DraftPreview;
}) {
  const admin = createSupabaseAdmin();
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PENDING_ACTION_TTL_MS).toISOString();
  const idempotencyKey = crypto.randomUUID();

  const { error } = await admin.from('assistant_pending_actions').insert({
    id,
    conversation_id: args.conversationId,
    user_id: args.userId,
    org_id: args.orgId,
    group_id: args.groupId,
    action_type: args.actionType,
    action_fields: args.actionFields ?? {},
    original_draft_payload: args.payload,
    current_payload: args.payload,
    status: 'pending',
    idempotency_key: idempotencyKey,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { id, expiresAt, idempotencyKey };
}

export async function getScopedPendingActionById(args: {
  id: string;
  userId: string;
  orgId: string;
  groupId: string;
  conversationId: string;
}) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('assistant_pending_actions')
    .select('*')
    .eq('id', args.id)
    .eq('user_id', args.userId)
    .eq('org_id', args.orgId)
    .eq('group_id', args.groupId)
    .eq('conversation_id', args.conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return mapPendingAction(data as Record<string, unknown>);
}

export async function getLatestValidPendingAction(args: {
  userId: string;
  orgId: string;
  groupId: string;
  conversationId: string;
}) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('assistant_pending_actions')
    .select('*')
    .eq('user_id', args.userId)
    .eq('org_id', args.orgId)
    .eq('group_id', args.groupId)
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return mapPendingAction(data as Record<string, unknown>);
}

export async function updatePendingActionPayload(args: {
  id: string;
  currentPayload: DraftPreview;
}) {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('assistant_pending_actions')
    .update({
      current_payload: args.currentPayload,
    })
    .eq('id', args.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function markPendingActionExpired(id: string) {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('assistant_pending_actions')
    .update({
      status: 'expired',
      failed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function markPendingActionCancelled(id: string) {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('assistant_pending_actions')
    .update({
      status: 'cancelled',
      failed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function markPendingActionExecuting(args: { id: string; idempotencyKey: string }) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('assistant_pending_actions')
    .update({
      status: 'executing',
    })
    .eq('id', args.id)
    .eq('idempotency_key', args.idempotencyKey)
    .in('status', ['pending', 'confirmed'])
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapPendingAction(data as Record<string, unknown>) : null;
}

export async function markPendingActionExecuted(args: {
  id: string;
  entityId: string;
  entityType: PendingAction['resultEntityType'];
  resultMessage: string;
}) {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('assistant_pending_actions')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      result_entity_id: args.entityId,
      result_entity_type: args.entityType,
      result_message: args.resultMessage,
    })
    .eq('id', args.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function markPendingActionFailed(args: { id: string; errorMessage: string }) {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('assistant_pending_actions')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      last_error: args.errorMessage,
    })
    .eq('id', args.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function insertAssistantActionLog(args: {
  pendingActionId: string;
  conversationId: string;
  userId: string;
  orgId: string;
  groupId: string;
  actionType: PendingAction['actionType'];
  originalDraftPayload: DraftPreview;
  finalExecutedPayload: DraftPreview;
  result: 'success' | 'failure';
  entityId?: string | null;
  errorMessage?: string | null;
  confirmationTimestamp?: string | null;
  executionDurationMs?: number | null;
}) {
  const admin = createSupabaseAdmin();
  const { error } = await admin.from('assistant_action_logs').insert({
    id: crypto.randomUUID(),
    pending_action_id: args.pendingActionId,
    conversation_id: args.conversationId,
    user_id: args.userId,
    org_id: args.orgId,
    group_id: args.groupId,
    action_type: args.actionType,
    original_draft_payload: args.originalDraftPayload,
    final_executed_payload: args.finalExecutedPayload,
    result: args.result,
    entity_id: args.entityId ?? null,
    error_message: args.errorMessage ?? null,
    confirmation_timestamp: args.confirmationTimestamp ?? null,
    execution_duration_ms: args.executionDurationMs ?? null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }
}
