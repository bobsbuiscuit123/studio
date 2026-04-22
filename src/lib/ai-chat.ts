import type {
  AssistantCommand,
  AssistantTurnResponse,
} from '@/lib/assistant/agent/types';
import {
  aiChatErrorResponseSchema,
  aiChatHistoryMessageSchema,
  aiChatPlannerResultSchema,
  aiChatRequestSchema,
  aiChatResponseSchema,
  assistantTurnResponseSchema,
} from '@/lib/assistant/agent/schemas';
import type { z } from 'zod';

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

export {
  aiChatErrorResponseSchema,
  aiChatHistoryMessageSchema,
  aiChatPlannerResultSchema,
  aiChatRequestSchema,
  aiChatResponseSchema,
  assistantTurnResponseSchema,
};

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
  turn?: AssistantTurnResponse;
  command?: AssistantCommand;
};
