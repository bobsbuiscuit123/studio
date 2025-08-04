
'use server';

/**
 * @fileOverview A general-purpose AI assistant that can use tools to perform tasks.
 *
 * - runAssistant - A function that handles the assistant's query processing.
 * - AssistantInput - The input type for the runAssistant function.
 * - AssistantOutput - The return type for the runAssistant function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import {
  generateClubAnnouncement,
  GenerateClubAnnouncementInput,
  GenerateClubAnnouncementOutput,
} from './generate-announcement';
import {
  generateMeetingSlides,
  GenerateMeetingSlidesInput,
  GenerateMeetingSlidesOutput,
} from './generate-meeting-slides';
import {
  generateSocialMediaPost,
  GenerateSocialMediaPostInput,
  GenerateSocialMediaPostOutput,
} from './generate-social-media-post';
import {
  addCalendarEvent,
  AddCalendarEventInput,
  AddCalendarEventOutput,
} from './add-calendar-event';

// Define tools for the assistant to use
const announcementTool = ai.defineTool(
  {
    name: 'generateClubAnnouncement',
    description: 'Generates a club announcement.',
    inputSchema: z.custom<GenerateClubAnnouncementInput>(),
    outputSchema: z.custom<GenerateClubAnnouncementOutput>(),
  },
  async (input) => generateClubAnnouncement(input)
);

const slidesTool = ai.defineTool(
  {
    name: 'generateMeetingSlides',
    description: 'Generates meeting slides.',
    inputSchema: z.custom<GenerateMeetingSlidesInput>(),
    outputSchema: z.custom<GenerateMeetingSlidesOutput>(),
  },
  async (input) => generateMeetingSlides(input)
);

const socialPostTool = ai.defineTool(
  {
    name: 'generateSocialMediaPost',
    description: 'Generates a social media post.',
    inputSchema: z.custom<GenerateSocialMediaPostInput>(),
    outputSchema: z.custom<GenerateSocialMediaPostOutput>(),
  },
  async (input) => generateSocialMediaPost(input)
);

const calendarTool = ai.defineTool(
  {
    name: 'addCalendarEvent',
    description: 'Adds an event to the club calendar.',
    inputSchema: z.custom<AddCalendarEventInput>(),
    outputSchema: z.custom<AddCalendarEventOutput>(),
  },
  async (input) => addCalendarEvent(input)
);

const AssistantInputSchema = z.object({
  query: z.string().describe('The user\'s request.'),
});
export type AssistantInput = z.infer<typeof AssistantInputSchema>;

const AssistantOutputSchema = z.object({
  response: z.string().describe("The assistant's response to the user."),
});
export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

export async function runAssistant(
  input: AssistantInput
): Promise<AssistantOutput> {
  return assistantFlow(input);
}

const assistantPrompt = ai.definePrompt({
  name: 'assistantPrompt',
  input: { schema: AssistantInputSchema },
  output: { schema: AssistantOutputSchema },
  tools: [announcementTool, slidesTool, socialPostTool, calendarTool],
  prompt: `You are a helpful AI assistant for a school club. Your name is Clubhouse AI.
  Use the available tools to help the user with their request.
  The user's request is: {{{query}}}
  If you use a tool, summarize the result to the user.
  If you can't help with a request, say so.`,
  config: {
    safetySettings: [
        {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_ONLY_HIGH',
        }
    ]
  }
});

const assistantFlow = ai.defineFlow(
  {
    name: 'assistantFlow',
    inputSchema: AssistantInputSchema,
    outputSchema: AssistantOutputSchema,
  },
  async (input) => {
    const { output } = await assistantPrompt(input);
    return output!;
  }
);
