'use server';

/**
 * @fileOverview A general-purpose AI assistant response.
 *
 * NOTE: The interactive assistant UI uses the planner + task flows directly.
 * This flow remains as a lightweight, model-agnostic chat response that does not
 * execute tools.
 */

import { callAI } from '@/ai/genkit';
import { sanitizeAiText } from '@/lib/ai-safety';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const AssistantInputSchema = z.object({
  query: z.string().describe("The user's request."),
});
export type AssistantInput = z.infer<typeof AssistantInputSchema>;

const AssistantOutputSchema = z.object({
  response: z
    .string()
    .describe("A summary of the action taken or a direct answer to the user's query."),
  toolOutput: z.any().optional().describe('The direct JSON output from any tool that was called.'),
  toolName: z.string().optional().describe('The name of the tool that was called.'),
});
export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

export async function runAssistant(
  input: AssistantInput
): Promise<Result<AssistantOutput>> {
  const content = await callAI({
    messages: [
      {
        role: 'system',
        content:
          'You are CASPO, a concise group management copilot. Use provided app context to answer questions about group data. The context includes the full app data snapshot (some large fields may be truncated). If the answer is not in the context, say so plainly and suggest where to find it. Provide helpful, actionable replies but do not invent data or claim you executed actions. If a request is outside what this app can do, say so clearly and respond in a helpful, human way, offering what you can do instead. Only suggest a next step if it clearly follows from the user\'s request and would be helpful; otherwise, do not include suggestions. When you do suggest, use a short question starting with "Would you like me to ...?" and ensure it maps to a supported task type. If the context includes currentUser (name/email), treat first-person references like "I", "me", or "my" as that currentUser and do not ask the user to identify themselves. Format answers for readability: use short paragraphs and numbered lists with plain text (e.g., "1. ..."), do not use bullet symbols, markdown, emphasis markers, backticks, or quotation formatting, avoid raw JSON, and keep only the fields needed to answer the question. Format dates as M/D/YYYY (e.g., 12/25/2025) with no time zone suffixes. Prefer person names over emails when both are available (e.g., viewedByNames, respondentName). When listing responses, use this format: "1. Name or Email: <value> | Responses: Q1 - A1; Q2 - A2". If names are not available, use email. If the user asks for form responses, summarize the answers (map question prompts to response values) and avoid showing internal IDs unless explicitly requested. If a response includes answersDetailed, use the values there. If an answersDetailed entry has attachmentDataUri, include "Attachment provided" and the data URI so the file can be opened.',
      },
      {
        role: 'user',
        content: input.query,
      },
    ],
    temperature: 0.5,
  });
  if (!content.ok) return content;
  const parsed = AssistantOutputSchema.safeParse({
    response: sanitizeAiText(String(content.data)),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'AI_SCHEMA_INVALID',
        message: 'AI response validation failed.',
        detail: parsed.error.message,
        retryable: true,
        source: 'ai',
      },
    };
  }
  return { ok: true, data: parsed.data };
}




