'use server';

/**
 * @fileOverview Generates club announcements using AI.
 *
 * - generateClubAnnouncement - A function that generates a club announcement.
 * - GenerateClubAnnouncementInput - The input type for the generateClubAnnouncement function.
 * - GenerateClubAnnouncementOutput - The return type for the generateClubAnnouncement function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

export const GenerateClubAnnouncementInputSchema = z.object({
  eventTitle: z.string().describe('The title of the event.'),
  eventDescription: z.string().describe('A detailed description of the event.'),
  eventDate: z.string().describe('The date and time of the event.'),
  deadline: z.string().optional().describe('Optional deadline related to the event.'),
  additionalInfo: z.string().optional().describe('Any additional relevant information.'),
});
export type GenerateClubAnnouncementInput = z.infer<
  typeof GenerateClubAnnouncementInputSchema
>;

export const GenerateClubAnnouncementOutputSchema = z.object({
  announcement: z.string().describe('The generated announcement text.'),
});
export type GenerateClubAnnouncementOutput = z.infer<
  typeof GenerateClubAnnouncementOutputSchema
>;

export async function generateClubAnnouncement(
  input: GenerateClubAnnouncementInput
): Promise<GenerateClubAnnouncementOutput> {
  return generateClubAnnouncementFlow(input);
}

const generateClubAnnouncementPrompt = ai.definePrompt({
  name: 'generateClubAnnouncementPrompt',
  input: {schema: GenerateClubAnnouncementInputSchema},
  output: {schema: GenerateClubAnnouncementOutputSchema},
  prompt: `You are a club communication manager. Generate a concise and engaging announcement for the club members based on the event details provided.

Event Title: {{{eventTitle}}}
Event Description: {{{eventDescription}}}
Event Date: {{{eventDate}}}
Deadline: {{{deadline}}}
Additional Info: {{{additionalInfo}}}

Announcement:`,
});

const generateClubAnnouncementFlow = ai.defineFlow(
  {
    name: 'generateClubAnnouncementFlow',
    inputSchema: GenerateClubAnnouncementInputSchema,
    outputSchema: GenerateClubAnnouncementOutputSchema,
  },
  async input => {
    const {output} = await generateClubAnnouncementPrompt(input);
    return output!;
  }
);
