'use server';

/**
 * @fileOverview Creates calendar events using AI.
 *
 * - addCalendarEvent - A function that creates a calendar event.
 * - AddCalendarEventInput - The input type for the addCalendarEvent function.
 * - AddCalendarEventOutput - The return type for the addCalendarEvent function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

export const AddCalendarEventInputSchema = z.object({
  title: z.string().describe('The title of the event.'),
  description: z.string().describe('A detailed description of the event.'),
  date: z.string().describe('The date and time of the event in a natural language format (e.g., "next Tuesday at 2pm").'),
  location: z.string().describe('The location of the event.'),
});
export type AddCalendarEventInput = z.infer<
  typeof AddCalendarEventInputSchema
>;

export const AddCalendarEventOutputSchema = z.object({
  event: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string(),
    location: z.string(),
  }).describe('The event that was created.'),
});
export type AddCalendarEventOutput = z.infer<
  typeof AddCalendarEventOutputSchema
>;

export async function addCalendarEvent(
  input: AddCalendarEventInput
): Promise<AddCalendarEventOutput> {
  return addCalendarEventFlow(input);
}

// This is a placeholder. In a real app, you'd save this to a database.
const createdEvents: any[] = [];

const addCalendarEventFlow = ai.defineFlow(
  {
    name: 'addCalendarEventFlow',
    inputSchema: AddCalendarEventInputSchema,
    outputSchema: AddCalendarEventOutputSchema,
  },
  async input => {
    // In a real application, you would save the event to a database here.
    // For now, we'll just log it and return it.
    console.log('Adding event:', input);
    const newEvent = {
        title: input.title,
        description: input.description,
        date: new Date().toISOString(), // In a real app, parse input.date
        location: input.location
    };
    createdEvents.push(newEvent);

    return {
      event: {
        ...input,
        date: new Date().toLocaleString() // Return a formatted date for display
      }
    };
  }
);
