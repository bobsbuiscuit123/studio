'use server';

/**
 * @fileOverview An AI agent for generating meeting slides from a prompt.
 *
 * - generateMeetingSlides - A function that generates meeting slides based on a prompt.
 * - GenerateMeetingSlidesInput - The input type for the generateMeetingSlides function.
 * - GenerateMeetingSlidesOutput - The return type for the generateMeetingSlides function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateMeetingSlidesInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt describing the meeting content. For example: "Create slides for the Innovators Club meeting on July 26. Key updates are the new project launch and the upcoming hackathon. Action items are to sign up for the hackathon and submit project ideas."'),
});
export type GenerateMeetingSlidesInput = z.infer<typeof GenerateMeetingSlidesInputSchema>;

const GenerateMeetingSlidesOutputSchema = z.object({
  slideContent: z.string().describe('The generated content for the meeting slides in markdown format.'),
});
export type GenerateMeetingSlidesOutput = z.infer<typeof GenerateMeetingSlidesOutputSchema>;

export async function generateMeetingSlides(input: GenerateMeetingSlidesInput): Promise<GenerateMeetingSlidesOutput> {
  return generateMeetingSlidesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateMeetingSlidesPrompt',
  input: {schema: GenerateMeetingSlidesInputSchema},
  output: {schema: GenerateMeetingSlidesOutputSchema},
  prompt: `You are an AI assistant designed to generate meeting slides for club presidents.

  Based on the user's prompt, create content for meeting slides in markdown format. The slide content should be well-formatted, easy to present, and structured with clear headings.

  User prompt: {{{prompt}}}
  `,
});

const generateMeetingSlidesFlow = ai.defineFlow(
  {
    name: 'generateMeetingSlidesFlow',
    inputSchema: GenerateMeetingSlidesInputSchema,
    outputSchema: GenerateMeetingSlidesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
