import { getAssistantActionFlag } from '@/lib/assistant/agent/feature-flags';
import {
  getScopedPendingActionById,
  insertAssistantActionLog,
  markPendingActionExecuting,
  markPendingActionExecuted,
  markPendingActionFailed,
} from '@/lib/assistant/agent/pending-actions';
import type {
  AgentContext,
  AssistantEntityRef,
  AssistantTurnResponse,
  PendingAction,
} from '@/lib/assistant/agent/types';
import {
  createAnnouncement,
  updateAnnouncement,
} from '@/lib/assistant/agent/announcement-service';
import { createEvent, updateEvent } from '@/lib/assistant/agent/event-service';
import { createMessage } from '@/lib/assistant/agent/message-service';

const successResponse = (
  conversationId: string,
  turnId: string,
  message: string,
  entityRef?: AssistantEntityRef
): AssistantTurnResponse => ({
  state: 'success',
  conversationId,
  turnId,
  message,
  entityRef,
  retryCount: 0,
  timeoutFlag: false,
});

const responseState = (
  conversationId: string,
  turnId: string,
  reply: string
): AssistantTurnResponse => ({
  state: 'response',
  conversationId,
  turnId,
  reply,
  retryCount: 0,
  timeoutFlag: false,
});

const errorState = (
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

const needsClarificationState = (
  conversationId: string,
  turnId: string,
  message: string,
  pendingActionId?: string
): AssistantTurnResponse => ({
  state: 'needs_clarification',
  conversationId,
  turnId,
  message,
  pendingActionId,
  retryCount: 0,
  timeoutFlag: false,
});

const canExecutePendingAction = (pendingAction: PendingAction, context: AgentContext) => {
  switch (pendingAction.actionType) {
    case 'create_announcement':
      return context.permissions.canCreateAnnouncements;
    case 'update_announcement':
      return context.permissions.canUpdateAnnouncements;
    case 'create_event':
      return context.permissions.canCreateEvents;
    case 'update_event':
      return context.permissions.canUpdateEvents;
    case 'create_message':
      return context.permissions.canMessageMembers;
    default:
      return false;
  }
};

export async function executePendingAction(args: {
  pendingActionId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  userEmail: string;
  orgId: string;
  groupId: string;
  context: AgentContext;
}): Promise<AssistantTurnResponse> {
  const startedAt = Date.now();
  const confirmationTimestamp = new Date().toISOString();
  const pending = await getScopedPendingActionById({
    id: args.pendingActionId,
    userId: args.userId,
    orgId: args.orgId,
    groupId: args.groupId,
    conversationId: args.conversationId,
  });

  if (!pending) {
    return needsClarificationState(args.conversationId, args.turnId, 'What would you like me to post?');
  }

  if (pending.status === 'executed') {
    return successResponse(
      args.conversationId,
      args.turnId,
      pending.resultMessage || 'That action was already completed.',
      pending.resultEntityId && pending.resultEntityType
        ? { entityId: pending.resultEntityId, entityType: pending.resultEntityType }
        : undefined
    );
  }

  if (pending.status === 'executing') {
    return responseState(args.conversationId, args.turnId, "I'm already working on that.");
  }

  if (pending.status !== 'pending' && pending.status !== 'confirmed') {
    return needsClarificationState(
      args.conversationId,
      args.turnId,
      'That action is no longer active. Want me to regenerate it?',
      pending.id
    );
  }

  if (!canExecutePendingAction(pending, args.context)) {
    return errorState(args.conversationId, args.turnId, 'You do not have permission to do that.', pending.id);
  }

  const featureFlag = getAssistantActionFlag(pending.actionType);
  if (!featureFlag.executeEnabled) {
    return responseState(
      args.conversationId,
      args.turnId,
      "I can draft this, but that action isn't enabled yet."
    );
  }

  const claimed = await markPendingActionExecuting({
    id: pending.id,
    idempotencyKey: pending.idempotencyKey,
  });
  if (!claimed) {
    return responseState(args.conversationId, args.turnId, "I'm already working on that.");
  }

  try {
    const result =
      pending.actionType === 'create_announcement'
        ? await createAnnouncement({
            userId: args.userId,
            userEmail: args.userEmail,
            orgId: args.orgId,
            groupId: args.groupId,
            title: claimed.currentPayload.kind === 'announcement' ? claimed.currentPayload.title ?? '' : '',
            body: claimed.currentPayload.kind === 'announcement' ? claimed.currentPayload.body ?? '' : '',
          })
        : pending.actionType === 'update_announcement'
          ? await updateAnnouncement({
              userId: args.userId,
              userEmail: args.userEmail,
              orgId: args.orgId,
              groupId: args.groupId,
              targetRef: typeof claimed.actionFields.targetRef === 'string' ? claimed.actionFields.targetRef : '',
              title: claimed.currentPayload.kind === 'announcement' ? claimed.currentPayload.title : undefined,
              body: claimed.currentPayload.kind === 'announcement' ? claimed.currentPayload.body : undefined,
            })
        : pending.actionType === 'create_event'
          ? await createEvent({
              userId: args.userId,
              orgId: args.orgId,
              groupId: args.groupId,
              title: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.title ?? '' : '',
              description: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.description : undefined,
              date: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.date ?? '' : '',
              time: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.time ?? '' : '',
              location: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.location : undefined,
            })
          : pending.actionType === 'update_event'
            ? await updateEvent({
                userId: args.userId,
                orgId: args.orgId,
                groupId: args.groupId,
                targetRef: typeof claimed.actionFields.targetRef === 'string' ? claimed.actionFields.targetRef : '',
                title: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.title : undefined,
                description: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.description : undefined,
                date: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.date : undefined,
                time: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.time : undefined,
                location: claimed.currentPayload.kind === 'event' ? claimed.currentPayload.location : undefined,
              })
        : await createMessage({
            mode: 'recipients',
            userId: args.userId,
            userEmail: args.userEmail,
            orgId: args.orgId,
            groupId: args.groupId,
            recipients: claimed.currentPayload.kind === 'message' ? claimed.currentPayload.recipients ?? [] : [],
            body: claimed.currentPayload.kind === 'message' ? claimed.currentPayload.body ?? '' : '',
          });

    await insertAssistantActionLog({
      pendingActionId: claimed.id,
      conversationId: args.conversationId,
      userId: args.userId,
      orgId: args.orgId,
      groupId: args.groupId,
      actionType: claimed.actionType,
      originalDraftPayload: claimed.originalDraftPayload,
      finalExecutedPayload: claimed.currentPayload,
      result: 'success',
      entityId: result.entityId,
      confirmationTimestamp,
      executionDurationMs: Date.now() - startedAt,
    });

    await markPendingActionExecuted({
      id: claimed.id,
      entityId: result.entityId,
      entityType: result.entityType,
      resultMessage: result.message,
    });

    return successResponse(args.conversationId, args.turnId, result.message, {
      entityId: result.entityId,
      entityType: result.entityType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Execution failed.';
    await markPendingActionFailed({
      id: claimed.id,
      errorMessage: message,
    });
    await insertAssistantActionLog({
      pendingActionId: claimed.id,
      conversationId: args.conversationId,
      userId: args.userId,
      orgId: args.orgId,
      groupId: args.groupId,
      actionType: claimed.actionType,
      originalDraftPayload: claimed.originalDraftPayload,
      finalExecutedPayload: claimed.currentPayload,
      result: 'failure',
      errorMessage: message,
      confirmationTimestamp,
      executionDurationMs: Date.now() - startedAt,
    });
    return errorState(args.conversationId, args.turnId, message, claimed.id);
  }
}
