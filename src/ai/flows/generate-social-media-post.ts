
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

// This schema defines the text-based output from the AI model.
const ModelOutputSchema = z.object({
  title: z.string().describe('A short, catchy title for the social media post based on the prompt.'),
  postText: z.string().describe('The generated social media post text, no more than 280 characters.'),
  imageCaption: z.string().optional().describe('The generated caption for the image, if applicable.'),
});

// This is the final output schema for the flow, including the images.
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
  output: {schema: ModelOutputSchema}, // AI only generates text content
  prompt: `You are a social media marketing expert for school clubs.
  Your task is to create an engaging social media post based on the user's prompt to promote club activities and attract new members.
  Based on the user's prompt, generate a short, catchy title for the post.
  The social media post text should be no more than 280 characters.

  User Prompt: {{{prompt}}}

  {{#if photoDataUris}}
  You have been provided with photos for the post. Create an engaging image caption to go along with these photos.
  {{else}}
  No photos were provided. Do not generate an image caption.
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
    // 1. Generate the text content from the AI.
    const {output: textOutput} = await prompt(input);
    if (!textOutput) {
      throw new Error("Could not generate social media post text.");
    }
    
    // 2. Construct the final output, ensuring the images array is always valid.
    // This logic now resides entirely in the TypeScript code, making it reliable.
    const finalOutput: GenerateSocialMediaPostOutput = {
        ...textOutput,
        images: input.photoDataUris || [], // Use the exact input URIs, or an empty array.
    };

    return finalOutput;
  }
);
