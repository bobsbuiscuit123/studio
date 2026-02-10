/**
 * @fileOverview Determines announcement recipients from a prompt and app context.
 */

import { callAI } from '@/ai/genkit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const ResolveAnnouncementRecipientsInputSchema = z.object({
  prompt: z.string().describe('The announcement request or clarification.'),
  context: z
    .string()
    .optional()
    .describe('JSON app context including members, events, announcements, etc.'),
});
export type ResolveAnnouncementRecipientsInput = z.infer<
  typeof ResolveAnnouncementRecipientsInputSchema
>;

const ResolveAnnouncementRecipientsOutputSchema = z.object({
  mode: z.enum(['all', 'specific']),
  label: z.string().describe('Human-readable recipient label.'),
  recipients: z.array(z.string()).describe('Member emails for specific recipients.'),
});
export type ResolveAnnouncementRecipientsOutput = z.infer<
  typeof ResolveAnnouncementRecipientsOutputSchema
>;

export async function resolveAnnouncementRecipients(
  input: ResolveAnnouncementRecipientsInput
): Promise<Result<ResolveAnnouncementRecipientsOutput>> {
  const result = await callAI<ResolveAnnouncementRecipientsOutput>({
    responseFormat: 'json_object',
    outputSchema: ResolveAnnouncementRecipientsOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You determine who should receive an announcement.
If the user says everyone/all members/everybody, return mode "all", label "Everyone", and an empty recipients list.
If the user specifies a group (e.g., "people who viewed my last calendar event"), resolve it using the app context JSON and keep a short label that reflects the group description.
If the user names specific members, return their emails from the members list in the context and set label to their names (comma-separated).
If you cannot confidently map to member emails, return mode "all", label "Everyone", and empty recipients.
Use ONLY member emails from the provided context. Return ONLY valid JSON matching:
{ "mode": "all" | "specific", "label": string, "recipients": string[] }.`,
      },
      {
        role: 'user',
        content: input.context
          ? `App context:\n${input.context}\n\nRequest:\n${input.prompt}`
          : input.prompt,
      },
    ],
  });
  return result;
}
