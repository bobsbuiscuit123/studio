import { z } from 'zod';

import {
  type AgentActionType,
  type AgentIntent,
  type AssistantCommand,
  type AssistantTurnResponse,
  type DraftPreview,
} from '@/lib/assistant/agent/types';

export const MAX_LLM_RETRIES = 2 as const;
export const PENDING_ACTION_TTL_MS = 2 * 60 * 60 * 1000;

export const recipientSchema = z
  .object({
    email: z.string().trim().email(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const announcementDraftPreviewSchema = z
  .object({
    kind: z.literal('announcement'),
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(5_000).optional(),
    recipients: z.array(recipientSchema).min(1).optional(),
  })
  .strict();

export const eventDraftPreviewSchema = z
  .object({
    kind: z.literal('event'),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(5_000).optional(),
    date: z.string().trim().min(1).optional(),
    time: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const messageDraftPreviewSchema = z
  .object({
    kind: z.literal('message'),
    recipients: z.array(recipientSchema).min(1).optional(),
    body: z.string().trim().min(1).max(5_000).optional(),
  })
  .strict();

export const draftPreviewSchema = z.discriminatedUnion('kind', [
  announcementDraftPreviewSchema,
  eventDraftPreviewSchema,
  messageDraftPreviewSchema,
]);

export const announcementPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(5_000).optional(),
    recipients: z.array(recipientSchema).min(1).optional(),
  })
  .strict();

export const eventPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(5_000).optional(),
    date: z.string().trim().min(1).optional(),
    time: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const messagePatchSchema = z
  .object({
    recipients: z.array(recipientSchema).min(1).optional(),
    body: z.string().trim().min(1).max(5_000).optional(),
  })
  .strict();

export const draftPreviewPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('announcement'), patch: announcementPatchSchema }).strict(),
  z.object({ kind: z.literal('event'), patch: eventPatchSchema }).strict(),
  z.object({ kind: z.literal('message'), patch: messagePatchSchema }).strict(),
]);

export const retryMetadataSchema = z
  .object({
    retryCount: z.number().int().min(0).max(MAX_LLM_RETRIES).default(0),
    timeoutFlag: z.boolean().default(false),
  })
  .strict();

export const agentActionTypeSchema = z.enum([
  'create_announcement',
  'update_announcement',
  'create_event',
  'update_event',
  'create_message',
]) satisfies z.ZodType<AgentActionType>;

export const agentIntentSchema = z.enum([
  'conversational',
  'retrieval',
  'draft_action',
  'execute_action',
  'mixed',
]) satisfies z.ZodType<AgentIntent>;

export const agentPlanSchema = z
  .object({
    intent: agentIntentSchema,
    summary: z.string().trim().min(1).max(500),
    needsRetrieval: z.boolean(),
    retrievalTargets: z
      .array(
        z
          .object({
            resource: z.enum(['announcements', 'events', 'members', 'messages', 'activity']),
            purpose: z.string().trim().min(1).max(240),
          })
          .strict()
      )
      .max(5)
      .optional(),
    action: z
      .object({
        type: agentActionTypeSchema,
        fieldsProvided: z.record(z.unknown()).default({}),
        fieldsMissing: z.array(z.string()).default([]),
        requiresPreview: z.boolean().default(true),
        requiresConfirmation: z.boolean().default(true),
      })
      .strict()
      .optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const assistantCommandSchema: z.ZodType<AssistantCommand> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), text: z.string().trim().min(1).max(2_000) }).strict(),
  z.object({ kind: z.literal('confirm'), pendingActionId: z.string().uuid().optional() }).strict(),
  z.object({ kind: z.literal('cancel'), pendingActionId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal('edit_preview'),
      pendingActionId: z.string().uuid(),
      preview: draftPreviewPatchSchema,
    })
    .strict(),
  z.object({ kind: z.literal('regenerate'), pendingActionId: z.string().uuid() }).strict(),
]);

