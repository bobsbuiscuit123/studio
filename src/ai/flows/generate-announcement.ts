
'use server';

/**
 * @fileOverview Generates club announcements using AI from a natural language prompt.
 *
 * - generateClubAnnouncement - A function that generates a club announcement.
 * - GenerateClubAnnouncementInput - The input type for the generateClubAnnouncement function.
 * - GenerateClubAnnouncementOutput - The return type for the generateClubAnnouncement function.
 */

import { callAI } from '@/ai/genkit';
import { MAX_TAB_AI_OUTPUT_CHARS } from '@/lib/ai-output-limit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { ok, type Result } from '@/lib/result';
import { z } from 'zod';

const GenerateClubAnnouncementInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt for the announcement to generate. For example: "Draft an announcement for our annual bake sale next Friday at 2 PM. We need volunteers to sign up by Wednesday."'),
});
export type GenerateClubAnnouncementInput = z.infer<
  typeof GenerateClubAnnouncementInputSchema
>;

const GenerateClubAnnouncementOutputSchema = z.object({
  title: z.string().describe('A suitable title for the event announcement.'),
  announcement: z
    .string()
    .describe('The generated announcement text (do NOT repeat the title inside).'),
});
export type GenerateClubAnnouncementOutput = z.infer<
  typeof GenerateClubAnnouncementOutputSchema
>;

export async function generateClubAnnouncement(
  input: GenerateClubAnnouncementInput
): Promise<Result<GenerateClubAnnouncementOutput>> {
  const result = await callAI<GenerateClubAnnouncementOutput>({
    responseFormat: 'json_object',
    outputSchema: GenerateClubAnnouncementOutputSchema,
    maxOutputChars: MAX_TAB_AI_OUTPUT_CHARS,
    messages: [
      {
        role: 'system',
        content: `You are a group communication manager. Generate a concise and engaging announcement for the group members based on the user's prompt.
From the user's prompt, determine a good title for the announcement.
- Return the title in the "title" field.
- Return the body in "announcement" and DO NOT repeat the title there; keep it as pure body copy.
Return ONLY valid JSON matching: { "title": string, "announcement": string }.`,
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
    title: sanitizeAiText(result.data.title),
    announcement: sanitizeAiText(result.data.announcement),
  });
}
