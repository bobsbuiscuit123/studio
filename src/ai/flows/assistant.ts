
'use server';

/**
 * @fileOverview A general-purpose AI assistant that can use tools to perform tasks.
 *
 * - runAssistant - A function that handles the assistant's query processing.
 * - AssistantInput - The input type for the runAssistant function.
 * - AssistantOutput - The return type for the runAssistant function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import {
  generateClubAnnouncement,
  GenerateClubAnnouncementInputSchema,
} from './generate-announcement';
import {
  generateMeetingSlides,
  GenerateMeetingSlidesInputSchema,
} from './generate-meeting-slides';
import {
  generateSocialMediaPost,
  GenerateSocialMediaPostInputSchema,
} from './generate-social-media-post';
import {
  addCalendarEvent,
  AddCalendarEventInputSchema,
} from './add-calendar-event';
import {
  addTransaction,
  AddTransactionInputSchema,
} from './add-transaction';
import { generateEmail, GenerateEmailInputSchema } from './generate-email';

const announcementTool = ai.defineTool(
  {
    name: 'generateClubAnnouncement',
    description: 'Generates a club announcement based on a text prompt. Returns the title and content.',
    inputSchema: GenerateClubAnnouncementInputSchema,
    outputSchema: z.any(),
  },
  async (input) => generateClubAnnouncement(input)
);

const slidesTool = ai.defineTool(
  {
    name: 'generateMeetingSlides',
    description: 'Generates meeting slides from a prompt. Returns an array of slide objects, each with a title and content.',
    inputSchema: GenerateMeetingSlidesInputSchema,
    outputSchema: z.any(),
  },
  async (input) => generateMeetingSlides(input)
);

const socialPostTool = ai.defineTool(
  {
    name: 'generateSocialMediaPost',
    description: 'Generates a social media post, optionally with images. Returns the post title, text, and image URLs.',
    inputSchema: GenerateSocialMediaPostInputSchema,
    outputSchema: z.any(),
  },
  async (input) => generateSocialMediaPost(input)
);

const calendarTool = ai.defineTool(
  {
    name: 'addCalendarEvent',
    description: 'Adds an event to the club calendar from a natural language prompt. Returns the created event details.',
    inputSchema: AddCalendarEventInputSchema,
    outputSchema: z.any(),
  },
  async (input) => addCalendarEvent(input)
);

const transactionTool = ai.defineTool(
    {
        name: 'addTransaction',
        description: 'Creates a financial transaction from a natural language prompt. Determines if it is income or expense. Returns transaction details.',
        inputSchema: AddTransactionInputSchema,
        outputSchema: z.any(),
    },
    async (input) => addTransaction(input)
);

const emailTool = ai.defineTool(
    {
        name: 'generateEmail',
        description: 'Generates an email draft to all club members from a prompt. Returns the email subject and body.',
        inputSchema: GenerateEmailInputSchema,
        outputSchema: z.any(),
    },
    async (input) => generateEmail(input)
);


const AssistantInputSchema = z.object({
  query: z.string().describe('The user\'s request.'),
});
export type AssistantInput = z.infer<typeof AssistantInputSchema>;

// The output can be a string for a simple text response, or it could be structured data from a tool.
const AssistantOutputSchema = z.object({
  response: z.string().describe("A summary of the action taken or a direct answer to the user's query."),
  toolOutput: z.any().optional().describe("The direct JSON output from any tool that was called."),
  toolName: z.string().optional().describe("The name of the tool that was called."),
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
  // Let the model decide the output structure based on the tools.
  tools: [announcementTool, slidesTool, socialPostTool, calendarTool, transactionTool, emailTool],
  prompt: `You are a helpful AI assistant for a school club. Your name is ClubHub AI.
  Your purpose is to help the user manage their club by using the available tools.
  The user's request is: {{{query}}}

  - Based on the user's request, decide which tool is most appropriate to use.
  - If you use a tool, summarize the result of the action in the 'response' field. For example, if you add a calendar event, respond with "I've added the event to the calendar."
  - Include the direct JSON output from the tool in the 'toolOutput' field and the tool's name in 'toolName'.
  - If no specific tool seems appropriate for the request, provide a helpful text-based response in the 'response' field.
  - If you cannot fulfill the request, clearly state that.
  `,
  output: { schema: AssistantOutputSchema },
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
    const { output, history } = await assistantPrompt(input);
    if (!output) {
      throw new Error("Assistant failed to generate a response.");
    }
    
    const toolCalls = history[history.length - 1]?.message.toolRequest?.calls;

    if (toolCalls && toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        if (toolCall.output) {
            return {
                response: output.response,
                toolOutput: toolCall.output,
                toolName: toolCall.name,
            };
        }
    }
    
    return { response: output.response };
  }
);

