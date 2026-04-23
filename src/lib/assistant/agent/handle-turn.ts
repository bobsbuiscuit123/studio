import { callAI } from '@/ai/genkit';
import {
  AI_CHAT_RESPONDER_SYSTEM_PROMPT,
  buildAiChatResponderPrompt,
} from '@/lib/ai-chat-server';
import type {
  AiChatEntity,
  AiChatHistoryMessage,
  AiChatPlannerResult,
} from '@/lib/ai-chat';
import {
  getActionRequiredRetrievalResources,
  mergeInferredActionFields,
  resolveActionFields,
} from '@/lib/assistant/agent/action-fields';
import { authorizeAction } from '@/lib/assistant/agent/authorize';
import { getAgentContext } from '@/lib/assistant/agent/context';
import { generateDraftPreview } from '@/lib/assistant/agent/drafts';
import { executePendingAction } from '@/lib/assistant/agent/executor';
import { runGeminiFieldValidator } from '@/lib/assistant/agent/field-validator';
import { getAssistantActionFlag } from '@/lib/assistant/agent/feature-flags';
import {
  announcementPatchSchema,
  assistantCommandSchema,
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
import { evaluateRequiredFields } from '@/lib/assistant/agent/requirements';
import { runLlmStepWithRetry } from '@/lib/assistant/agent/retry';
import {
  buildAssistantStorageUnavailableTurn,
  isAssistantStorageMissingError,
} from '@/lib/assistant/agent/storage';
import type {
  AgentActionType,
  AgentPlan,
  AssistantCommand,
  AssistantTurnResponse,
  DraftPreview,
} from '@/lib/assistant/agent/types';
import { withTimeout } from '@/lib/dashboard-load';
import { displayGroupRole } from '@/lib/group-permissions';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { addBreadcrumb } from '@/lib/telemetry';

const genericRetryFallback =
  "I'm having trouble processing that request right now—can you try rephrasing it?";

const confirmationPhrases = new Set(['post it', 'send it', 'create it', 'confirm']);

const draftableActionTypes = new Set<AgentActionType>([
  'create_announcement',
  'update_announcement',
  'create_event',
  'update_event',
  'create_message',
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
      return 'messages';
    default:
      return 'that';
  }
};

const getPreviewState = (intent: AgentPlan['intent']) =>
  intent === 'execute_action' ? 'awaiting_confirmation' : 'draft_preview';

const getEditableFields = (preview: DraftPreview) => {
  switch (preview.kind) {
    case 'announcement':
      return ['title', 'body', 'recipients'];
    case 'event':
      return ['title', 'description', 'date', 'time', 'location'];
    case 'message':
      return ['recipients', 'body'];
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

const buildPlannerPrompt = ({
  message,
  history,
  role,
}: {
  message: string;
  history?: AiChatHistoryMessage[];
  role: string;
}) =>
  [
    'Return JSON only. You are the planning pass for a production in-app assistant.',
    'Never assume hidden state, permissions, or missing required fields.',
    'Supported intents: conversational, retrieval, draft_action, execute_action, mixed.',
    'Supported retrieval resources: announcements, events, members, messages, activity.',
    'Supported action types: create_announcement, update_announcement, create_event, update_event, create_message.',
    'Use draft_action for low-commitment asks like draft, write, or example.',
    'Use execute_action for high-commitment asks like create, post, or send, but still only as a plan.',
    'Populate action.fieldsProvided only with values explicitly present in the user request or recent history. Never invent dates, times, recipients, or target ids.',
    `current_user_role: ${role}`,
    `recent_history: ${JSON.stringify(history ?? [])}`,
    `current_message: ${message}`,
  ].join('\n\n');

const buildFallbackResponse = (
  conversationId: string,
  turnId: string,
  retryCount: number,
  timeoutFlag: boolean
): AssistantTurnResponse => ({
  state: 'response',
  conversationId,
  turnId,
  reply: genericRetryFallback,
  retryCount,
  timeoutFlag,
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
  pendingActionId?: string
): AssistantTurnResponse => ({
  state: 'error',
  conversationId,
  turnId,
  message,
  pendingActionId,
  retryCount: 0,
  timeoutFlag: false,
});

const buildResponse = (
  conversationId: string,
  turnId: string,
  reply: string,
  retryCount = 0,
  timeoutFlag = false
): AssistantTurnResponse => ({
  state: 'response',
  conversationId,
  turnId,
  reply,
  retryCount,
  timeoutFlag,
});

const getPatchSchemaForPreview = (preview: DraftPreview) => {
  switch (preview.kind) {
    case 'announcement':
      return announcementPatchSchema;
    case 'event':
      return eventPatchSchema;
    case 'message':
      return messagePatchSchema;
    default:
      return announcementPatchSchema;
  }
};

const mergePreviewPatch = (preview: DraftPreview, patch: Record<string, unknown>) =>
  parseDraftPreview({
    ...preview,
    ...patch,
  });

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
}): Promise<AgentPlan> {
  const result = await callAI({
    messages: [{ role: 'user', content: buildPlannerPrompt(args) }],
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
            draftRun.timeoutFlag
          ),
          actionType: pending.actionType,
        });
      }

      await updatePendingActionPayload({
        id: pending.id,
        currentPayload: draftRun.value,
      });

      const result: AssistantTurnResponse = {
        state: 'draft_preview',
        conversationId: resolvedConversationId,
        turnId,
        reply: buildPreviewReply(draftRun.value, false),
        preview: draftRun.value,
        pendingActionId: pending.id,
        ui: buildPreviewUi(draftRun.value, pending.actionType),
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
          plannerRun.timeoutFlag
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

    const actionType = plannedAction.type;
    const resolvedActionFields = resolveActionFields({
      actionType,
      fieldsProvided: plannedAction.fieldsProvided,
      message: normalizedCommand.text,
      retrieval,
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

    if (fieldValidatorRun.ok) {
      const mergedInference = mergeInferredActionFields({
        actionType,
        resolvedActionFields,
        inferredFields: fieldValidatorRun.value.inferredFields,
        userMessage: normalizedCommand.text,
        recentHistory: history,
        requestTimezone: effectiveRequestTimezone,
        requestReceivedAt: effectiveRequestReceivedAt,
      });
      enrichedActionFields = mergedInference.mergedFields;

      await addBreadcrumb('assistant.field_validator_result', {
        actionType,
        usedInference: fieldValidatorRun.value.usedInference,
        mergedFieldKeys: mergedInference.mergedFieldKeys,
        // Confidence is telemetry only. It must never affect gating or execution safety.
        confidence: fieldValidatorRun.value.telemetry?.confidence ?? null,
        // Gemini-reported missing fields are debug-only. Backend deterministic validation is authoritative.
        modelMissingFields: fieldValidatorRun.value.telemetry?.modelMissingFields ?? [],
        notes: fieldValidatorRun.value.telemetry?.notes ?? [],
      });
    }

    const requiredFields = evaluateRequiredFields(actionType, enrichedActionFields);
    if (requiredFields.missingFields.length > 0 && requiredFields.clarificationMessage) {
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
          requiredFields.clarificationMessage,
          requiredFields.missingFields
        ),
        actionType,
      });
    }

    const draftRun = await runLlmStepWithRetry({
      step: 'draft',
      fn: async () =>
        generateDraftPreview({
          actionType,
          message: normalizedCommand.text,
          fieldsProvided: enrichedActionFields,
          retrieval,
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
        normalizedPlan: normalizedPlan as unknown as Record<string, unknown>,
        retrievalPayload: retrieval.context as Record<string, unknown>,
        result: buildFallbackResponse(
          resolvedConversationId,
          turnId,
          draftRun.retryCount,
          draftRun.timeoutFlag
        ),
        actionType,
      });
    }

    const postDraftRequirements = evaluateRequiredFields(
      actionType,
      enrichedActionFields,
      draftRun.value
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

    const pendingAction = await createPendingAction({
      conversationId: resolvedConversationId,
      userId,
      orgId,
      groupId,
      actionType,
      actionFields: enrichedActionFields,
      payload: draftRun.value,
    });

    const previewState = getPreviewState(normalizedPlan.intent);
    const result: AssistantTurnResponse = {
      state: previewState,
      conversationId: resolvedConversationId,
      turnId,
      reply: buildPreviewReply(draftRun.value, previewState === 'awaiting_confirmation'),
      preview: draftRun.value,
      pendingActionId: pendingAction.id,
      ui: buildPreviewUi(draftRun.value, actionType),
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
        error instanceof Error ? error.message : 'Assistant request failed.'
      ),
      errorCode: 'UNKNOWN',
    });
  }
}
