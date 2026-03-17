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
      'social',
      'other',
    ])
    .describe('What type of task to run.'),
  prompt: z.string().describe('The prompt/details to use when executing the task.'),
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
  const baseSystemMessage = `You plan task boxes for a school/group management app. Return JSON only: {"tasks":[...],"summary":"..."}.
Allowed task types: announcement, form, calendar, email, messages, gallery, transaction, social, other.
Split the user's request into 1-5 tasks when they asked for multiple things.
Each task must have: id, type, prompt. Add draft only when enough detail exists right now. Add followUpQuestions only for required missing details. Do not ask unnecessary questions.
Use the task types like this:
- announcement: school/group announcement or reminder to everyone/some audience
- email: email draft with subject and body
- messages: direct message or group chat message
- calendar: event with title/date/time
- form: form/survey with actual questions
- gallery: image upload/description
- transaction: finance entry
- social: social post
- other: unsupported request only
Rules:
- Preserve any exact wording the user gave inside the prompt.
- Reminder requests can be announcement, email, messages, or multiple if the user asked for multiple channels.
- If the user explicitly asks for multiple channels, return multiple tasks.
- If details are missing, keep the right task type and ask only for the missing required detail.
- Do not use type "other" for normal announcement/email/calendar/form requests just because they are incomplete.
Draft format:
- announcement: body only
- email: "Subject: ..." then blank line then body
- messages: message text only
- calendar: Title, Date, Time, Location, blank line, Details
- form: Title, Description, then numbered questions
- transaction: Description, Amount, Date, Status
- social: Title, Post
- gallery: short description
If details are missing, omit draft instead of guessing.
Summary should be 1-2 short natural sentences.`;
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
