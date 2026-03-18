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
  recipientLookupId: z
    .string()
    .optional()
    .describe('Lookup step id whose resolved recipients should be used for this task.'),
});

const LookupSchema = z.object({
  id: z.string().describe('A short ID for the lookup step.'),
  kind: z
    .enum(['announcement_viewers', 'form_non_viewers'])
    .describe('Which deterministic app lookup the app should execute.'),
  subject: z
    .enum(['last', 'latest', 'recent', 'current', 'mine', 'unknown'])
    .describe('Which record or time reference the user means.'),
  responseStyle: z
    .enum(['yes_no', 'count', 'who', 'summary'])
    .describe('How the answer should be phrased if this is a lookup-only request.'),
});

const PlannerOutputSchema = z.object({
  reply: z
    .string()
    .optional()
    .describe('Direct assistant reply when no task box is needed.'),
  lookups: z
    .array(LookupSchema)
    .optional()
    .describe('Deterministic app-data lookups the app should execute before answering or preparing tasks.'),
  tasks: z.array(TaskSchema).describe('Planned tasks that can be edited and executed.'),
  summary: z.string().describe('A short summary of what will be done.'),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export async function planAssistantTasks(
  input: PlannerInput
): Promise<Result<PlannerOutput>> {
  const baseSystemMessage = `Plan an assistant response for a school/group app. Return JSON only: {"reply"?:string,"lookups"?:[...],"tasks":[...],"summary":"..."}.
Allowed types: announcement, form, calendar, email, messages, gallery, transaction, other.
Each task: id, type, prompt. Optional: title, draft, followUpQuestions, recipientLookupId.
Each lookup: id, kind, subject, responseStyle.
Capabilities + required fields:
- announcement: create reminder/update for members; core message alone is enough
- email: create email; core message alone is enough
- messages: DM/group message; recipient required
- calendar: create event; topic/title + date required. Time optional. Location optional.
- form: create form; actual questions required
- gallery: add gallery images; at least one image required
- transaction: finance entry; amount required
- other: unsupported or informational query, not a task
Rules:
- Preserve exact wording when useful.
- Ask follow-ups only for truly required missing fields. If the task can already be done in-app, ask none.
- For calendar tasks, only ask for missing required fields: topic/title and date. Do not ask for time or location unless the user explicitly wants to include them.
- For announcements, do NOT ask for date/time/location/event details unless the user explicitly asks to include them.
- Do NOT create calendar just because the user mentioned an event. Calendar only when they explicitly ask to create/add/schedule/put on calendar.
- If user asks a question about existing app data, prefer lookups or reply, not task boxes.
- If the user wants app data used to create something, return lookups plus tasks in the same plan.
- Supported deterministic lookups right now:
  - announcement_viewers: who viewed the user's last/latest/recent announcement
  - form_non_viewers: members who did not view the last/latest/recent form
- Multiple requested channels -> multiple tasks.
Examples:
- "remind everyone to come to our event" -> announcement only
- "announce and email everyone about dues" -> announcement + email
- "put our halloween social on the calendar for tomorrow at 5pm at Dulles High School" -> calendar
- "did any members view my last announcement" -> lookup only
- "check who didnt view my recent form and send an announcement to only them reminding them to fill it out" -> lookup + announcement task with recipientLookupId
Drafts:
- announcement: body only
- email: Subject line, blank line, body
- messages: message only
- calendar: Title, Date, Time, Location, blank line, Details
- form: Title, Description, numbered questions
- transaction: Description, Amount, Date, Status
- gallery: short description
- For announcement tasks with enough detail, include a short separate title like "Dues Reminder".
If details are missing, omit draft instead of guessing.
If there are no tasks and no deterministic lookup is needed, use reply.
Summary: 1-2 short natural sentences.`;
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
