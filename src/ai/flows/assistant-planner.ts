/**
 * @fileOverview Plans actionable tasks from a user request without executing them.
 * Used by the Assistant UI to collect confirmations before calling individual flows.
 */

import { callAI } from '@/ai/genkit';
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
  const context = input.context?.trim();
  const trimmedContext =
    context && context.length > 4000 ? context.slice(-4000) : context;
  const baseSystemMessage = `You are an orchestration planner for a group management assistant.
Break the user's request into tasks. Allowed task types: announcement, form, calendar, email, messages, gallery, transaction, social, other.
Be concise and specific in the prompt field so it can be executed directly. If the user supplied exact wording for an announcement/event/etc., preserve it verbatim in the prompt wrapped in double quotes (do not rewrite).
Only add followUpQuestions when required details are missing per the task rules below. Do NOT ask for extra or random info. Each missing detail should be its own question in the followUpQuestions array.
Task requirements:
- announcement: need a general prompt about the announcement (the topic/what it's about) and recipients (everyone or specific). Exact text is optional (do not ask for it if a topic is provided). Attachments are optional (do not ask).
- messages: need the person or group chat to send to, and either exact text or a prompt to generate the message.
- calendar: need title (or enough context to generate it), date, and time. Location is optional. Relative dates like "tomorrow" count as date (do not ask for a specific date if provided). If points not mentioned, default to 0. If RSVP not mentioned, default to "no RSVP required".
- form: need title (or enough context to generate it) and the questions (plus answer choices for multiple choice). Description can be generated from title. Default all questions to required, but allow edits later.
- gallery: need at least one image. Description is optional (leave blank if not provided); if some context is given, you can generate a short description.
- email: need either exact body text or enough context to generate it, plus a generated title/subject. Attachments are optional (do not ask).
If the user asks to create a form but does not provide the actual questions (and answer choices for multiple-choice questions), include a followUpQuestions entry requesting those, phrased like: "Please list the questions you want in the form and any answer choices for multiple-choice questions."
Treat reminder-style requests (e.g., "remind everyone to pay dues") as announcement tasks.
If the request is extremely incomplete, still return the correct task type (e.g., announcement) and use followUpQuestions to ask for the missing detail; do not use type "other" for announcements/forms/emails just because details are missing.
Provide 1-5 tasks maximum, each with at most five followUpQuestions.
If the user asks for something you cannot do with the allowed task types, return exactly ONE task with type "other" and put a brief apology + explanation in the prompt (also mention what you *can* do in this app).
Write 'summary' as a natural, varied assistant reply (1-2 short sentences). Avoid canned phrasing.
Return ONLY JSON matching: { "tasks": Task[], "summary": string } with Task { id, type, prompt, followUpQuestions? }.`;
  const systemContent = trimmedContext
    ? `${baseSystemMessage}\n\nRecent context (use this to resolve references like "that form" or "the announcement"):\n${trimmedContext}`
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
        content: input.query,
      },
    ],
  });
  return output;
}