export const aiChatHistoryMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const aiChatRequestSchema = z
  .object({
    message: z.union([z.string().trim().min(1).max(2_000), assistantCommandSchema]),
    history: z.array(aiChatHistoryMessageSchema).max(6).optional(),
    conversationId: z.string().uuid().optional(),
  })
  .strict();

const assistantUiActionsSchema = z
  .object({
    canEdit: z.boolean(),
    canRegenerate: z.boolean(),
    canConfirm: z.boolean(),
    canCancel: z.boolean(),
    editableFields: z.array(z.string()),
  })
  .strict();

const assistantTurnBaseSchema = z
  .object({
    conversationId: z.string().uuid(),
    turnId: z.string().uuid(),
  })
  .merge(retryMetadataSchema);

export const assistantTurnResponseSchema = z.discriminatedUnion('state', [
  assistantTurnBaseSchema
    .extend({
      state: z.literal('response'),
      reply: z.string().trim().min(1),
    })
    .strict(),
  assistantTurnBaseSchema
    .extend({
      state: z.literal('retrieval_response'),
      reply: z.string().trim().min(1),
      usedEntities: z.array(z.string()),
    })
    .strict(),
  assistantTurnBaseSchema
    .extend({
      state: z.literal('draft_preview'),
      reply: z.string().trim().min(1),
      preview: draftPreviewSchema,
      pendingActionId: z.string().uuid(),
      ui: assistantUiActionsSchema,
      missingFields: z.array(z.string()).optional(),
    })
    .strict(),
  assistantTurnBaseSchema
    .extend({
      state: z.literal('awaiting_confirmation'),
      reply: z.string().trim().min(1),
      preview: draftPreviewSchema,
      pendingActionId: z.string().uuid(),
      ui: assistantUiActionsSchema,
      missingFields: z.array(z.string()).optional(),
    })
    .strict(),
  assistantTurnBaseSchema
    .extend({
      state: z.literal('executing'),
      reply: z.string().trim().min(1),
      pendingActionId: z.string().uuid(),
    })
    .strict(),
  assistantTurnBaseSchema
    .extend({
      state: z.literal('success'),
      message: z.string().trim().min(1),
      entityRef: z
        .object({
          entityId: z.string().trim().min(1),
          entityType: z.enum(['announcement', 'event', 'message']),
        })
        .strict()
        .optional(),
    })
    .strict(),
  assistantTurnBaseSchema
    .extend({
      state: z.literal('error'),
      message: z.string().trim().min(1),
      pendingActionId: z.string().uuid().optional(),
    })
    .strict(),
  assistantTurnBaseSchema
    .extend({
      state: z.literal('needs_clarification'),
      message: z.string().trim().min(1),
      missingFields: z.array(z.string()).optional(),
      pendingActionId: z.string().uuid().optional(),
    })
    .strict(),
]);

export const aiChatPlannerResultSchema = z
  .object({
    needs_data: z.boolean(),
    intent: z.enum(['GENERATION', 'MEMBERSHIP', 'GROUP_DATA']),
    entities: z
      .array(z.enum(['announcements', 'messages', 'members', 'events', 'forms', 'social_posts', 'gallery', 'points', 'transactions']))
      .max(9),
  })
  .strict();

export const aiChatResponseSchema = z
  .object({
    reply: z.string().trim().min(1),
    planner: aiChatPlannerResultSchema,
    usedEntities: z.array(z.string()),
  })
  .strict();

export const aiChatErrorResponseSchema = z
  .object({
    message: z.string().trim().min(1),
    code: z.string().trim().min(1).optional(),
    stage: z
      .enum([
        'request_validation',
        'context',
        'membership',
        'quota',
        'planner',
        'group_data_fetch',
        'responder',
        'unknown',
      ])
      .optional(),
    requestId: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
  })
  .strict();

export const parseDraftPreview = (value: unknown): DraftPreview => draftPreviewSchema.parse(value);

export const parseAssistantTurnResponse = (value: unknown): AssistantTurnResponse =>
  assistantTurnResponseSchema.parse(value);
