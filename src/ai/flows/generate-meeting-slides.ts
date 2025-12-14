'use server';

/**
 * @fileOverview An AI agent for generating meeting slides from a prompt.
 *
 * - generateMeetingSlides - A function that generates meeting slides based on a prompt.
 * - GenerateMeetingSlidesInput - The input type for the generateMeetingSlides function.
 * - GenerateMeetingSlidesOutput - The return type for the generateMeetingSlides function.
 */

import {ai, logAiEnvDebug} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateMeetingSlidesInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt describing the meeting content. For example: "Create slides for the Innovators Club meeting on July 26. Key updates are the new project launch and the upcoming hackathon. Action items are to sign up for the hackathon and submit project ideas."'),
});
export type GenerateMeetingSlidesInput = z.infer<typeof GenerateMeetingSlidesInputSchema>;


const SlideSchema = z.object({
    title: z.string().describe("The title of the slide."),
    content: z.string().describe("The bulleted or paragraph content for the slide body. Should be in markdown format. Use bullet points with asterisks."),
});

const GenerateMeetingSlidesOutputSchema = z.object({
  slides: z.array(SlideSchema).describe("An array of slide objects for the presentation."),
});
export type GenerateMeetingSlidesOutput = z.infer<typeof GenerateMeetingSlidesOutputSchema>;

export async function generateMeetingSlides(input: GenerateMeetingSlidesInput): Promise<GenerateMeetingSlidesOutput> {
  logAiEnvDebug('generateMeetingSlides');
  try {
    return await generateMeetingSlidesFlow(input);
  } catch (error: any) {
    const message =
      error?.message ??
      'Failed to generate slides. Please try again in a moment.';
    console.error('[AI_DEBUG] generateMeetingSlides error:', error);
    throw new Error(message);
  }
}

const prompt = ai.definePrompt({
  name: 'generateMeetingSlidesPrompt',
  input: {schema: GenerateMeetingSlidesInputSchema},
  output: {schema: GenerateMeetingSlidesOutputSchema},
  prompt: `You are an AI assistant designed to generate meeting slides for club presidents.

  Based on the user's prompt, create an array of slides. Each slide should have a title and content formatted in markdown.
  The first slide should be a title slide and the last slide should be a "Q&A" or "Thank you" slide.

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
