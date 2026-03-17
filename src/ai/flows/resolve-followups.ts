'use server';

/**
 * @fileOverview Extracts answers for follow-up questions from a user's reply.
 */

import { callAI } from '@/ai/genkit';
import { clampAssistantPrompt } from '@/ai/flows/assistant-prompt-limit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const ResolveFollowUpsInputSchema = z.object({
  questions: z.array(z.string()).describe('Follow-up questions that need answers.'),
  reply: z.string().describe('The user reply that may contain answers.'),
});
export type ResolveFollowUpsInput = z.infer<typeof ResolveFollowUpsInputSchema>;

const ResolveFollowUpsOutputSchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
      })
    )
    .describe('Answers that can be confidently extracted.'),
  missing: z
    .array(z.string())
    .describe('Questions that are still unanswered or unclear.'),
});
export type ResolveFollowUpsOutput = z.infer<typeof ResolveFollowUpsOutputSchema>;

export async function resolveFollowUpAnswers(
  input: ResolveFollowUpsInput
): Promise<Result<ResolveFollowUpsOutput>> {
  const cappedReply = clampAssistantPrompt(input.reply);
  const result = await callAI<ResolveFollowUpsOutput>({
    responseFormat: 'json_object',
    outputSchema: ResolveFollowUpsOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You extract answers to follow-up questions from a user's reply.
Given a list of questions and the user's reply, return answers only when you are confident.
Do not invent details. If an answer is missing or ambiguous, include that question in "missing".
If the reply answers multiple questions at once, split them appropriately.
Treat short, informal replies as valid answers if they clearly map to a question.
If the user responds with multiple clauses or sentences, map each clause to the most relevant question.
Use the question text exactly as provided.
Return ONLY valid JSON matching: { "answers": Array<{ "question": string, "answer": string }>, "missing": string[] }.`,
      },
      {
        role: 'user',
        content: clampAssistantPrompt(`Questions:\n${input.questions.join('\n')}\n\nReply:\n${cappedReply}`),
      },
    ],
  });
  return result;
}
