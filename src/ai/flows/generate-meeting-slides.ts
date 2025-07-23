'use server';

/**
 * @fileOverview An AI agent for generating meeting slides.
 *
 * - generateMeetingSlides - A function that generates meeting slides based on club data and president input.
 * - GenerateMeetingSlidesInput - The input type for the generateMeetingSlides function.
 * - GenerateMeetingSlidesOutput - The return type for the generateMeetingSlides function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

export const GenerateMeetingSlidesInputSchema = z.object({
  clubName: z.string().describe('The name of the club.'),
  meetingDate: z.string().describe('The date of the meeting.'),
  keyUpdates: z.string().describe('Key updates to be presented at the meeting.'),
  actionItems: z.string().describe('Action items for club members.'),
  additionalNotes: z.string().optional().describe('Any additional notes or information.'),
});
export type GenerateMeetingSlidesInput = z.infer<typeof GenerateMeetingSlidesInputSchema>;

export const GenerateMeetingSlidesOutputSchema = z.object({
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

  Based on the following information, create content for meeting slides in markdown format:

  Club Name: {{{clubName}}}
  Meeting Date: {{{meetingDate}}}
  Key Updates: {{{keyUpdates}}}
  Action Items: {{{actionItems}}}
  Additional Notes: {{{additionalNotes}}}

  The slide content should be well-formatted and easy to present. Return the entire slide content as a string.
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
