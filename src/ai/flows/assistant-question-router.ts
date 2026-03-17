import { callAI } from '@/ai/genkit';
import { clampAssistantPrompt } from '@/ai/flows/assistant-prompt-limit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const AssistantQuestionRouterInputSchema = z.object({
  query: z.string().describe("The user's question."),
  context: z
    .string()
    .optional()
    .describe('Recent app context to help resolve references like "my last announcement".'),
});
export type AssistantQuestionRouterInput = z.infer<typeof AssistantQuestionRouterInputSchema>;

const AssistantQuestionLookupSchema = z.object({
  entity: z
    .enum(['announcement', 'form', 'event', 'finance', 'message', 'gallery', 'attendance', 'points', 'unknown'])
    .describe('Which app data area the question is about.'),
  metric: z
    .enum(['views', 'viewers', 'count', 'responses', 'rsvps', 'attendance', 'balance', 'points', 'status', 'unknown'])
    .describe('What value the user wants.'),
  subject: z
    .enum(['last', 'latest', 'recent', 'current', 'mine', 'unknown'])
    .describe('Which record or time reference the question points to.'),
  responseStyle: z
    .enum(['yes_no', 'count', 'who', 'summary'])
    .describe('How the final response should be phrased.'),
});

const AssistantQuestionRouterOutputSchema = z.object({
  kind: z.enum(['lookup', 'reply']),
  lookup: AssistantQuestionLookupSchema.optional(),
  reply: z
    .string()
    .optional()
    .describe('Direct human-readable reply when no deterministic app lookup is needed.'),
});
export type AssistantQuestionRouterOutput = z.infer<typeof AssistantQuestionRouterOutputSchema>;

export async function routeAssistantQuestion(
  input: AssistantQuestionRouterInput
): Promise<Result<AssistantQuestionRouterOutput>> {
  const baseSystemMessage = `Classify a user question for a school/group management app.
Return JSON only: {"kind":"lookup"|"reply","lookup"?:{...},"reply"?:string}
Use "lookup" when the user is asking about real app data the app should read directly.
Use "reply" for general help, unsupported questions, or when a normal text answer is better.
Supported deterministic lookup right now:
- announcement views/viewers/count for the user's last/latest/recent announcement
Rules:
- Questions like "did any members view my last announcement" are lookup.
- Do not invent values.
- If lookup, fill entity, metric, subject, responseStyle.
- If reply, provide a short human reply in reply.
- Keep output compact and valid JSON.`;
  const rawQuery = clampAssistantPrompt(input.query).trim();
  const rawContext = clampAssistantPrompt(input.context?.trim());
  const contextLabel = '\n\nRecent context:\n';
  const maxTotalChars = 2936;
  const maxQueryChars = Math.max(0, maxTotalChars - baseSystemMessage.length - 64);
  const cappedQuery = rawQuery.slice(0, maxQueryChars);
  const remainingForContext = Math.max(
    0,
    maxTotalChars - baseSystemMessage.length - cappedQuery.length - contextLabel.length
  );
  const trimmedContext =
    rawContext && remainingForContext > 0
      ? rawContext.slice(Math.max(0, rawContext.length - Math.min(remainingForContext, 600)))
      : '';

  return callAI<AssistantQuestionRouterOutput>({
    responseFormat: 'json_object',
    outputSchema: AssistantQuestionRouterOutputSchema,
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
  });
}
