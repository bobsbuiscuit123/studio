'use server';

import { callAI } from '@/ai/genkit';
import { err, ok, type Result } from '@/lib/result';
import { z } from 'zod';

const MAX_GEMINI_PROMPT_CHARS = 12_000;
const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Answer clearly and directly.';
const MINIMAL_SYSTEM_PROMPT = 'Helpful assistant.';

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

function countChars(str: string): number {
  return str.length;
}

function trimToBudget(value: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }
  if (value.length <= budget) {
    return value;
  }
  return value.slice(0, budget);
}

function serializePromptPart(label: string, value?: string | null): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  return `${label}:\n${text}`;
}

function buildFullPrompt(parts: {
  system?: string;
  history?: string;
  tools?: string;
  context?: string;
  user: string;
}): string {
  return [
    serializePromptPart('System', parts.system),
    serializePromptPart('History', parts.history),
    serializePromptPart('Tools', parts.tools),
    serializePromptPart('Context', parts.context),
    serializePromptPart('User', parts.user),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildSafePrompt({
  system,
  history,
  user,
  tools,
  context,
}: {
  system?: string;
  history?: string;
  user: string;
  tools?: string;
  context?: string;
}) {
  let safeSystem = String(system ?? '').trim();
  let safeHistory = String(history ?? '').trim();
  let safeTools = String(tools ?? '').trim();
  let safeContext = String(context ?? '').trim();
  let safeUser = String(user ?? '').trim();

  let fullPrompt = buildFullPrompt({
    system: safeSystem,
    history: safeHistory,
    tools: safeTools,
    context: safeContext,
    user: safeUser,
  });
  let totalChars = countChars(fullPrompt);
  let trimmed = false;

  if (totalChars > MAX_GEMINI_PROMPT_CHARS && safeHistory) {
    safeHistory = '';
    trimmed = true;
    fullPrompt = buildFullPrompt({
      system: safeSystem,
      history: safeHistory,
      tools: safeTools,
      context: safeContext,
      user: safeUser,
    });
    totalChars = countChars(fullPrompt);
  }

  if (totalChars > MAX_GEMINI_PROMPT_CHARS && safeSystem) {
    safeSystem = MINIMAL_SYSTEM_PROMPT;
    trimmed = true;
    fullPrompt = buildFullPrompt({
      system: safeSystem,
      history: safeHistory,
      tools: safeTools,
      context: safeContext,
      user: safeUser,
    });
    totalChars = countChars(fullPrompt);
  }

  if (totalChars > MAX_GEMINI_PROMPT_CHARS && safeTools) {
    safeTools = '';
    trimmed = true;
    fullPrompt = buildFullPrompt({
      system: safeSystem,
      history: safeHistory,
      tools: safeTools,
      context: safeContext,
      user: safeUser,
    });
    totalChars = countChars(fullPrompt);
  }

  if (totalChars > MAX_GEMINI_PROMPT_CHARS && safeContext) {
    safeContext = '';
    trimmed = true;
    fullPrompt = buildFullPrompt({
      system: safeSystem,
      history: safeHistory,
      tools: safeTools,
      context: safeContext,
      user: safeUser,
    });
    totalChars = countChars(fullPrompt);
  }

  if (totalChars > MAX_GEMINI_PROMPT_CHARS) {
    const withoutUser = buildFullPrompt({
      system: safeSystem,
      history: safeHistory,
      tools: safeTools,
      context: safeContext,
      user: '',
    });
    const userBudget = MAX_GEMINI_PROMPT_CHARS - countChars(withoutUser);
    safeUser = trimToBudget(safeUser, userBudget);
    trimmed = true;
    fullPrompt = buildFullPrompt({
      system: safeSystem,
      history: safeHistory,
      tools: safeTools,
      context: safeContext,
      user: safeUser,
    });
    totalChars = countChars(fullPrompt);
  }

  console.log('CHAR COUNT:', totalChars);
  if (trimmed) {
    console.log('Prompt trimmed to fit budget');
  }

  return {
    fullPrompt,
    totalChars,
    trimmed,
  };
}

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

  const { query, history } = validatedInput.data;

  try {
    const historyText = Array.isArray(history)
      ? history
          .map(message => `${message.role}: ${message.content}`)
          .join('\n')
      : '';
    const safePrompt = buildSafePrompt({
      system: DEFAULT_SYSTEM_PROMPT,
      history: historyText,
      user: query,
    });

    const result = await callAI({
      messages: [{ role: 'user', content: safePrompt.fullPrompt }],
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
