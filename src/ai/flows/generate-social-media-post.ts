// src/ai/flows/generate-social-media-post.ts
'use server';

/**
 * @fileOverview A social media post generator AI agent.
 *
 * - generateSocialMediaPost - A function that handles the social media post generation process.
 * - GenerateSocialMediaPostInput - The input type for the generateSocialMediaPost function.
 * - GenerateSocialMediaPostOutput - The return type for the generateSocialMediaPost function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateSocialMediaPostInputSchema = z.object({
  clubName: z.string().describe('The name of the club.'),
  activityDescription: z.string().describe('A description of the club activity or event.'),
  targetAudience: z.string().describe('The target audience for the social media post.'),
  callToAction: z.string().describe('A call to action for the post (e.g., visit our website, join our next meeting).'),
  imageCaptionPreferences: z.string().optional().describe('Any preferences or specific requirements for the image caption.'),
  photoDataUri: z
    .string()
    .optional()
    .describe(
      "A photo to include in the social media post, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type GenerateSocialMediaPostInput = z.infer<typeof GenerateSocialMediaPostInputSchema>;

const GenerateSocialMediaPostOutputSchema = z.object({
  postText: z.string().describe('The generated social media post text.'),
  imageCaption: z.string().optional().describe('The generated caption for the image, if applicable.'),
});
export type GenerateSocialMediaPostOutput = z.infer<typeof GenerateSocialMediaPostOutputSchema>;

export async function generateSocialMediaPost(
  input: GenerateSocialMediaPostInput
): Promise<GenerateSocialMediaPostOutput> {
  return generateSocialMediaPostFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateSocialMediaPostPrompt',
  input: {schema: GenerateSocialMediaPostInputSchema},
  output: {schema: GenerateSocialMediaPostOutputSchema},
  prompt: `You are a social media marketing expert for school clubs.
  Your task is to create engaging social media posts to promote club activities and attract new members.

  Here are the details for the social media post:
  Club Name: {{{clubName}}}
  Activity Description: {{{activityDescription}}}
  Target Audience: {{{targetAudience}}}
  Call to Action: {{{callToAction}}}

  {{#if imageCaptionPreferences}}
  Special caption requirements: {{{imageCaptionPreferences}}}
  {{/if}}

  {{#if photoDataUri}}
  Here is a photo for the post: {{media url=photoDataUri}}
  Create a image caption to go along with this photo.
  {{/if}}

  Generate a social media post that is appropriate for the specified target audience, and be sure to include the call to action.
  The social media post should be no more than 280 characters.
  `, // Twitter post length
});

const generateSocialMediaPostFlow = ai.defineFlow(
  {
    name: 'generateSocialMediaPostFlow',
    inputSchema: GenerateSocialMediaPostInputSchema,
    outputSchema: GenerateSocialMediaPostOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
