import { z } from 'zod';

export const AI_CHAT_HISTORY_LIMIT = 6;
export const AI_CHAT_MESSAGE_MAX_CHARS = 2_000;

export const AI_CHAT_INTENTS = ['GENERATION', 'MEMBERSHIP', 'GROUP_DATA'] as const;
export const AI_CHAT_ENTITIES = [
  'announcements',
  'messages',
  'members',
  'events',
  'forms',
  'social_posts',
  'gallery',
  'points',
  'transactions',
] as const;
export const AI_CHAT_FAILURE_STAGES = [
  'request_validation',
  'context',
  'membership',
  'quota',
  'planner',
  'group_data_fetch',
  'responder',
  'unknown',
] as const;

export type AiChatIntent = (typeof AI_CHAT_INTENTS)[number];
export type AiChatEntity = (typeof AI_CHAT_ENTITIES)[number];
export type AiChatFailureStage = (typeof AI_CHAT_FAILURE_STAGES)[number];

export const aiChatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(AI_CHAT_MESSAGE_MAX_CHARS),
});

export const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(AI_CHAT_MESSAGE_MAX_CHARS),
  history: z.array(aiChatHistoryMessageSchema).max(AI_CHAT_HISTORY_LIMIT).optional(),
});

export const aiChatPlannerResultSchema = z.object({
  needs_data: z.boolean(),
  intent: z.enum(AI_CHAT_INTENTS),
  entities: z.array(z.enum(AI_CHAT_ENTITIES)).max(AI_CHAT_ENTITIES.length),
});

export const aiChatResponseSchema = z.object({
  reply: z.string().trim().min(1),
  planner: aiChatPlannerResultSchema,
  usedEntities: z.array(z.enum(AI_CHAT_ENTITIES)),
});

export const aiChatErrorResponseSchema = z.object({
  message: z.string().trim().min(1),
  code: z.string().trim().min(1).optional(),
  stage: z.enum(AI_CHAT_FAILURE_STAGES).optional(),
  requestId: z.string().trim().min(1).optional(),
  detail: z.string().trim().min(1).optional(),
});

export type AiChatHistoryMessage = z.infer<typeof aiChatHistoryMessageSchema>;
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
export type AiChatPlannerResult = z.infer<typeof aiChatPlannerResultSchema>;
export type AiChatResponse = z.infer<typeof aiChatResponseSchema>;
export type AiChatErrorResponse = z.infer<typeof aiChatErrorResponseSchema>;

export type AiChatClientMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status?: 'pending' | 'error';
  retryInput?: string;
};
