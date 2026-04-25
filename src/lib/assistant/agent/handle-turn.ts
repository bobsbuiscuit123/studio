import { callAI } from '@/ai/genkit';
import {
  AI_CHAT_RESPONDER_SYSTEM_PROMPT,
  buildAiChatResponderPrompt,
  fetchAiChatDataContext,
} from '@/lib/ai-chat-server';
import type {
  AiChatEntity,
  AiChatHistoryMessage,
  AiChatPlannerResult,
} from '@/lib/ai-chat';
import {
  fillGeneratedActionFields,
  getActionRequiredRetrievalResources,
  mergeInferredActionFields,
  resolveActionFields,
} from '@/lib/assistant/agent/action-fields';
import { buildAssistantPlannerPrompt } from '@/lib/assistant/agent/planner-prompt';
import { authorizeAction } from '@/lib/assistant/agent/authorize';
import { getAgentContext } from '@/lib/assistant/agent/context';
import { generateDraftPreview } from '@/lib/assistant/agent/drafts';
import { executePendingAction } from '@/lib/assistant/agent/executor';
import { runGeminiFieldValidator } from '@/lib/assistant/agent/field-validator';
import { getAssistantActionFlag } from '@/lib/assistant/agent/feature-flags';
import {
  announcementPatchSchema,
  assistantCommandSchema,
  emailPatchSchema,
  eventPatchSchema,
  agentPlanSchema,
  messagePatchSchema,
  parseDraftPreview,
} from '@/lib/assistant/agent/schemas';
import {
  createPendingAction,
  getLatestValidPendingAction,
  getOrCreateConversation,
  getScopedPendingActionById,
  markPendingActionCancelled,
  markPendingActionExpired,
  persistAssistantTurn,
  updatePendingActionPayload,
} from '@/lib/assistant/agent/pending-actions';
import { fetchAgentRetrievalContext } from '@/lib/assistant/agent/retrieval';
import {
  evaluateRequiredFields,
  evaluateStructuralRequiredFields,
} from '@/lib/assistant/agent/requirements';
import { runLlmStepWithRetry } from '@/lib/assistant/agent/retry';
import {
  buildAssistantStorageUnavailableTurn,
  isAssistantStorageMissingError,
} from '@/lib/assistant/agent/storage';
import type {
  AgentActionType,
  AgentPlan,
  AssistantCommand,
  PendingAction,
  AssistantTurnResponse,
  AssistantTurnDiagnostics,
  DraftPreview,
} from '@/lib/assistant/agent/types';
import { withTimeout } from '@/lib/dashboard-load';
import { displayGroupRole } from '@/lib/group-permissions';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { addBreadcrumb } from '@/lib/telemetry';

const genericRetryFallback =
  "I'm having trouble processing that request right now—can you try rephrasing it?";

const MAX_DIAGNOSTIC_DETAIL_CHARS = 240;

const confirmationPhrases = new Set(['post it', 'send it', 'create it', 'confirm']);

const draftableActionTypes = new Set<AgentActionType>([
  'create_announcement',
  'update_announcement',
  'create_event',
  'update_event',
  'create_message',
  'update_message',
  'create_email',
  'update_email',
]);

const getActionLabel = (actionType: AgentActionType) => {
  switch (actionType) {
    case 'create_announcement':
    case 'update_announcement':
      return 'announcements';
    case 'create_event':
    case 'update_event':
      return 'events';
    case 'create_message':
    case 'update_message':
      return 'messages';
    case 'create_email':
    case 'update_email':
      return 'emails';
    default:
      return 'that';
  }
};

const getPreviewState = (intent: AgentPlan['intent']) =>
  intent === 'execute_action' ? 'awaiting_confirmation' : 'draft_preview';

type PlannerTargetCandidate = {
  id: string;
  title: string;
  date?: string;
};

type PlannerDraftContext = {
  pendingActionId: string;
  actionType: AgentActionType;
  currentPayload: DraftPreview;
  targetRef?: string;
};

const extractPlannerTargetCandidates = (items: unknown): PlannerTargetCandidate[] =>
  (Array.isArray(items) ? items : [])
    .slice(-6)
    .flatMap(item => {
      const record = item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : null;
      if (!record) {
        return [];
      }

      const id =
        typeof record.id === 'string' || typeof record.id === 'number'
          ? String(record.id)
          : '';
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const date =
        typeof record.date === 'string'
          ? record.date
          : record.date instanceof Date
            ? record.date.toISOString()
            : undefined;

      return id && title ? [{ id, title, ...(date ? { date } : {}) }] : [];
    });

const toPlannerDraftContext = (pending: PendingAction | null): PlannerDraftContext | null =>
  isPendingActionReusable(pending)
    ? {
        pendingActionId: pending.id,
        actionType: pending.actionType,
        currentPayload: pending.currentPayload,
        ...(hasNonEmptyString(pending.actionFields.targetRef)
          ? { targetRef: pending.actionFields.targetRef }
          : {}),
      }
    : null;

const isPendingActionReusable = (pending: PendingAction | null | undefined): pending is PendingAction =>
  Boolean(
    pending &&
      (pending.status === 'pending' || pending.status === 'confirmed') &&
      Date.parse(pending.expiresAt) > Date.now()
  );

