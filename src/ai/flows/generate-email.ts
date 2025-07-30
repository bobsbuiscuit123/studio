
'use server';

/**
 * @fileOverview Generates an email draft using AI from a natural language prompt.
 *
 * - generateEmail - A function that generates an email draft.
 * - GenerateEmailInput - The input type for the generateEmail function.
 * - GenerateEmailOutput - The return type for the generateEmail function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

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
): Promise<GenerateEmailOutput> {
  return generateEmailFlow(input);
}

const generateEmailPrompt = ai.definePrompt({
  name: 'generateEmailPrompt',
  input: {schema: GenerateEmailInputSchema},
  output: {schema: GenerateEmailOutputSchema},
  prompt: `You are a club communication manager. Your task is to write a clear, concise, and friendly email to all club members based on the user's prompt.
The email should be professional yet approachable.

User prompt: {{{prompt}}}
`,
});

const generateEmailFlow = ai.defineFlow(
  {
    name: 'generateEmailFlow',
    inputSchema: GenerateEmailInputSchema,
    outputSchema: GenerateEmailOutputSchema,
  },
  async input => {
    const {output} = await generateEmailPrompt(input);
    return output!;
  }
);
