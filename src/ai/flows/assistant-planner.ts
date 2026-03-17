/**
 * @fileOverview Plans actionable tasks from a user request without executing them.
 * Used by the Assistant UI to collect confirmations before calling individual flows.
 */

import { callAI } from '@/ai/genkit';
import { clampAssistantPrompt } from '@/ai/flows/assistant-prompt-limit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const PlannerInputSchema = z.object({
  query: z
    .string()
    .describe(
      'The user request, e.g., "Post an announcement about safety training and email everyone."'
    ),
  context: z
    .string()
    .optional()
    .describe('Recent chat context and prior outputs to resolve references.'),
});
export type PlannerInput = z.infer<typeof PlannerInputSchema>;

const TaskSchema = z.object({
  id: z.string().describe('A short ID for the task.'),
  type: z
    .enum([
      'announcement',
      'form',
      'calendar',
      'email',
      'messages',
      'gallery',
      'transaction',
      'other',
    ])
    .describe('What type of task to run.'),
  prompt: z.string().describe('The prompt/details to use when executing the task.'),
  title: z
    .string()
    .optional()
    .describe('A concise AI-generated title when the task type benefits from one, especially announcements.'),
  draft: z
    .string()
    .optional()
    .describe('An editable draft preview for the task when enough details are available.'),
  followUpQuestions: z
    .array(z.string())
    .optional()
    .describe('Clarifying questions the assistant should show to the user.'),
});

const PlannerOutputSchema = z.object({
  tasks: z.array(TaskSchema).describe('Planned tasks that can be edited and executed.'),
  summary: z.string().describe('A short summary of what will be done.'),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export async function planAssistantTasks(
  input: PlannerInput
): Promise<Result<PlannerOutput>> {
  const baseSystemMessage = `Plan task boxes for a school/group app. Return JSON only: {"tasks":[...],"summary":"..."}.
Allowed types: announcement, form, calendar, email, messages, gallery, transaction, other.
Each task: id, type, prompt. Optional: title, draft, followUpQuestions.
Capabilities + required fields:
- announcement: create reminder/update for members; core message alone is enough
- email: create email; core message alone is enough
- messages: DM/group message; recipient required
- calendar: create event; topic/title + date + time required
- form: create form; actual questions required
- gallery: add gallery images; at least one image required
- transaction: finance entry; amount required
- other: unsupported or informational query, not a task
Rules:
- Preserve exact wording when useful.
- Ask follow-ups only for truly required missing fields. If the task can already be done in-app, ask none.
- For announcements, do NOT ask for date/time/location/event details unless the user explicitly asks to include them.
- Do NOT create calendar just because the user mentioned an event. Calendar only when they explicitly ask to create/add/schedule/put on calendar.
- If user asks a question about existing app data, return one type "other" task with a short helpful response in prompt.
- Multiple requested channels -> multiple tasks.
Examples:
- "remind everyone to come to our event" -> announcement only
- "announce and email everyone about dues" -> announcement + email
- "put our halloween social on the calendar for tomorrow at 5pm at Dulles High School" -> calendar
- "did any members view my last announcement" -> other
Drafts:
- announcement: body only
- email: Subject line, blank line, body
- messages: message only
- calendar: Title, Date, Time, Location, blank line, Details
- form: Title, Description, numbered questions
- transaction: Description, Amount, Date, Status
- gallery: short description
- For announcement tasks with enough detail, include a short separate title like "Dues Reminder".
If details are missing, omit draft instead of guessing. Summary: 1-2 short natural sentences.`;
  const rawQuery = clampAssistantPrompt(input.query).trim();
  const rawContext = clampAssistantPrompt(input.context?.trim());
  const contextLabel = '\n\nRecent context:\n';
  const maxTotalChars = 2936;
  const maxQueryChars = Math.max(0, maxTotalChars - baseSystemMessage.length - 64);
  const cappedQuery = rawQuery.slice(0, maxQueryChars);
  const remainingForContext = Math.max(
    0,
    maxTotalChars - baseSystemMessage.length - cappedQuery.length - contextLabel.length
  );
  const trimmedContext =
    rawContext && remainingForContext > 0
      ? rawContext.slice(Math.max(0, rawContext.length - Math.min(remainingForContext, 500)))
      : '';
  const systemContent = trimmedContext
    ? `${baseSystemMessage}${contextLabel}${trimmedContext}`
    : baseSystemMessage;
  const output = await callAI<PlannerOutput>({
    responseFormat: 'json_object',
    outputSchema: PlannerOutputSchema,
    messages: [
      {
        role: 'system',
        content: systemContent,
      },
      {
        role: 'user',
        content: cappedQuery,
      },
    ],
  });
  return output;
}
