/**
 * @fileOverview Generates a message draft and extracts the target recipient.
 */

import { callAI } from '@/ai/genkit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { ok, type Result } from '@/lib/result';
import { z } from 'zod';

export const GenerateMessageInputSchema = z.object({
  prompt: z
    .string()
    .describe('A natural language prompt describing who to message and what to say.'),
});
export type GenerateMessageInput = z.infer<typeof GenerateMessageInputSchema>;

const GenerateMessageOutputSchema = z.object({
  recipient: z
    .string()
    .describe('The person name or group chat name to send the message to.'),
  recipientType: z
    .enum(['person', 'group', 'unknown'])
    .describe('Whether the recipient is a person or a group chat.'),
  text: z.string().describe('The message text to send.'),
});
export type GenerateMessageOutput = z.infer<typeof GenerateMessageOutputSchema>;

export async function generateMessage(
  input: GenerateMessageInput
): Promise<Result<GenerateMessageOutput>> {
  const result = await callAI<GenerateMessageOutput>({
    responseFormat: 'json_object',
    outputSchema: GenerateMessageOutputSchema,
    messages: [
      {
        role: 'system',
        content: `You generate a message draft and identify the recipient.
If the prompt includes "Final content to use as-is", copy that content verbatim as the text.
If the user provided exact message text in quotes, use it verbatim.
If the recipient is ambiguous, set recipientType to "unknown" but still return the best guess.
Return ONLY valid JSON matching: { "recipient": string, "recipientType": "person"|"group"|"unknown", "text": string }.`,
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
    recipient: sanitizeAiText(result.data.recipient),
    text: sanitizeAiText(result.data.text),
  });
}
