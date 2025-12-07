
'use server';

/**
 * @fileOverview Creates calendar events using AI from a natural language prompt.
 *
 * - addCalendarEvent - A function that creates a calendar event.
 * - AddCalendarEventInput - The input type for the addCalendarEvent function.
 * - AddCalendarEventOutput - The return type for the addCalendarEvent function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AddCalendarEventInputSchema = z.object({
  prompt: z.string().describe('A natural language prompt describing the event to be created. For example: "Schedule a meeting for next Tuesday at 2pm in Room 101 to discuss the Q3 budget."'),
});
export type AddCalendarEventInput = z.infer<
  typeof AddCalendarEventInputSchema
>;

const AddCalendarEventOutputSchema = z.object({
    title: z.string().describe('The title of the event.'),
    description: z.string().describe('A detailed description of the event.'),
    date: z.string().describe('The date and time of the event in a machine-readable format like an ISO string. The current year is 2024.'),
    location: z.string().describe('The location of the event.'),
}).describe("The event that was created.");
export type AddCalendarEventOutput = z.infer<
  typeof AddCalendarEventOutputSchema
>;

export async function addCalendarEvent(
  input: AddCalendarEventInput
): Promise<AddCalendarEventOutput> {
  return addCalendarEventFlow(input);
}

const addEventPrompt = ai.definePrompt({
    name: "addEventPrompt",
    input: {schema: AddCalendarEventInputSchema},
    output: {schema: AddCalendarEventOutputSchema},
    prompt: `You are an expert at parsing natural language to create calendar events.
    The user will provide a prompt, and you must extract the event details and format them correctly.
    
    Prompt: {{{prompt}}}
    
    The current date is ${new Date().toDateString()}. Use this for context when interpreting relative dates like "next Tuesday".
    `
});


const addCalendarEventFlow = ai.defineFlow(
  {
    name: 'addCalendarEventFlow',
    inputSchema: AddCalendarEventInputSchema,
    outputSchema: AddCalendarEventOutputSchema,
  },
  async input => {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const { output } = await addEventPrompt(input);
        if (!output) {
            throw new Error("Could not generate event from prompt.");
        }
        
        return output;
      } catch (error: any) {
        attempts++;
        // Check for common rate limit or temporary server error status codes.
        const isRetryable = error.status === 429 || error.status === 503 || (error.message && (error.message.includes('429') || error.message.includes('503')));
        
        if (attempts >= maxAttempts || !isRetryable) {
          // If it's the last attempt or not a retryable error, rethrow.
          console.error("Non-retryable error or max attempts reached:", error);
          throw error;
        }

        // Wait for an exponentially increasing amount of time before the next attempt
        const waitTime = (2 ** attempts) * 1000;
        console.log(`Attempt ${attempts} failed. Retrying in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    throw new Error("Failed to generate event after multiple attempts.");
  }
);
