'use server';

/**
 * @fileOverview Generates a club form from a natural language prompt.
 *
 * - generateClubForm - A function that builds a form draft.
 * - GenerateClubFormInput - The input type for generateClubForm.
 * - GenerateClubFormOutput - The output type for generateClubForm.
 */

import { callAI } from '@/ai/genkit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const GenerateClubFormInputSchema = z.object({
  prompt: z
    .string()
    .describe(
      'A natural language prompt describing the form to create. Example: "Create a mentorship signup form asking for name, grade, interests, and availability."'
    ),
});
export type GenerateClubFormInput = z.infer<typeof GenerateClubFormInputSchema>;

const FormQuestionSchema = z.object({
  prompt: z.string().describe('The question text shown to members.'),
  required: z.boolean().optional().describe('Whether the question is required.'),
  kind: z
    .enum(['shortText', 'single', 'multi', 'file'])
    .describe('The input type to use.'),
  options: z
    .array(z.string())
    .optional()
    .describe('Answer choices for single or multi questions.'),
});

const GenerateClubFormOutputSchema = z.object({
  title: z.string().describe('A clear, concise form title.'),
  description: z
    .string()
    .optional()
    .describe('A brief description explaining the purpose of the form.'),
  questions: z.array(FormQuestionSchema).describe('Questions for the form.'),
});
export type GenerateClubFormOutput = z.infer<typeof GenerateClubFormOutputSchema>;

export async function generateClubForm(
  input: GenerateClubFormInput
): Promise<Result<GenerateClubFormOutput>> {
  const result = await callAI<GenerateClubFormOutput>({
    responseFormat: 'json_object',
    outputSchema: GenerateClubFormOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You are a group operations assistant that creates concise forms.
Create a title, optional description, and 1-8 questions based on the user's prompt.
Use kind values: shortText, single, multi, file.
Only include options for single or multi questions. Keep options concise (2-6 choices).
Return ONLY valid JSON matching: { "title": string, "description"?: string, "questions": Array<{ "prompt": string, "required"?: boolean, "kind": "shortText"|"single"|"multi"|"file", "options"?: string[] }> }.`,
      },
      { role: 'user', content: input.prompt },
    ],
  });
  return result;
}
