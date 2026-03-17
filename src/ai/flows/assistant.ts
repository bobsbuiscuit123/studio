'use server';

/**
 * @fileOverview A general-purpose AI assistant response.
 *
 * NOTE: The interactive assistant UI uses the planner + task flows directly.
 * This flow remains as a lightweight, model-agnostic chat response that does not
 * execute tools.
 */

import { callAI } from '@/ai/genkit';
import { clampAssistantPrompt } from '@/ai/flows/assistant-prompt-limit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const AssistantInputSchema = z.object({
  query: z.string().describe("The user's request."),
  context: z
    .string()
    .optional()
    .describe('Current app context the assistant can use to answer questions.'),
});
export type AssistantInput = z.infer<typeof AssistantInputSchema>;

const AssistantOutputSchema = z.object({
  response: z
    .string()
    .describe("A summary of the action taken or a direct answer to the user's query."),
  toolOutput: z.any().optional().describe('The direct JSON output from any tool that was called.'),
  toolName: z.string().optional().describe('The name of the tool that was called.'),
});
export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

export async function runAssistant(
  input: AssistantInput
): Promise<Result<AssistantOutput>> {
  const baseSystemMessage =
    'You are CASPO, a concise group management copilot. Answer questions using only the provided app context when relevant. Never output raw JSON, code fences, or context dumps. Summarize the answer in plain language. If the answer is not in the context, say so plainly and suggest where to look. Do not claim you executed actions. If a request is outside what this app can do, say so clearly and offer a helpful alternative. Only suggest a next step if it clearly follows from the user request, and phrase it as "Would you like me to ...?" when useful. Treat currentUser as the meaning of first-person references like I, me, and my. Prefer names over emails. Format dates as M/D/YYYY. Keep the answer short and readable.';
  const rawQuery = clampAssistantPrompt(input.query).trim();
  const rawContext = clampAssistantPrompt(input.context?.trim());
  const contextLabel = '\n\nApp context:\n';
  const maxTotalChars = 2936;
  const maxQueryChars = Math.max(0, maxTotalChars - baseSystemMessage.length - 64);
  const cappedQuery = rawQuery.slice(0, maxQueryChars);
  const remainingForContext = Math.max(
    0,
    maxTotalChars - baseSystemMessage.length - cappedQuery.length - contextLabel.length
  );
  const trimmedContext =
    rawContext && remainingForContext > 0
      ? rawContext.slice(Math.max(0, rawContext.length - Math.min(remainingForContext, 1200)))
      : '';
  const content = await callAI({
    messages: [
      {
        role: 'system',
        content: trimmedContext
          ? `${baseSystemMessage}${contextLabel}${trimmedContext}`
          : baseSystemMessage,
      },
      {
        role: 'user',
        content: cappedQuery,
      },
    ],
    temperature: 0.5,
  });
  if (!content.ok) return content;
  const parsed = AssistantOutputSchema.safeParse({
    response: sanitizeAiText(String(content.data)),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'AI_SCHEMA_INVALID',
        message: 'AI response validation failed.',
        detail: parsed.error.message,
        retryable: true,
        source: 'ai',
      },
    };
  }
  return { ok: true, data: parsed.data };
}




