'use server';

import { callAI } from '@/ai/genkit';
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
  groupId: z.string().nullable(),
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
  const validatedInput = AssistantInputSchema.safeParse(input);
  if (!validatedInput.success) {
    return err({
      code: 'VALIDATION',
      message: 'Invalid assistant request.',
      detail: validatedInput.error.message,
      source: 'app',
    });
  }

  const { query } = validatedInput.data;

  try {
    const result = await callAI({
      messages: [{ role: 'user', content: query }],
    });

    console.log('SIMPLE GEMINI RESULT:', result);

    if (!result.ok) {
      return err({
        code: 'AI_PROVIDER_ERROR',
        message: result.error.message || 'Gemini call failed',
        source: 'ai',
        retryable: true,
      });
    }

    return ok({
      reply: result.data || 'No response',
      needsFollowup: false,
      followupQuestion: null,
      actions: [],
    });
  } catch (error) {
    return err({
      code: 'AI_PROVIDER_ERROR',
      message:
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message || 'Gemini call failed')
          : 'Gemini call failed',
      source: 'ai',
      retryable: true,
    });
  }
}