const getDraftFollowUpPendingAction = ({
  plannedActionType,
  plannedFieldsProvided,
  pending,
}: {
  plannedActionType: AgentActionType;
  plannedFieldsProvided: Record<string, unknown>;
  pending: PendingAction | null;
}) => {
  if (!isPendingActionReusable(pending)) {
    return null;
  }

  if (hasNonEmptyString(plannedFieldsProvided.targetRef)) {
    return null;
  }

  if (
    plannedActionType === 'update_announcement' &&
    pending.currentPayload.kind === 'announcement' &&
    (pending.actionType === 'create_announcement' || pending.actionType === 'update_announcement')
  ) {
    return pending;
  }

  if (
    plannedActionType === 'update_event' &&
    pending.currentPayload.kind === 'event' &&
    (pending.actionType === 'create_event' || pending.actionType === 'update_event')
  ) {
    return pending;
  }

  if (
    plannedActionType === 'update_message' &&
    pending.currentPayload.kind === 'message' &&
    (pending.actionType === 'create_message' || pending.actionType === 'update_message')
  ) {
    return pending;
  }

  if (
    plannedActionType === 'update_email' &&
    pending.currentPayload.kind === 'email' &&
    (pending.actionType === 'create_email' || pending.actionType === 'update_email')
  ) {
    return pending;
  }

  return null;
};

const mergePendingDraftStructuralFields = ({
  actionType,
  resolvedActionFields,
  pending,
}: {
  actionType: AgentActionType;
  resolvedActionFields: Record<string, unknown>;
  pending: PendingAction | null;
}) => {
  if (!pending) {
    return resolvedActionFields;
  }

  if (
    (actionType === 'update_announcement' || actionType === 'update_event') &&
    !hasNonEmptyString(resolvedActionFields.targetRef) &&
    hasNonEmptyString(pending.actionFields.targetRef)
  ) {
    return {
      ...resolvedActionFields,
      targetRef: pending.actionFields.targetRef,
    };
  }

  if (
    (actionType === 'create_message' || actionType === 'update_message') &&
    !hasRecipientList(resolvedActionFields.recipients) &&
    pending.currentPayload.kind === 'message' &&
    hasRecipientList(pending.currentPayload.recipients)
  ) {
    return {
      ...resolvedActionFields,
      recipients: pending.currentPayload.recipients,
    };
  }

  return resolvedActionFields;
};

const getEditableFields = (preview: DraftPreview) => {
  switch (preview.kind) {
    case 'announcement':
      return ['title', 'body'];
    case 'event':
      return ['title', 'description', 'date', 'time', 'location'];
    case 'message':
      return ['recipients', 'body'];
    case 'email':
      return ['subject', 'body'];
    default:
      return [];
  }
};

const buildPreviewUi = (preview: DraftPreview, actionType: AgentActionType) => {
  const actionFlag = getAssistantActionFlag(actionType);
  return {
    canEdit: true,
    canRegenerate: actionFlag.draftEnabled,
    canConfirm: actionFlag.executeEnabled,
    canCancel: true,
    editableFields: getEditableFields(preview),
  };
};

const buildPreviewReply = (preview: DraftPreview, awaitingConfirmation: boolean) => {
  const label =
    preview.kind === 'announcement'
      ? 'announcement'
      : preview.kind === 'event'
        ? 'event'
        : preview.kind === 'email'
          ? 'email'
        : 'message';

  return awaitingConfirmation
    ? `I drafted a ${label}. Review it and confirm when you're ready.`
    : `Here is a draft ${label}. You can edit it, regenerate it, or confirm it when you're ready.`;
};

const buildFeatureDisabledMessage = (actionType: AgentActionType) =>
  actionType.startsWith('update_')
    ? `I can draft this, but updating ${getActionLabel(actionType)} via assistant isn’t enabled yet.`
    : `I can draft this, but creating ${getActionLabel(actionType)} via assistant isn’t enabled yet.`;

const toResponderPlanner = (
  plan: AgentPlan,
  usedEntities: AiChatEntity[]
): AiChatPlannerResult => ({
  needs_data: usedEntities.length > 0,
  intent: usedEntities.length > 0 ? 'GROUP_DATA' : 'GENERATION',
  entities: usedEntities,
});

const normalizeIncomingCommand = (
  input: string | AssistantCommand
): AssistantCommand => {
  if (typeof input !== 'string') {
    return assistantCommandSchema.parse(input);
  }

  const normalized = input.trim();
  const lowered = normalized.toLowerCase();

  if (confirmationPhrases.has(lowered)) {
    return { kind: 'confirm' };
  }

  return {
    kind: 'message',
    text: normalized,
  };
};

const buildFallbackResponse = (
  conversationId: string,
  turnId: string,
  retryCount: number,
  timeoutFlag: boolean,
  diagnostics?: AssistantTurnDiagnostics
): AssistantTurnResponse => ({
  state: 'response',
  conversationId,
  turnId,
  reply: genericRetryFallback,
  retryCount,
  timeoutFlag,
  diagnostics,
});

const buildNeedsClarification = (
  conversationId: string,
  turnId: string,
  message: string,
  missingFields?: string[],
  pendingActionId?: string
): AssistantTurnResponse => ({
  state: 'needs_clarification',
  conversationId,
  turnId,
  message,
  missingFields,
  pendingActionId,
  retryCount: 0,
  timeoutFlag: false,
});

const buildError = (
  conversationId: string,
  turnId: string,
  message: string,
  pendingActionId?: string,
  diagnostics?: AssistantTurnDiagnostics
): AssistantTurnResponse => ({
  state: 'error',
  conversationId,
  turnId,
  message,
  pendingActionId,
  retryCount: 0,
  timeoutFlag: false,
  diagnostics,
});

const buildResponse = (
  conversationId: string,
  turnId: string,
  reply: string,
  retryCount = 0,
  timeoutFlag = false,
  diagnostics?: AssistantTurnDiagnostics
): AssistantTurnResponse => ({
  state: 'response',
  conversationId,
  turnId,
  reply,
  retryCount,
  timeoutFlag,
  diagnostics,
});

const sanitizeDiagnosticDetail = (value: unknown) => {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, MAX_DIAGNOSTIC_DETAIL_CHARS);
};

