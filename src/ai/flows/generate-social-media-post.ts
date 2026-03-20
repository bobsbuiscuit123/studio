
'use server';

/**
 * @fileOverview A social media post generator AI agent.
 *
 * - generateSocialMediaPost - A function that handles the social media post generation process.
 * - GenerateSocialMediaPostInput - The input type for the generateSocialMediaPost function.
 * - GenerateSocialMediaPostOutput - The return type for the generateSocialMediaPost function.
 */

import { callAI } from '@/ai/genkit';
import { MAX_TAB_AI_OUTPUT_CHARS } from '@/lib/ai-output-limit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { err, ok, type Result } from '@/lib/result';
import { z } from 'zod';

const GenerateSocialMediaPostInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt describing the social media post. For example: "Create a post for the Innovators Group about our next meeting on web development. The target audience is students interested in tech. Include a call to action to join our Discord."'),
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
): Promise<Result<GenerateSocialMediaPostOutput>> {
  const hasPhotos = Boolean(input.photoDataUris?.length);
  const text = await callAI<z.infer<typeof ModelOutputSchema>>({
    responseFormat: 'json_object',
    outputSchema: ModelOutputSchema,
    maxOutputChars: MAX_TAB_AI_OUTPUT_CHARS,
    messages: [
      {
        role: 'system',
        content: `You are a social media marketing expert for school clubs.
Your task is to create an engaging social media post based on the user's prompt to promote group activities and attract new members.
Based on the user's prompt, generate a short, catchy title for the post.
The social media post text should be no more than 280 characters.
If photos are provided, create an engaging image caption. If no photos are provided, do not include an imageCaption.
Return ONLY valid JSON matching: { "title": string, "postText": string, "imageCaption"?: string }.`,
      },
      {
        role: 'user',
        content: `${input.prompt}\n\nPhotos provided: ${hasPhotos ? 'yes' : 'no'}`,
      },
    ],
  });

  if (!text.ok) return text;
  const parsed = GenerateSocialMediaPostOutputSchema.safeParse({
    ...text.data,
    images: input.photoDataUris || [],
  });
  if (!parsed.success) {
    return err({
      code: 'AI_SCHEMA_INVALID',
      message: 'AI response validation failed.',
      detail: parsed.error.message,
      retryable: true,
      source: 'ai',
    });
  }
  const cleaned = {
    ...parsed.data,
    title: sanitizeAiText(parsed.data.title),
    postText: sanitizeAiText(parsed.data.postText),
    imageCaption: parsed.data.imageCaption
      ? sanitizeAiText(parsed.data.imageCaption)
      : undefined,
  };
  return ok(cleaned);
}
