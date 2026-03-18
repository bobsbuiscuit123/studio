'use server';

import { callAI } from '@/ai/genkit';
import { err, ok, type Result } from '@/lib/result';
import { z } from 'zod';

const ASSISTANT_SYSTEM_PROMPT = `You are an AI assistant inside a school/group management app.

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
  "needsFollowup": boolean,
  "followupQuestion": string | null
}

Rules:

* Use tools for ALL real data or actions
* NEVER hallucinate data
* Chain actions when needed
* Keep responses concise
* If missing required fields, ask follow-up instead of guessing`;

const AssistantHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

const AssistantInputSchema = z.object({
  query: z.string().min(1),
  history: z.array(AssistantHistoryMessageSchema).optional(),
  orgId: z.string().uuid(),
  groupId: z.string().nullable(),
  userId: z.string().uuid(),
});

const ParsedAssistantActionSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.unknown()),
});

const ParsedAssistantResponseSchema = z.object({
  reply: z.string().optional(),
  needsFollowup: z.boolean().optional(),
  followupQuestion: z.string().nullable().optional(),
  actions: z.array(ParsedAssistantActionSchema).optional(),
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

const formatHistory = (
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined
) =>
  (history ?? [])
    .slice(-3)
    .map(item => `${item.role}: ${item.content}`)
    .join('\n');

export async function runAssistant(input: AssistantInput): Promise<Result<AssistantOutput>> {
  const validatedInput = AssistantInputSchema.safeParse(input);
  if (!validatedInput.success) {
    return err({
      code: 'VALIDATION',
      message: 'Invalid assistant request.',
      detail: validatedInput.error.message,
      source: 'app',
    });
  }

  const { query, orgId, groupId, userId, history } = validatedInput.data;
  console.log('ASSISTANT START', { query, orgId, groupId, userId });

  const historyBlock = formatHistory(history);
  const variables: Record<string, unknown> = {};

  let rawText = '';
  try {
    try {
      const geminiResult = await callAI({
        responseFormat: 'json_object',
        messages: [
          { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
          {
            role: 'developer',
            content: historyBlock
              ? `Recent conversation:\n${historyBlock}\n\nReturn JSON only.`
              : 'Return JSON only.',
          },
          { role: 'user', content: query },
        ],
      });

      if (!geminiResult.ok) {
        throw new Error(`Gemini call failed: ${geminiResult.error.message}`);
      }

      rawText = geminiResult.data;
      console.log('RAW GEMINI RESPONSE:', rawText);
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : 'Gemini call failed'
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
      console.log('PARSED GEMINI JSON:', parsedJson);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Gemini JSON parse failed: ${error.message}`
          : 'Gemini JSON parse failed'
      );
    }

    let parsed: z.infer<typeof ParsedAssistantResponseSchema>;
    try {
      parsed = ParsedAssistantResponseSchema.parse(parsedJson);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Gemini JSON parse failed: ${error.message}`
          : 'Gemini JSON parse failed'
      );
    }

    const actions = parsed.actions ?? [];
    console.log('ACTIONS BEFORE EXECUTION:', actions);

    try {
      for (const action of actions) {
        console.log('EXECUTING ACTION:', action);
        const result = { skipped: true, reason: 'Tool execution disabled for parse-only test mode.' };
        console.log('ACTION RESULT:', result);
        console.log('VARIABLE STATE:', variables);
      }
    } catch (error) {
      const toolName =
        actions.find(Boolean)?.tool && typeof actions.find(Boolean)?.tool === 'string'
          ? String(actions.find(Boolean)?.tool)
          : 'unknown';
      throw new Error(
        error instanceof Error
          ? `Tool execution failed: ${toolName} - ${error.message}`
          : `Tool execution failed: ${toolName}`
      );
    }

    return ok({
      reply: parsed.reply || 'Parsed successfully',
      needsFollowup: parsed.needsFollowup ?? false,
      followupQuestion: parsed.followupQuestion ?? null,
      actions: actions.map(action => ({
        ...action,
        status: 'completed',
      })),
    });
  } catch (error) {
    return err({
      code: 'AI_PROVIDER_ERROR',
      message: error instanceof Error ? error.message : 'Gemini call failed',
      source: 'ai',
      retryable: true,
    });
  }
}