const buildDiagnostics = ({
  phase,
  detail,
  requestId,
}: {
  phase: AssistantTurnDiagnostics['phase'];
  detail?: unknown;
  requestId?: string;
}): AssistantTurnDiagnostics => {
  const sanitizedDetail = sanitizeDiagnosticDetail(detail);
  return {
    phase,
    ...(sanitizedDetail ? { detail: sanitizedDetail } : {}),
    ...(requestId ? { requestId } : {}),
  };
};

const getPatchSchemaForPreview = (preview: DraftPreview) => {
  switch (preview.kind) {
    case 'announcement':
      return announcementPatchSchema;
    case 'event':
      return eventPatchSchema;
    case 'message':
      return messagePatchSchema;
    case 'email':
      return emailPatchSchema;
    default:
      return announcementPatchSchema;
  }
};

const mergePreviewPatch = (preview: DraftPreview, patch: Record<string, unknown>) =>
  parseDraftPreview({
    ...preview,
    ...patch,
  });

const hasNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasRecipientList = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

const mergeAuthoritativeFieldsIntoPreview = (
  preview: DraftPreview,
  fieldsProvided: Record<string, unknown>,
  fallbackPreview?: DraftPreview | null
) => {
  switch (preview.kind) {
    case 'announcement':
      return parseDraftPreview({
        ...(fallbackPreview?.kind === 'announcement' && hasNonEmptyString(fallbackPreview.title)
          ? { title: fallbackPreview.title }
          : {}),
        ...(fallbackPreview?.kind === 'announcement' && hasNonEmptyString(fallbackPreview.body)
          ? { body: fallbackPreview.body }
          : {}),
        ...preview,
        ...(hasNonEmptyString(preview.title) || !hasNonEmptyString(fieldsProvided.title)
          ? {}
          : { title: fieldsProvided.title }),
        ...(hasNonEmptyString(preview.body) || !hasNonEmptyString(fieldsProvided.body)
          ? {}
          : { body: fieldsProvided.body }),
      });
    case 'event':
      return parseDraftPreview({
        ...(fallbackPreview?.kind === 'event' && hasNonEmptyString(fallbackPreview.title)
          ? { title: fallbackPreview.title }
          : {}),
        ...(fallbackPreview?.kind === 'event' && hasNonEmptyString(fallbackPreview.description)
          ? { description: fallbackPreview.description }
          : {}),
        ...(fallbackPreview?.kind === 'event' && hasNonEmptyString(fallbackPreview.date)
          ? { date: fallbackPreview.date }
          : {}),
        ...(fallbackPreview?.kind === 'event' && hasNonEmptyString(fallbackPreview.time)
          ? { time: fallbackPreview.time }
          : {}),
        ...(fallbackPreview?.kind === 'event' && hasNonEmptyString(fallbackPreview.location)
          ? { location: fallbackPreview.location }
          : {}),
        ...preview,
        ...(hasNonEmptyString(preview.title) || !hasNonEmptyString(fieldsProvided.title)
          ? {}
          : { title: fieldsProvided.title }),
        ...(hasNonEmptyString(preview.description) || !hasNonEmptyString(fieldsProvided.description)
          ? {}
          : { description: fieldsProvided.description }),
        ...(hasNonEmptyString(preview.date) || !hasNonEmptyString(fieldsProvided.date)
          ? {}
          : { date: fieldsProvided.date }),
        ...(hasNonEmptyString(preview.time) || !hasNonEmptyString(fieldsProvided.time)
          ? {}
          : { time: fieldsProvided.time }),
        ...(hasNonEmptyString(preview.location) || !hasNonEmptyString(fieldsProvided.location)
          ? {}
          : { location: fieldsProvided.location }),
      });
    case 'message':
      return parseDraftPreview({
        ...(fallbackPreview?.kind === 'message' && hasRecipientList(fallbackPreview.recipients)
          ? { recipients: fallbackPreview.recipients }
          : {}),
        ...(fallbackPreview?.kind === 'message' && hasNonEmptyString(fallbackPreview.body)
          ? { body: fallbackPreview.body }
          : {}),
        ...preview,
        ...(hasRecipientList(preview.recipients) || !hasRecipientList(fieldsProvided.recipients)
          ? {}
          : { recipients: fieldsProvided.recipients }),
        ...(hasNonEmptyString(preview.body) || !hasNonEmptyString(fieldsProvided.body)
          ? {}
          : { body: fieldsProvided.body }),
      });
    case 'email':
      return parseDraftPreview({
        ...(fallbackPreview?.kind === 'email' && hasNonEmptyString(fallbackPreview.subject)
          ? { subject: fallbackPreview.subject }
          : {}),
        ...(fallbackPreview?.kind === 'email' && hasNonEmptyString(fallbackPreview.body)
          ? { body: fallbackPreview.body }
          : {}),
        ...preview,
        ...(hasNonEmptyString(preview.subject) || !hasNonEmptyString(fieldsProvided.subject)
          ? {}
          : { subject: fieldsProvided.subject }),
        ...(hasNonEmptyString(preview.body) || !hasNonEmptyString(fieldsProvided.body)
          ? {}
          : { body: fieldsProvided.body }),
      });
    default:
      return preview;
  }
};

