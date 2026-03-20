
/**
 * @fileOverview Creates calendar events using AI from a natural language prompt.
 *
 * - addCalendarEvent - A function that creates a calendar event.
 * - AddCalendarEventInput - The input type for the addCalendarEvent function.
 * - AddCalendarEventOutput - The return type for the addCalendarEvent function.
 */

import { callAI } from '@/ai/genkit';
import { MAX_TAB_AI_OUTPUT_CHARS } from '@/lib/ai-output-limit';
import { type Result } from '@/lib/result';
import {z} from 'zod';

export const AddCalendarEventInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt describing the event to be created. For example: "Schedule a meeting for next Tuesday at 2pm in Room 101 to discuss the Q3 budget."'),
});
export type AddCalendarEventInput = z.infer<
  typeof AddCalendarEventInputSchema
>;

const AddCalendarEventOutputSchema = z.object({
    title: z.string().describe('The title of the event.'),
    description: z.string().describe('A detailed description of the event.'),
    date: z.string().describe('The date and time of the event in a machine-readable format like an ISO string. The current year is 2024.'),
    location: z.string().optional().describe('The location of the event (optional).'),
    hasTime: z.boolean().describe('Whether a specific time was provided.'),
}).describe("The event that was created.");
export type AddCalendarEventOutput = z.infer<
  typeof AddCalendarEventOutputSchema
>;

export async function addCalendarEvent(
  input: AddCalendarEventInput
): Promise<Result<AddCalendarEventOutput>> {
  const today = new Date();
  const result = await callAI<AddCalendarEventOutput>({
    responseFormat: 'json_object',
    outputSchema: AddCalendarEventOutputSchema,
    maxOutputChars: MAX_TAB_AI_OUTPUT_CHARS,
    messages: [
      {
        role: 'system',
        content: `You are an expert at parsing natural language to create calendar events.
The user will provide a prompt, and you must extract the event details and format them correctly.
The current date is ${today.toDateString()}. Use this for context when interpreting relative dates like "next Tuesday".
The current year is ${today.getFullYear()}.
If no location is provided, return an empty string for "location".
Return ONLY valid JSON matching: { "title": string, "description": string, "date": string, "location": string, "hasTime": boolean }.
The "date" must be a machine-readable ISO string.
If the user did not provide a time, set hasTime to false and set the date time to 00:00 local time.`,
      },
      {
        role: 'user',
        content: input.prompt,
      },
    ],
  });
  return result;
}
