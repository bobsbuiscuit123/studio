/**
 * @fileOverview Plans actionable tasks from a user request without executing them.
 * Used by the Assistant UI to collect confirmations before calling individual flows.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const PlannerInputSchema = z.object({
  query: z.string().describe('The user request, e.g., "Make slides about safety training and post an announcement with them and email everyone."'),
});
export type PlannerInput = z.infer<typeof PlannerInputSchema>;

const TaskSchema = z.object({
  id: z.string().describe('A short ID for the task.'),
  type: z.enum(['announcement', 'slides', 'calendar', 'email', 'transaction', 'social', 'other']).describe('What type of task to run.'),
  prompt: z.string().describe('The prompt/details to use when executing the task.'),
  followUpQuestion: z.string().optional().describe('Any clarifying question the assistant should show to the user.'),
});

const PlannerOutputSchema = z.object({
  tasks: z.array(TaskSchema).describe('Planned tasks that can be edited and executed.'),
  summary: z.string().describe('A short summary of what will be done.'),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export async function planAssistantTasks(
  input: PlannerInput
): Promise<PlannerOutput> {
  const { logAiEnvDebug } = await import('@/ai/genkit');
  logAiEnvDebug('planAssistantTasks');
  try {
    return await plannerFlow(input);
  } catch (error: any) {
    console.error('[AI_DEBUG] planAssistantTasks error:', error);
    throw new Error(
      error?.message ??
        'Failed to plan tasks. Please try again in a moment.'
    );
  }
}

const plannerPrompt = ai.definePrompt({
  name: 'assistantPlannerPrompt',
  input: { schema: PlannerInputSchema },
  output: { schema: PlannerOutputSchema },
  prompt: `You are an orchestration planner for a club management assistant.
User request: {{{query}}}

You must break the request into clear tasks. Allowed task types:
- announcement (uses generateClubAnnouncement)
- slides (uses generateMeetingSlides)
- calendar (uses addCalendarEvent)
- email (uses generateEmail)
- transaction (uses addTransaction)
- social (uses generateSocialMediaPost)
- other (for anything else)

Rules:
- Be concise and specific in the prompt field so it can be executed directly.
- If anything is ambiguous, add a followUpQuestion to ask the user before sending.
- Provide 1–5 tasks maximum.
- Summarize the overall plan in 'summary'.
`,
});

const plannerFlow = ai.defineFlow(
  {
    name: 'assistantPlannerFlow',
    inputSchema: PlannerInputSchema,
    outputSchema: PlannerOutputSchema,
  },
  async input => {
    const { output } = await plannerPrompt(input);
    if (!output) {
      throw new Error('Planner did not return any tasks.');
    }
    return output;
  }
);