const buildPreviewFromAuthoritativeFields = ({
  actionType,
  fieldsProvided,
  seedPreview,
}: {
  actionType: AgentActionType;
  fieldsProvided: Record<string, unknown>;
  seedPreview?: DraftPreview | null;
}) => {
  switch (actionType) {
    case 'create_announcement':
    case 'update_announcement':
      return parseDraftPreview({
        ...(seedPreview?.kind === 'announcement' ? seedPreview : { kind: 'announcement' as const }),
        kind: 'announcement',
        ...(hasNonEmptyString(fieldsProvided.title) ? { title: fieldsProvided.title } : {}),
        ...(hasNonEmptyString(fieldsProvided.body) ? { body: fieldsProvided.body } : {}),
      });
    case 'create_event':
    case 'update_event':
      return parseDraftPreview({
        ...(seedPreview?.kind === 'event' ? seedPreview : { kind: 'event' as const }),
        kind: 'event',
        ...(hasNonEmptyString(fieldsProvided.title) ? { title: fieldsProvided.title } : {}),
        ...(hasNonEmptyString(fieldsProvided.description)
          ? { description: fieldsProvided.description }
          : {}),
        ...(hasNonEmptyString(fieldsProvided.date) ? { date: fieldsProvided.date } : {}),
        ...(hasNonEmptyString(fieldsProvided.time) ? { time: fieldsProvided.time } : {}),
        ...(hasNonEmptyString(fieldsProvided.location) ? { location: fieldsProvided.location } : {}),
      });
    case 'create_message':
    case 'update_message':
      return parseDraftPreview({
        ...(seedPreview?.kind === 'message' ? seedPreview : { kind: 'message' as const }),
        kind: 'message',
        ...(hasRecipientList(fieldsProvided.recipients) ? { recipients: fieldsProvided.recipients } : {}),
        ...(hasNonEmptyString(fieldsProvided.body) ? { body: fieldsProvided.body } : {}),
      });
    case 'create_email':
    case 'update_email':
      return parseDraftPreview({
        ...(seedPreview?.kind === 'email' ? seedPreview : { kind: 'email' as const }),
        kind: 'email',
        ...(hasNonEmptyString(fieldsProvided.subject) ? { subject: fieldsProvided.subject } : {}),
        ...(hasNonEmptyString(fieldsProvided.body) ? { body: fieldsProvided.body } : {}),
      });
    default:
      return seedPreview ?? parseDraftPreview({ kind: 'announcement' });
  }
};

async function resolveUserEmail(userId: string) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return typeof data?.email === 'string' ? data.email : '';
}

async function runAgentPlanner(args: {
  message: string;
  history?: AiChatHistoryMessage[];
  role: string;
  activeDraft?: PlannerDraftContext | null;
  announcementTargets?: PlannerTargetCandidate[];
  eventTargets?: PlannerTargetCandidate[];
}): Promise<AgentPlan> {
  const result = await callAI({
    messages: [{ role: 'user', content: buildAssistantPlannerPrompt(args) }],
    responseFormat: 'json_object',
    outputSchema: agentPlanSchema,
    temperature: 0.1,
    timeoutMs: 18_000,
  });

  if (!result.ok) {
    throw new Error(result.error.detail || result.error.message);
  }

  return agentPlanSchema.parse(result.data) as AgentPlan;
}

