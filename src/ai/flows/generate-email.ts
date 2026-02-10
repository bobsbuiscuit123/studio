
'use server';

/**
 * @fileOverview Generates an email draft using AI from a natural language prompt.
 *
 * - generateEmail - A function that generates an email draft.
 * - GenerateEmailInput - The input type for the generateEmail function.
 * - GenerateEmailOutput - The return type for the generateEmail function.
 */

import { callAI } from '@/ai/genkit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { ok, type Result } from '@/lib/result';
import { z } from 'zod';

const GenerateEmailInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt for the email to generate. For example: "Draft an email to all members reminding them about the upcoming bake sale this Friday."'),
});
export type GenerateEmailInput = z.infer<
  typeof GenerateEmailInputSchema
>;

const GenerateEmailOutputSchema = z.object({
  subject: z.string().describe('A suitable subject line for the email.'),
  body: z.string().describe('The generated email body text.'),
});
export type GenerateEmailOutput = z.infer<
  typeof GenerateEmailOutputSchema
>;

export async function generateEmail(
  input: GenerateEmailInput
): Promise<Result<GenerateEmailOutput>> {
  const result = await callAI<GenerateEmailOutput>({
    responseFormat: 'json_object',
    outputSchema: GenerateEmailOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You are a club communication manager. Your task is to write a clear, concise, and friendly email to all club members based on the user's prompt.
The email should be professional yet approachable.
Return ONLY valid JSON matching: { "subject": string, "body": string }.`,
      },
      {
        role: 'user',
        content: input.prompt,
      },
    ],
  });
  if (!result.ok) return result;
  return ok({
    ...result.data,
    subject: sanitizeAiText(result.data.subject),
    body: sanitizeAiText(result.data.body),
  });
}
