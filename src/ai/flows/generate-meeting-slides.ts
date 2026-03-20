'use server';

/**
 * @fileOverview An AI agent for generating meeting slides from a prompt.
 *
 * - generateMeetingSlides - A function that generates meeting slides based on a prompt.
 * - GenerateMeetingSlidesInput - The input type for the generateMeetingSlides function.
 * - GenerateMeetingSlidesOutput - The return type for the generateMeetingSlides function.
 */

import { callAI } from '@/ai/genkit';
import { MAX_TAB_AI_OUTPUT_CHARS } from '@/lib/ai-output-limit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const GenerateMeetingSlidesInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt describing the meeting content. For example: "Create slides for the Innovators Group meeting on July 26. Key updates are the new project launch and the upcoming hackathon. Action items are to sign up for the hackathon and submit project ideas."'),
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

export async function generateMeetingSlides(
  input: GenerateMeetingSlidesInput
): Promise<Result<GenerateMeetingSlidesOutput>> {
  const result = await callAI<GenerateMeetingSlidesOutput>({
    responseFormat: 'json_object',
    outputSchema: GenerateMeetingSlidesOutputSchema,
    maxOutputChars: MAX_TAB_AI_OUTPUT_CHARS,
    messages: [
      {
        role: 'system',
        content: `You are an AI assistant designed to generate meeting slides for group presidents.
Based on the user's prompt, create an array of slides. Each slide should have a title and content formatted in markdown.
The first slide should be a title slide and the last slide should be a "Q&A" or "Thank you" slide.
Return ONLY valid JSON matching: { "slides": Array<{ "title": string, "content": string }> }.`,
      },
      {
        role: 'user',
        content: input.prompt,
      },
    ],
  });
  return result;
}
