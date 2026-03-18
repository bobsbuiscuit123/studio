'use server';

import { callAI } from '@/ai/genkit';
import {
  assistantToolList,
  executeAssistantActions,
  loadAssistantContext,
} from '@/ai/assistant-tools';
import { clampAssistantPrompt } from '@/ai/flows/assistant-prompt-limit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { err, ok, type Result } from '@/lib/result';
import { z } from 'zod';

const GEMINI_SYSTEM_PROMPT = `You are an AI assistant inside a school/group management app.

You can perform actions using tools.

You must:

* Understand user intent
* Break into steps if needed
* Use tools to execute tasks
* Chain multiple actions when required
* Only ask follow-up questions if absolutely necessary

Return JSON ONLY:

{
"reply": string,
"actions": [
{
"tool": string,
"input": object
}
],
"needs_followup": boolean,
"followup_question": string | null
}

Rules:

* Use tools for ALL real data or actions
* NEVER hallucinate data
* Chain actions when needed
* Keep responses concise
* If missing required fields, ask follow-up instead of guessing
  `;

const AssistantHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

const AssistantInputSchema = z.object({
  query: z.string().min(1),
  history: z.array(AssistantHistoryMessageSchema).optional(),
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
});

const AssistantActionSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.unknown()),
});

const AssistantPlanSchema = z.object({
  reply: z.string(),
  actions: z.array(AssistantActionSchema),
  needs_followup: z.boolean(),
  followup_question: z.string().nullable(),
});

export type AssistantInput = z.infer<typeof AssistantInputSchema>;

export type AssistantOutput = {
  reply: string;
  needsFollowup: boolean;
  followupQuestion: string | null;
  actions: Array<{
    tool: string;
    input: Record<string, unknown>;
    status: 'completed' | 'failed';
    output?: unknown;
    error?: string;
  }>;
};

const toCompactHistory = (
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined
) =>
  (history ?? [])
    .slice(-3)
    .map(message => `${message.role}: ${message.content.replace(/\s+/g, ' ').trim()}`)
    .join('\n');

const buildToolBlock = () =>
  assistantToolList
    .map(tool => {
      const inputKeys = Object.keys(tool.input);
      return `${tool.name}(${inputKeys.join(',')}) - ${tool.description}`;
    })
    .join('\n');

export async function runAssistant(input: AssistantInput): Promise<Result<AssistantOutput>> {
  const parsed = AssistantInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      code: 'VALIDATION',
      message: 'Invalid assistant request.',
      detail: parsed.error.message,
      source: 'app',
    });
  }

  const contextResult = await loadAssistantContext({
    orgId: parsed.data.orgId,
    groupId: parsed.data.groupId,
    userId: parsed.data.userId,
  });
  if (!contextResult.ok) return contextResult;

  const context = contextResult.data;
  const query = clampAssistantPrompt(parsed.data.query).trim();
  const history = toCompactHistory(parsed.data.history);
  const memberNames = context.members
    .slice(0, 12)
    .map(member => `${member.name} <${member.email}>`)
    .join(', ');
  const developerPrompt = clampAssistantPrompt(
    [
      `Current user: ${context.userName} <${context.userEmail}>`,
      `Available tools:\n${buildToolBlock()}`,
      `Variables to chain between actions: $LAST_ANNOUNCEMENT, $VIEWERS, $NOT_VIEWED_USERS, $EVENT, $EVENT_ID, $ATTENDEES, $ABSENT_USERS.`,
      `Group members: ${memberNames}`,
      history ? `Recent chat:\n${history}` : '',
      'If the user asks about a specific day like saturday, use find_event first.',
      'If the user asks who missed an event, use find_event then get_event_attendance then any write tool.',
      'If the user asks to remind people who did not view the last announcement, use get_last_announcement_views then send_message with recipients set to $NOT_VIEWED_USERS.',
    ]
      .filter(Boolean)
      .join('\n\n')
  );

  const planResult = await callAI<z.infer<typeof AssistantPlanSchema>>({
    responseFormat: 'json_object',
    outputSchema: AssistantPlanSchema,
    messages: [
      { role: 'system', content: GEMINI_SYSTEM_PROMPT },
      { role: 'developer', content: developerPrompt },
      { role: 'user', content: query },
    ],
  });

  if (!planResult.ok) return planResult as Result<AssistantOutput>;

  const plan = planResult.data;
  if (plan.needs_followup) {
    return ok({
      reply: sanitizeAiText(plan.reply || plan.followup_question || 'I need one more detail.'),
      needsFollowup: true,
      followupQuestion: plan.followup_question,
      actions: [],
    });
  }

  if (plan.actions.length === 0) {
    return ok({
      reply: sanitizeAiText(plan.reply),
      needsFollowup: false,
      followupQuestion: null,
      actions: [],
    });
  }

  const executionResult = await executeAssistantActions(context, plan.actions);
  if (!executionResult.ok) {
    return executionResult as Result<AssistantOutput>;
  }

  return ok({
    reply: sanitizeAiText(executionResult.data.reply || plan.reply),
    needsFollowup: false,
    followupQuestion: null,
    actions: executionResult.data.results.map(item =>
      item.status === 'completed'
        ? {
            tool: item.tool,
            input: item.input as Record<string, unknown>,
            status: item.status,
            output: item.output,
          }
        : {
            tool: item.tool,
            input: item.input as Record<string, unknown>,
            status: item.status,
            error: item.error,
          }
    ),
  });
}
