
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
  prompt: z.string().describe('A natural language prompt describing the social media post. For example: "Create a post for the Innovators Club about our next meeting on web development. The target audience is students interested in tech. Include a call to action to join our Discord."'),
  photoDataUris: z
    .array(z.string())
    .optional()
    .describe(
      "A photo to include in the social media post, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type GenerateSocialMediaPostInput = z.infer<typeof GenerateSocialMediaPostInputSchema>;

const GenerateSocialMediaPostOutputSchema = z.object({
  title: z.string().describe('A short, catchy title for the social media post based on the prompt.'),
  postText: z.string().describe('The generated social media post text, no more than 280 characters.'),
  imageCaption: z.string().optional().describe('The generated caption for the image, if applicable.'),
  images: z.array(z.string()).optional().describe("The images for the post, if any.")
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
  Your task is to create an engaging social media post based on the user's prompt to promote club activities and attract new members.
  Based on the user's prompt, generate a short, catchy title for the post.
  The social media post text should be no more than 280 characters.

  User Prompt: {{{prompt}}}

  {{#if photoDataUris}}
  Here are photos for the post: 
  {{#each photoDataUris}}
    {{media url=this}}
  {{/each}}
  The output 'images' field should contain the provided photoDataUris.
  Create an engaging image caption to go along with these photos.
  {{else}}
  Do not generate an image caption if no photos are provided. The 'images' output field should be an empty array or omitted.
  {{/if}}
  `,
});

const generateSocialMediaPostFlow = ai.defineFlow(
  {
    name: 'generateSocialMediaPostFlow',
    inputSchema: GenerateSocialMediaPostInputSchema,
    outputSchema: GenerateSocialMediaPostOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    if (!output) {
      throw new Error("Could not generate social media post.");
    }
    // The prompt now handles the logic for returning images. 
    // We just need to ensure the `images` field is an array if it exists, otherwise provide an empty one.
    return {
        ...output,
        images: output.images || []
    };
  }
);
