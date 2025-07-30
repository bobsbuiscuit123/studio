
'use server';

/**
 * @fileOverview Generates club announcements using AI from a natural language prompt.
 *
 * - generateClubAnnouncement - A function that generates a club announcement.
 * - GenerateClubAnnouncementInput - The input type for the generateClubAnnouncement function.
 * - GenerateClubAnnouncementOutput - The return type for the generateClubAnnouncement function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateClubAnnouncementInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt for the announcement to generate. For example: "Draft an announcement for our annual bake sale next Friday at 2 PM. We need volunteers to sign up by Wednesday."'),
  photoDataUris: z
    .array(z.string())
    .optional()
    .describe(
      "A photo to include in the announcement, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type GenerateClubAnnouncementInput = z.infer<
  typeof GenerateClubAnnouncementInputSchema
>;

const GenerateClubAnnouncementOutputSchema = z.object({
  title: z.string().describe('A suitable title for the event announcement.'),
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
  prompt: `You are a club communication manager. Generate a concise and engaging announcement for the club members based on the user's prompt.
From the user's prompt, determine a good title for the announcement.

User prompt: {{{prompt}}}

{{#if photoDataUris}}
The user has provided images. Take them into consideration when writing the announcement, but do not explicitly reference them.
{{#each photoDataUris}}
  {{media url=this}}
{{/each}}
{{/if}}
`,
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
