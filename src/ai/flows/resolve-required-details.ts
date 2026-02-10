/**
 * @fileOverview Determines which required fields are missing for planned tasks.
 */

import { callAI } from '@/ai/genkit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const ResolveRequiredDetailsInputSchema = z.object({
  query: z
    .string()
    .describe('The original user request, including any attachment context.'),
  tasks: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      prompt: z.string(),
    })
  ),
});
export type ResolveRequiredDetailsInput = z.infer<
  typeof ResolveRequiredDetailsInputSchema
>;

const MissingFieldsSchema = z.object({
  id: z.string(),
  fields: z.array(z.string()),
});

const ResolveRequiredDetailsOutputSchema = z.object({
  missing: z.array(MissingFieldsSchema),
});
export type ResolveRequiredDetailsOutput = z.infer<
  typeof ResolveRequiredDetailsOutputSchema
>;

export async function resolveRequiredDetails(
  input: ResolveRequiredDetailsInput
): Promise<Result<ResolveRequiredDetailsOutput>> {
  const result = await callAI<ResolveRequiredDetailsOutput>({
    responseFormat: 'json_object',
    outputSchema: ResolveRequiredDetailsOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You identify missing required fields for each task.
Use ONLY these field keys by task type:
- announcement: topic, recipients
- messages: recipient, text
- calendar: title, date, time
- form: title, questions
- gallery: images, description
- email: body
Rules:
- If a field is already provided in the user query or task prompt, do NOT list it as missing.
- Relative dates like "tomorrow", "tomorow", "tomorows", "tomorrow's", "tmr", "tmrw", "next Friday", "tonight", or "tonite" satisfy the date requirement.
- If "everyone" is mentioned for recipients, recipients are NOT missing.
- Attachments may appear in the query as "Attached files" lines; use that to satisfy gallery images.
- If a task type is not listed above (social, transaction, other), return an empty fields list.
Return ONLY valid JSON matching: { "missing": Array<{ "id": string, "fields": string[] }> }.`,
      },
      {
        role: 'user',
        content: `User request:\n${input.query}\n\nTasks:\n${input.tasks
          .map(task => `${task.id} | ${task.type} | ${task.prompt}`)
          .join('\n')}`,
      },
    ],
  });
  return result;
}
