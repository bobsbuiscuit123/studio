import { z } from 'zod';

export const AI_CHAT_HISTORY_LIMIT = 6;
export const AI_CHAT_MESSAGE_MAX_CHARS = 2_000;

export const AI_CHAT_INTENTS = ['GENERATION', 'MEMBERSHIP', 'GROUP_DATA'] as const;
export const AI_CHAT_ENTITIES = ['announcements', 'messages', 'members', 'events'] as const;

export type AiChatIntent = (typeof AI_CHAT_INTENTS)[number];
export type AiChatEntity = (typeof AI_CHAT_ENTITIES)[number];

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

export type AiChatHistoryMessage = z.infer<typeof aiChatHistoryMessageSchema>;
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;
export type AiChatPlannerResult = z.infer<typeof aiChatPlannerResultSchema>;
export type AiChatResponse = z.infer<typeof aiChatResponseSchema>;

export type AiChatClientMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status?: 'pending' | 'error';
  retryInput?: string;
};
