/**
 * @fileOverview Summarize missed activity into bullets + action links.
 */

import { callAI } from '@/ai/genkit';
import { sanitizeInternalHref } from '@/lib/ai-safety';
import { ok, type Result } from '@/lib/result';
import { z } from 'zod';

const ResolveMissedActivityInputSchema = z.object({
  summary: z.string().describe('Summary of missed activity items.'),
});
export type ResolveMissedActivityInput = z.infer<typeof ResolveMissedActivityInputSchema>;

const ResolveMissedActivityOutputSchema = z.object({
  title: z.string().describe('Short headline for the missed activity summary.'),
  bullets: z.array(z.string()).describe('Bullet list of what was missed.'),
  actions: z
    .array(
      z.object({
        label: z.string(),
        href: z.string(),
      })
    )
    .describe('Suggested actions with links to tabs.'),
});
export type ResolveMissedActivityOutput = z.infer<typeof ResolveMissedActivityOutputSchema>;

export async function resolveMissedActivity(
  input: ResolveMissedActivityInput
): Promise<Result<ResolveMissedActivityOutput>> {
  const result = await callAI<ResolveMissedActivityOutput>({
    responseFormat: 'json_object',
    outputSchema: ResolveMissedActivityOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You summarize missed group activity into a short title, 3-5 bullets, and 2-3 action links.
Only use these hrefs: /announcements, /calendar, /messages, /forms, /members, /gallery, /finances.
Keep bullets short, specific, and tied to the provided summary (no generic text like "new activity happened").
Return JSON matching: { "title": string, "bullets": string[], "actions": { "label": string, "href": string }[] }`,
      },
      {
        role: 'user',
        content: input.summary,
      },
    ],
  });
  if (!result.ok) return result;
  const actions = Array.isArray(result.data.actions)
    ? result.data.actions
        .map(action => ({
          ...action,
          href: sanitizeInternalHref(action.href) ?? '/dashboard',
        }))
        .filter(action => Boolean(action.href))
    : [];
  return ok({
    ...result.data,
    actions,
  });
}
