/**
 * @fileOverview Generates an optional gallery description from context.
 */

import { callAI } from '@/ai/genkit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { ok, type Result } from '@/lib/result';
import { z } from 'zod';

export const GenerateGalleryDescriptionInputSchema = z.object({
  prompt: z
    .string()
    .describe('A natural language prompt describing the gallery upload.'),
});
export type GenerateGalleryDescriptionInput = z.infer<
  typeof GenerateGalleryDescriptionInputSchema
>;

const GenerateGalleryDescriptionOutputSchema = z.object({
  description: z
    .string()
    .describe(
      'A short gallery image description. Use an empty string if none is needed.'
    ),
});
export type GenerateGalleryDescriptionOutput = z.infer<
  typeof GenerateGalleryDescriptionOutputSchema
>;

export async function generateGalleryDescription(
  input: GenerateGalleryDescriptionInput
): Promise<Result<GenerateGalleryDescriptionOutput>> {
  const result = await callAI<GenerateGalleryDescriptionOutput>({
    responseFormat: 'json_object',
    outputSchema: GenerateGalleryDescriptionOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You write short gallery image descriptions.
If the prompt includes "Final content to use as-is", copy that content verbatim as the description.
If the prompt includes an exact description in quotes, use it verbatim.
If there is no meaningful context for a description, return an empty string.
Return ONLY valid JSON matching: { "description": string }.`,
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
    description: sanitizeAiText(result.data.description),
  });
}
