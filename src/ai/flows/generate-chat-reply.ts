
'use server';

/**
 * @fileOverview Generates a suggested reply for a chat message.
 *
 * - generateChatReply - A function that generates a chat reply.
 * - GenerateChatReplyInput - The input type for the generateChatReply function.
 * - GenerateChatReplyOutput - The return type for the generateChatReply function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateChatReplyInputSchema = z.object({
  history: z.string().describe("The recent chat history, with each message on a new line, formatted as 'SenderName: message text'."),
});
export type GenerateChatReplyInput = z.infer<
  typeof GenerateChatReplyInputSchema
>;

const GenerateChatReplyOutputSchema = z.object({
  reply: z.string().describe('A short, context-aware suggested reply.'),
});
export type GenerateChatReplyOutput = z.infer<
  typeof GenerateChatReplyOutputSchema
>;

export async function generateChatReply(
  input: GenerateChatReplyInput
): Promise<GenerateChatReplyOutput> {
  return generateChatReplyFlow(input);
}

const generateReplyPrompt = ai.definePrompt({
  name: 'generateReplyPrompt',
  input: {schema: GenerateChatReplyInputSchema},
  output: {schema: GenerateChatReplyOutputSchema},
  prompt: `You are a helpful assistant that suggests concise and relevant replies for a chat conversation.
The user is "You". Based on the last few messages, suggest a short reply. Keep it casual and brief.

Recent History:
{{{history}}}
`,
});

const generateChatReplyFlow = ai.defineFlow(
  {
    name: 'generateChatReplyFlow',
    inputSchema: GenerateChatReplyInputSchema,
    outputSchema: GenerateChatReplyOutputSchema,
  },
  async input => {
    const {output} = await generateReplyPrompt(input);
    return output!;
  }
);
