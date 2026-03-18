'use server';

import { err, ok, type Result } from '@/lib/result';
import { z } from 'zod';

const AssistantHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

const AssistantInputSchema = z.object({
  query: z.string().min(1),
  history: z.array(AssistantHistoryMessageSchema).optional(),
  orgId: z.string().uuid(),
  groupId: z.string(),
  userId: z.string().uuid(),
});

export type AssistantInput = z.infer<typeof AssistantInputSchema>;

export type AssistantOutput = {
  reply: string;
  needsFollowup: boolean;
  followupQuestion: string | null;
  actions: Array<{
    tool: string;
    input: Record<string, unknown>;
    status: 'completed' | 'failed';
    output?: unknown;
    error?: string;
  }>;
};

export async function runAssistant(input: AssistantInput): Promise<Result<AssistantOutput>> {
  const parsed = AssistantInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'VALIDATION',
      message: 'Invalid assistant request.',
      detail: parsed.error.message,
      source: 'app',
    });
  }

  return ok({
    reply: 'TEST SUCCESS',
    needsFollowup: false,
    followupQuestion: null,
    actions: [],
  });
}