async function runResponder(args: {
  message: string;
  history?: AiChatHistoryMessage[];
  role: string;
  plan: AgentPlan;
  usedEntities: AiChatEntity[];
  context: Record<string, unknown>;
  userEmail: string;
}): Promise<string> {
  const prompt = buildAiChatResponderPrompt({
    message: args.message,
    history: args.history,
    planner: toResponderPlanner(args.plan, args.usedEntities),
    usedEntities: args.usedEntities,
    context: args.context,
    currentUserEmail: args.userEmail,
    role: args.role,
  });

  const result = await callAI({
    messages: [
      { role: 'system', content: AI_CHAT_RESPONDER_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    timeoutMs: 24_000,
    maxOutputChars: 2_400,
  });

  if (!result.ok) {
    throw new Error(result.error.detail || result.error.message);
  }

  return result.data;
}

async function persistTurnResult(args: {
  userId: string;
  orgId: string;
  groupId: string;
  conversationId: string;
  turnId: string;
  requestId?: string;
  requestPayload: Record<string, unknown>;
  normalizedPlan?: Record<string, unknown> | null;
  retrievalPayload?: Record<string, unknown> | null;
  result: AssistantTurnResponse;
  actionType?: AgentActionType | null;
  executionResult?: 'success' | 'failure' | null;
  errorCode?: string | null;
}) {
  try {
    await persistAssistantTurn({
      conversationId: args.conversationId,
      turnId: args.turnId,
      userId: args.userId,
      orgId: args.orgId,
      groupId: args.groupId,
      requestPayload: args.requestPayload,
      normalizedPlan: args.normalizedPlan,
      retrievalPayload: args.retrievalPayload,
      responsePayload: args.result as unknown as Record<string, unknown>,
      state: args.result.state,
      pendingActionId:
        'pendingActionId' in args.result ? (args.result.pendingActionId ?? null) : null,
      retryCount: args.result.retryCount,
      timeoutFlag: args.result.timeoutFlag,
      errorCode: args.errorCode ?? null,
      errorMessage: args.result.state === 'error' ? args.result.message : null,
    });
  } catch (error) {
    if (!isAssistantStorageMissingError(error)) {
      throw error;
    }

    console.error('[assistant-turn] persistence unavailable', {
      requestId:
        args.requestId ??
        (typeof args.requestPayload.requestId === 'string' ? args.requestPayload.requestId : null),
      conversationId: args.conversationId,
      turnId: args.turnId,
      state: args.result.state,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  console.info('[assistant-turn]', {
    requestId:
      args.requestId ??
      (typeof args.requestPayload.requestId === 'string' ? args.requestPayload.requestId : null),
    conversationId: args.conversationId,
    turnId: args.turnId,
    userId: args.userId,
    orgId: args.orgId,
    groupId: args.groupId,
    state: args.result.state,
    actionType: args.actionType ?? null,
    executionResult:
      args.executionResult ??
      (args.result.state === 'success'
        ? 'success'
        : args.result.state === 'error'
          ? 'failure'
          : null),
    error: args.result.state === 'error' ? args.result.message : null,
    diagnostics: args.result.diagnostics ?? null,
  });

  return args.result;
}

export async function handleAssistantTurn({
  userId,
  orgId,
  groupId,
  message,
  conversationId,
  history,
  userEmail,
  requestId,
  requestTimezone,
  requestReceivedAt,
}: {
  userId: string;
  orgId: string;
  groupId: string;
  message: string | AssistantCommand;
  conversationId?: string | null;
  history?: AiChatHistoryMessage[];
  userEmail?: string;
  requestId?: string;
  requestTimezone?: string;
  requestReceivedAt?: string;
}): Promise<AssistantTurnResponse> {
  const turnId = crypto.randomUUID();
  const fallbackConversationId = conversationId || crypto.randomUUID();
  const effectiveRequestTimezone = requestTimezone || 'UTC';
  const effectiveRequestReceivedAt = requestReceivedAt || new Date().toISOString();
  let resolvedConversationId = fallbackConversationId;
  let requestPayload = {
    message: typeof message === 'string' ? message : (message as Record<string, unknown>),
    history: history ?? [],
    conversationId: fallbackConversationId,
    requestId: requestId ?? null,
    requestTimezone: effectiveRequestTimezone,
    requestReceivedAt: effectiveRequestReceivedAt,
  };

  try {
    resolvedConversationId = await getOrCreateConversation({
      conversationId,
      userId,
      orgId,
      groupId,
    });
    requestPayload = {
      ...requestPayload,
      conversationId: resolvedConversationId,
    };

    const context = await getAgentContext(userId, orgId, groupId);
    if (!context) {
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        result: buildError(resolvedConversationId, turnId, 'Access denied.'),
        errorCode: 'VALIDATION',
      });
    }

    const normalizedCommand = normalizeIncomingCommand(message);
    const latestPendingAction =
      normalizedCommand.kind === 'message'
        ? await getLatestValidPendingAction({
            userId,
            orgId,
            groupId,
            conversationId: resolvedConversationId,
          })
        : null;
    const plannerTargetContext =
      normalizedCommand.kind === 'message'
        ? await withTimeout(
            async () => {
              const admin = createSupabaseAdmin();
              const plannerContext = await fetchAiChatDataContext({
                admin,
                groupId,
                entities: ['announcements', 'events'],
                role: context.role,
              });

              return {
                announcementTargets: extractPlannerTargetCandidates(plannerContext.context.announcements),
                eventTargets: extractPlannerTargetCandidates(plannerContext.context.events),
              };
            },
            4_000,
            { label: 'Assistant planner targets' }
          ).catch(() => ({
            announcementTargets: [] as PlannerTargetCandidate[],
            eventTargets: [] as PlannerTargetCandidate[],
          }))
        : {
            announcementTargets: [] as PlannerTargetCandidate[],
            eventTargets: [] as PlannerTargetCandidate[],
          };

    if (normalizedCommand.kind === 'cancel') {
      const pending = await getScopedPendingActionById({
        id: normalizedCommand.pendingActionId,
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
      });
      if (!pending) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            'That action is no longer active. Want me to create a new draft instead?'
          ),
        });
      }

      await markPendingActionCancelled(pending.id);
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        result: buildResponse(resolvedConversationId, turnId, 'Okay, I canceled that draft.'),
      });
    }

    if (normalizedCommand.kind === 'confirm') {
      const pending = normalizedCommand.pendingActionId
        ? await getScopedPendingActionById({
            id: normalizedCommand.pendingActionId,
            userId,
            orgId,
            groupId,
            conversationId: resolvedConversationId,
          })
        : await getLatestValidPendingAction({
            userId,
            orgId,
            groupId,
            conversationId: resolvedConversationId,
          });

      if (!pending) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            'What would you like me to post?'
          ),
        });
      }

      if (Date.parse(pending.expiresAt) <= Date.now()) {
        await markPendingActionExpired(pending.id);
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            'That draft expired. Want me to recreate it?',
            undefined,
            pending.id
          ),
        });
      }

      if (pending.status === 'failed' || pending.status === 'cancelled' || pending.status === 'expired') {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            'That action is no longer active. Want me to regenerate it?',
            undefined,
            pending.id
          ),
        });
      }

      if (normalizedCommand.preview) {
        if (normalizedCommand.preview.kind !== pending.currentPayload.kind) {
          return persistTurnResult({
            userId,
            orgId,
            groupId,
            conversationId: resolvedConversationId,
            turnId,
            requestPayload,
            result: buildError(
              resolvedConversationId,
              turnId,
              'Invalid edit. Please adjust your changes.',
              pending.id
            ),
            errorCode: 'VALIDATION',
          });
        }

        const mergedPreview = mergePreviewPatch(
          pending.currentPayload,
          normalizedCommand.preview.patch as Record<string, unknown>
        );
        const editRequirements = evaluateRequiredFields(
          pending.actionType,
          pending.actionFields,
          mergedPreview
        );
        if (editRequirements.missingFields.length > 0 && editRequirements.clarificationMessage) {
          return persistTurnResult({
            userId,
            orgId,
            groupId,
            conversationId: resolvedConversationId,
            turnId,
            requestPayload,
            result: buildNeedsClarification(
              resolvedConversationId,
              turnId,
              editRequirements.clarificationMessage,
              editRequirements.missingFields,
              pending.id
            ),
          });
        }

        await updatePendingActionPayload({
          id: pending.id,
          currentPayload: mergedPreview,
        });
      }

      const executionResult = await executePendingAction({
        pendingActionId: pending.id,
        conversationId: resolvedConversationId,
        turnId,
        userId,
        userEmail: userEmail ?? (await resolveUserEmail(userId)),
        orgId,
        groupId,
        context,
      });

      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        result: executionResult,
        actionType: pending.actionType,
        executionResult:
          executionResult.state === 'success'
            ? 'success'
            : executionResult.state === 'error'
              ? 'failure'
              : null,
      });
    }

    if (normalizedCommand.kind === 'edit_preview') {
      const pending = await getScopedPendingActionById({
        id: normalizedCommand.pendingActionId,
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
      });

      if (!pending) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildError(
            resolvedConversationId,
            turnId,
            'Invalid edit. Please adjust your changes.'
          ),
          errorCode: 'VALIDATION',
        });
      }

      if (Date.parse(pending.expiresAt) <= Date.now()) {
        await markPendingActionExpired(pending.id);
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            'That draft expired. Want me to recreate it?',
            undefined,
            pending.id
          ),
        });
      }

      if (normalizedCommand.preview.kind !== pending.currentPayload.kind) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildError(
            resolvedConversationId,
            turnId,
            'Invalid edit. Please adjust your changes.',
            pending.id
          ),
          errorCode: 'VALIDATION',
        });
      }

      const patchSchema = getPatchSchemaForPreview(pending.currentPayload);
      const parsedPatch = patchSchema.safeParse(normalizedCommand.preview.patch);
      if (!parsedPatch.success) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildError(
            resolvedConversationId,
            turnId,
            'Invalid edit. Please adjust your changes.',
            pending.id
          ),
          errorCode: 'VALIDATION',
        });
      }

      const mergedPreview = mergePreviewPatch(
        pending.currentPayload,
        parsedPatch.data as Record<string, unknown>
      );
      const editRequirements = evaluateRequiredFields(
        pending.actionType,
        pending.actionFields,
        mergedPreview
      );
      if (editRequirements.missingFields.length > 0 && editRequirements.clarificationMessage) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            editRequirements.clarificationMessage,
            editRequirements.missingFields,
            pending.id
          ),
        });
      }

      const authorization = authorizeAction(pending.actionType, context);
      if (!authorization.ok) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildError(
            resolvedConversationId,
            turnId,
            authorization.message,
            pending.id
          ),
          errorCode: 'VALIDATION',
        });
      }

      await updatePendingActionPayload({
        id: pending.id,
        currentPayload: mergedPreview,
      });

      const result: AssistantTurnResponse = {
        state: 'draft_preview',
        conversationId: resolvedConversationId,
        turnId,
        reply: buildPreviewReply(mergedPreview, false),
        preview: mergedPreview,
        pendingActionId: pending.id,
        ui: buildPreviewUi(mergedPreview, pending.actionType),
        retryCount: 0,
        timeoutFlag: false,
      };

      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        result,
        actionType: pending.actionType,
      });
    }

    if (normalizedCommand.kind === 'regenerate') {
      const pending = await getScopedPendingActionById({
        id: normalizedCommand.pendingActionId,
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
      });

      if (!pending) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            'That action is no longer active. Want me to create a new draft?'
          ),
        });
      }

      if (Date.parse(pending.expiresAt) <= Date.now()) {
        await markPendingActionExpired(pending.id);
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            'That draft expired. Want me to recreate it?',
            undefined,
            pending.id
          ),
        });
      }

      const actionFlag = getAssistantActionFlag(pending.actionType);
      if (!actionFlag.draftEnabled) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildResponse(
            resolvedConversationId,
            turnId,
            buildFeatureDisabledMessage(pending.actionType)
          ),
          actionType: pending.actionType,
        });
      }

      const draftRun = await runLlmStepWithRetry({
        step: 'draft',
        fn: async () =>
          generateDraftPreview({
            actionType: pending.actionType,
            message: 'Regenerate this draft with a fresh variation.',
            fieldsProvided: pending.actionFields,
            retrieval: { context: {}, usedEntities: [] },
            seedPreview: pending.originalDraftPayload,
          }),
      });

      if (!draftRun.ok) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          result: buildFallbackResponse(
            resolvedConversationId,
            turnId,
            draftRun.retryCount,
            draftRun.timeoutFlag,
            buildDiagnostics({
              phase: 'draft',
              detail: draftRun.lastErrorMessage,
              requestId,
            })
          ),
          actionType: pending.actionType,
        });
      }

      const regeneratedPreview = mergeAuthoritativeFieldsIntoPreview(
        draftRun.value,
        pending.actionFields,
        pending.currentPayload
      );

      await updatePendingActionPayload({
        id: pending.id,
        currentPayload: regeneratedPreview,
      });

      const result: AssistantTurnResponse = {
        state: 'draft_preview',
        conversationId: resolvedConversationId,
        turnId,
        reply: buildPreviewReply(regeneratedPreview, false),
        preview: regeneratedPreview,
        pendingActionId: pending.id,
        ui: buildPreviewUi(regeneratedPreview, pending.actionType),
        retryCount: draftRun.retryCount,
        timeoutFlag: draftRun.timeoutFlag,
      };

      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        result,
        actionType: pending.actionType,
      });
    }

    const plannerRun = await runLlmStepWithRetry({
      step: 'planner',
      fn: async () => runAgentPlanner({
        message: normalizedCommand.text,
        history,
        role: displayGroupRole(context.role),
        activeDraft: toPlannerDraftContext(latestPendingAction),
        announcementTargets: plannerTargetContext.announcementTargets,
        eventTargets: plannerTargetContext.eventTargets,
      }),
    });

    if (!plannerRun.ok) {
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        result: buildFallbackResponse(
          resolvedConversationId,
          turnId,
          plannerRun.retryCount,
          plannerRun.timeoutFlag,
          buildDiagnostics({
            phase: 'planner',
            detail: plannerRun.lastErrorMessage,
            requestId,
          })
        ),
      });
    }

    const planParse = agentPlanSchema.safeParse(plannerRun.value);
    const normalizedPlan = planParse.success
      ? planParse.data
      : ({
          intent: 'conversational',
          summary: 'Fallback conversational response.',
          needsRetrieval: false,
          confidence: 0,
        } satisfies AgentPlan);
    const plannedAction = normalizedPlan.action;

    const retrieval = normalizedPlan.needsRetrieval
      ? await withTimeout(
          () =>
            fetchAgentRetrievalContext({
              groupId,
              role: context.role,
              plan: normalizedPlan,
              requiredResources: plannedAction
                ? getActionRequiredRetrievalResources(plannedAction.type)
                : [],
            }),
          8_000,
          { label: 'Assistant retrieval' }
        )
      : plannedAction
        ? await withTimeout(
            () =>
              fetchAgentRetrievalContext({
                groupId,
                role: context.role,
                plan: normalizedPlan,
                requiredResources: getActionRequiredRetrievalResources(plannedAction.type),
              }),
            8_000,
            { label: 'Assistant retrieval' }
          )
        : { context: {}, usedEntities: [] as AiChatEntity[] };

    if (!plannedAction || !draftableActionTypes.has(plannedAction.type)) {
      try {
        const reply = await runResponder({
          message: normalizedCommand.text,
          history,
          role: displayGroupRole(context.role),
          plan: normalizedPlan,
          usedEntities: retrieval.usedEntities,
          context: retrieval.context as Record<string, unknown>,
          userEmail: userEmail ?? (await resolveUserEmail(userId)),
        });

        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
          retrievalPayload: retrieval.context as Record<string, unknown>,
          result: retrieval.usedEntities.length > 0
            ? {
                state: 'retrieval_response',
                conversationId: resolvedConversationId,
                turnId,
                reply,
                usedEntities: retrieval.usedEntities,
                retryCount: plannerRun.retryCount,
                timeoutFlag: plannerRun.timeoutFlag,
              }
            : {
                state: 'response',
                conversationId: resolvedConversationId,
                turnId,
                reply,
                retryCount: plannerRun.retryCount,
                timeoutFlag: plannerRun.timeoutFlag,
              },
        });
      } catch {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
          retrievalPayload: retrieval.context as Record<string, unknown>,
          result: buildResponse(
            resolvedConversationId,
            turnId,
            genericRetryFallback,
            plannerRun.retryCount,
            plannerRun.timeoutFlag
          ),
        });
      }
    }

    const pendingDraftFollowUp = getDraftFollowUpPendingAction({
      plannedActionType: plannedAction.type,
      plannedFieldsProvided: plannedAction.fieldsProvided,
      pending: latestPendingAction,
    });
    const actionType = pendingDraftFollowUp?.actionType ?? plannedAction.type;
    const resolvedActionFields = mergePendingDraftStructuralFields({
      actionType,
      resolvedActionFields: resolveActionFields({
        actionType,
        fieldsProvided: plannedAction.fieldsProvided,
        message: normalizedCommand.text,
        retrieval,
      }),
      pending: pendingDraftFollowUp,
    });
    const authorization = authorizeAction(actionType, context);
    if (!authorization.ok) {
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
        retrievalPayload: retrieval.context as Record<string, unknown>,
        result: buildError(resolvedConversationId, turnId, authorization.message),
        actionType,
        errorCode: 'VALIDATION',
      });
    }

    const actionFlag = getAssistantActionFlag(actionType);
    if (!actionFlag.draftEnabled) {
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
        retrievalPayload: retrieval.context as Record<string, unknown>,
        result: buildResponse(
          resolvedConversationId,
          turnId,
          buildFeatureDisabledMessage(actionType),
          plannerRun.retryCount,
          plannerRun.timeoutFlag
        ),
        actionType,
      });
    }

    let enrichedActionFields = resolvedActionFields;
    const structuralRequirements = evaluateStructuralRequiredFields(actionType, resolvedActionFields);
    if (structuralRequirements.missingFields.length > 0 && structuralRequirements.clarificationMessage) {
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
        retrievalPayload: retrieval.context as Record<string, unknown>,
        result: buildNeedsClarification(
          resolvedConversationId,
          turnId,
          structuralRequirements.clarificationMessage,
          structuralRequirements.missingFields
        ),
        actionType,
      });
    }

    const fieldValidatorRun = await runLlmStepWithRetry({
      step: 'field_validator',
      fn: async () =>
        runGeminiFieldValidator({
          actionType,
          userMessage: normalizedCommand.text,
          recentHistory: history,
          resolvedActionFields,
          requestTimezone: effectiveRequestTimezone,
          requestReceivedAt: effectiveRequestReceivedAt,
        }),
    });

    if (!fieldValidatorRun.ok) {
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
        retrievalPayload: retrieval.context as Record<string, unknown>,
        result: buildFallbackResponse(
          resolvedConversationId,
          turnId,
          fieldValidatorRun.retryCount,
          fieldValidatorRun.timeoutFlag,
          buildDiagnostics({
            phase: 'field_validator',
            detail: fieldValidatorRun.lastErrorMessage,
            requestId,
          })
        ),
        actionType,
      });
    }

    const mergedInference = mergeInferredActionFields({
      actionType,
      resolvedActionFields,
      inferredFields: fieldValidatorRun.value.inferredFields,
      userMessage: normalizedCommand.text,
      recentHistory: history,
      requestTimezone: effectiveRequestTimezone,
      requestReceivedAt: effectiveRequestReceivedAt,
    });
    const filledGeneration = fillGeneratedActionFields({
      actionType,
      actionFields: mergedInference.mergedFields,
      userMessage: normalizedCommand.text,
      recentHistory: history,
      requestTimezone: effectiveRequestTimezone,
      requestReceivedAt: effectiveRequestReceivedAt,
    });
    enrichedActionFields = filledGeneration.filledFields;

    const preDraftRequirements = evaluateRequiredFields(actionType, enrichedActionFields);

    await addBreadcrumb('assistant.field_validator_result', {
      actionType,
      usedInference: fieldValidatorRun.value.usedInference,
      mergedFieldKeys: mergedInference.mergedFieldKeys,
      defaultedFieldKeys: filledGeneration.defaultedFieldKeys,
      validatorReportedMissingFields: fieldValidatorRun.value.missingFields,
      requiredFieldsStillMissing: preDraftRequirements.missingFields,
      clarificationMessage: fieldValidatorRun.value.clarificationMessage ?? null,
      // Confidence is telemetry only. It must never affect gating or execution safety.
      confidence: fieldValidatorRun.value.telemetry?.confidence ?? null,
      notes: fieldValidatorRun.value.telemetry?.notes ?? [],
    });

    if (preDraftRequirements.missingFields.length > 0) {
      if (preDraftRequirements.clarificationMessage) {
        return persistTurnResult({
          userId,
          orgId,
          groupId,
          conversationId: resolvedConversationId,
          turnId,
          requestPayload,
          normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
          retrievalPayload: retrieval.context as Record<string, unknown>,
          result: buildNeedsClarification(
            resolvedConversationId,
            turnId,
            preDraftRequirements.clarificationMessage,
            preDraftRequirements.missingFields
          ),
          actionType,
        });
      }

      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
        retrievalPayload: retrieval.context as Record<string, unknown>,
        result: buildFallbackResponse(
          resolvedConversationId,
          turnId,
          fieldValidatorRun.retryCount,
          fieldValidatorRun.timeoutFlag,
          buildDiagnostics({
            phase: 'field_validator',
            detail: `Generated action fields remained empty: ${preDraftRequirements.missingFields.join(', ')}`,
            requestId,
          })
        ),
        actionType,
      });
    }

    const draftSeedPreview = pendingDraftFollowUp?.currentPayload ?? null;
    const draftRun = await runLlmStepWithRetry({
      step: 'draft',
      fn: async () =>
        generateDraftPreview({
          actionType,
          message: normalizedCommand.text,
          fieldsProvided: enrichedActionFields,
          retrieval,
          seedPreview: draftSeedPreview,
        }),
    });

    let mergedDraftPreview: DraftPreview;
    if (!draftRun.ok) {
      mergedDraftPreview = buildPreviewFromAuthoritativeFields({
        actionType,
        fieldsProvided: enrichedActionFields,
        seedPreview: draftSeedPreview,
      });
      await addBreadcrumb('assistant.draft_fallback_preview', {
        actionType,
        retryCount: draftRun.retryCount,
        timeoutFlag: draftRun.timeoutFlag,
        reason: draftRun.lastErrorMessage ?? null,
        usedSeedPreview: Boolean(draftSeedPreview),
      });
    } else {
      mergedDraftPreview = mergeAuthoritativeFieldsIntoPreview(
        draftRun.value,
        enrichedActionFields,
        draftSeedPreview
      );
    }

    const postDraftRequirements = evaluateRequiredFields(
      actionType,
      enrichedActionFields,
      mergedDraftPreview
    );
    if (postDraftRequirements.missingFields.length > 0 && postDraftRequirements.clarificationMessage) {
      return persistTurnResult({
        userId,
        orgId,
        groupId,
        conversationId: resolvedConversationId,
        turnId,
        requestPayload,
        normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
        retrievalPayload: retrieval.context as Record<string, unknown>,
        result: buildNeedsClarification(
          resolvedConversationId,
          turnId,
          postDraftRequirements.clarificationMessage,
          postDraftRequirements.missingFields
        ),
        actionType,
      });
    }

    const pendingActionId = pendingDraftFollowUp?.id;
    if (pendingActionId) {
      await updatePendingActionPayload({
        id: pendingActionId,
        currentPayload: mergedDraftPreview,
        actionFields: enrichedActionFields,
      });
    }

    const pendingAction = pendingActionId
      ? {
          id: pendingActionId,
        }
      : await createPendingAction({
          conversationId: resolvedConversationId,
          userId,
          orgId,
          groupId,
          actionType,
          actionFields: enrichedActionFields,
          payload: mergedDraftPreview,
        });

    const previewState = getPreviewState(normalizedPlan.intent);
    const result: AssistantTurnResponse = {
      state: previewState,
      conversationId: resolvedConversationId,
      turnId,
      reply: buildPreviewReply(mergedDraftPreview, previewState === 'awaiting_confirmation'),
      preview: mergedDraftPreview,
      pendingActionId: pendingAction.id,
      ui: buildPreviewUi(mergedDraftPreview, actionType),
      retryCount: draftRun.retryCount,
      timeoutFlag: draftRun.timeoutFlag,
    };

    return persistTurnResult({
      userId,
      orgId,
      groupId,
      conversationId: resolvedConversationId,
      turnId,
      requestPayload,
      normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
      retrievalPayload: retrieval.context as Record<string, unknown>,
      result,
      actionType,
    });
  } catch (error) {
    if (isAssistantStorageMissingError(error)) {
      console.error('[assistant-turn] storage unavailable', {
        requestId: requestId ?? null,
        conversationId: resolvedConversationId,
        turnId,
        userId,
        orgId,
        groupId,
        message: error instanceof Error ? error.message : String(error),
      });
      return buildAssistantStorageUnavailableTurn({
        conversationId: resolvedConversationId,
        turnId,
      });
    }

    return persistTurnResult({
      userId,
      orgId,
      groupId,
      conversationId: resolvedConversationId,
      turnId,
      requestPayload,
      result: buildError(
        resolvedConversationId,
        turnId,
        error instanceof Error ? error.message : 'Assistant request failed.',
        undefined,
        buildDiagnostics({
          phase: 'orchestrator',
          detail: error instanceof Error ? error.message : String(error),
          requestId,
        })
      ),
      errorCode: 'UNKNOWN',
    });
  }
}
