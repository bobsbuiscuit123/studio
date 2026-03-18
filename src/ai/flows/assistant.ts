'use server';

import { callAI } from '@/ai/genkit';
import {
  MAX_ASSISTANT_PROMPT_CHARS,
  clampAssistantPrompt,
} from '@/ai/flows/assistant-prompt-limit';
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

const TOOL_DEFINITIONS: Array<{ name: string; description: string; input: Record<string, string> }> = [];

const formatHistory = (
  history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined
) =>
  (history ?? [])
    .slice(-3)
    .map(item => `${item.role}: ${item.content}`)
    .join('\n');

const buildDeveloperPrompt = (historyBlock: string, toolDefinitionsText: string) =>
  [
    historyBlock ? `Recent conversation:\n${historyBlock}` : '',
    toolDefinitionsText ? `Tool definitions:\n${toolDefinitionsText}` : 'Tool definitions:\nNone yet.',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n\n');

const buildFinalPrompt = ({
  systemPrompt,
  developerPrompt,
  query,
}: {
  systemPrompt: string;
  developerPrompt: string;
  query: string;
}) => [systemPrompt, developerPrompt, query].join('\n\n');

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

  let queryText = clampAssistantPrompt(query);
  let historyBlock = clampAssistantPrompt(formatHistory(history));
  const variables: Record<string, unknown> = {};
  let toolDefinitionsText = TOOL_DEFINITIONS.map(tool => {
    const inputKeys = Object.entries(tool.input)
      .map(([key, value]) => `${key}:${value}`)
      .join(', ');
    return `${tool.name} - ${tool.description}${inputKeys ? ` | input: ${inputKeys}` : ''}`;
  }).join('\n');
  let systemPrompt = ASSISTANT_SYSTEM_PROMPT;
  let developerPrompt = buildDeveloperPrompt(historyBlock, toolDefinitionsText);
  let finalPrompt = buildFinalPrompt({
    systemPrompt,
    developerPrompt,
    query: queryText,
  });

  if (finalPrompt.length > MAX_ASSISTANT_PROMPT_CHARS) {
    const overflow = finalPrompt.length - MAX_ASSISTANT_PROMPT_CHARS;
    historyBlock = historyBlock.slice(Math.min(overflow, historyBlock.length));
    developerPrompt = buildDeveloperPrompt(historyBlock, toolDefinitionsText);
    finalPrompt = buildFinalPrompt({
      systemPrompt,
      developerPrompt,
      query: queryText,
    });
  }

  if (finalPrompt.length > MAX_ASSISTANT_PROMPT_CHARS) {
    const overflow = finalPrompt.length - MAX_ASSISTANT_PROMPT_CHARS;
    toolDefinitionsText = toolDefinitionsText.slice(Math.min(overflow, toolDefinitionsText.length));
    developerPrompt = buildDeveloperPrompt(historyBlock, toolDefinitionsText);
    finalPrompt = buildFinalPrompt({
      systemPrompt,
      developerPrompt,
      query: queryText,
    });
  }

  if (finalPrompt.length > MAX_ASSISTANT_PROMPT_CHARS) {
    queryText = queryText.slice(0, Math.max(0, queryText.length - (finalPrompt.length - MAX_ASSISTANT_PROMPT_CHARS)));
    finalPrompt = buildFinalPrompt({
      systemPrompt,
      developerPrompt,
      query: queryText,
    });
  }

  if (finalPrompt.length > MAX_ASSISTANT_PROMPT_CHARS) {
    systemPrompt = systemPrompt.slice(0, Math.max(0, systemPrompt.length - (finalPrompt.length - MAX_ASSISTANT_PROMPT_CHARS)));
    finalPrompt = buildFinalPrompt({
      systemPrompt,
      developerPrompt,
      query: queryText,
    });
  }

  console.log('GEMINI SYSTEM PROMPT:', systemPrompt);
  console.log('GEMINI USER QUERY:', queryText);
  console.log('GEMINI HISTORY:', historyBlock);
  console.log('GEMINI TOOL DEFINITIONS:', toolDefinitionsText || 'None');
  console.log('FINAL PROMPT CHARS:', finalPrompt.length);

  let rawText = '';
  try {
    let geminiResult: Awaited<ReturnType<typeof callAI>> | null = null;
    try {
      geminiResult = await callAI({
        responseFormat: 'json_object',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'developer',
            content: developerPrompt,
          },
          { role: 'user', content: queryText },
        ],
      });

      if (!geminiResult.ok) {
        console.error('GEMINI CALL ERROR RESPONSE:', geminiResult);
        throw new Error(`Gemini call failed: ${geminiResult.error.message || 'Unknown Gemini error'}`);
      }

      rawText = geminiResult.data;
      console.log('RAW GEMINI RESPONSE:', rawText);
    } catch (error) {
      console.error('GEMINI CALL ERROR:', error);
      console.error(
        'GEMINI CALL ERROR MESSAGE:',
        error && typeof error === 'object' && 'message' in error
          ? (error as { message?: unknown }).message
          : undefined
      );
      console.error(
        'GEMINI CALL ERROR STACK:',
        error && typeof error === 'object' && 'stack' in error
          ? (error as { stack?: unknown }).stack
          : undefined
      );
      if (geminiResult) {
        console.error('GEMINI CALL PARTIAL RESPONSE:', geminiResult);
      }
      throw new Error(
        `Gemini call failed: ${
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message || 'Unknown Gemini error')
            : 'Unknown Gemini error'
        }`
      );
    }

    const parsedJson = JSON.parse(rawText);
    console.log('PARSED GEMINI JSON:', parsedJson);
    const parsed = ParsedAssistantResponseSchema.parse(parsedJson);

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
