/**
 * @fileOverview Resolve a custom AI insight request into a concrete insight.
 */

import { callAI } from '@/ai/genkit';
import { sanitizeInternalHref } from '@/lib/ai-safety';
import { ok, type Result } from '@/lib/result';
import { z } from 'zod';

const ResolveInsightRequestInputSchema = z.object({
  prompt: z.string().describe('The user-provided insight request.'),
  context: z
    .string()
    .optional()
    .describe('JSON app context including members, messages, forms, events, etc.'),
});
export type ResolveInsightRequestInput = z.infer<typeof ResolveInsightRequestInputSchema>;

const ResolveInsightRequestOutputSchema = z.object({
  status: z
    .enum(['ok', 'needs_info', 'invalid'])
    .optional()
    .describe('Whether the request is actionable, needs more info, or is invalid.'),
  text: z.string().optional().describe('Short insight text derived from app data.'),
  missingInfo: z
    .string()
    .optional()
    .describe('If more info is needed, describe what is missing.'),
  actionLabel: z.string().optional().describe('Optional CTA label.'),
  actionHref: z.string().optional().describe('Optional CTA href.'),
  contextText: z
    .string()
    .optional()
    .describe('Short context string for Assistant follow-up.'),
});
export type ResolveInsightRequestOutput = z.infer<typeof ResolveInsightRequestOutputSchema>;

const RESOLVE_INSIGHT_TIMEOUT_MS = 12_000;

export async function resolveInsightRequest(
  input: ResolveInsightRequestInput
): Promise<Result<ResolveInsightRequestOutput>> {
  const result = await callAI<ResolveInsightRequestOutput>({
    responseFormat: 'json_object',
    outputSchema: ResolveInsightRequestOutputSchema,
    timeoutMs: RESOLVE_INSIGHT_TIMEOUT_MS,
    messages: [
      {
        role: 'system',
        content: `You turn a user-written insight request into a concrete, data-backed insight using the provided app context JSON.
Return a short insight sentence with a number if possible (e.g., "5 unreplied messages", "2 forms missing responses").
If the request maps to a section, add actionLabel/actionHref from: messages -> "Review" + /messages, forms -> "Review" + /forms, calendar -> "Review" + /calendar, announcements -> "Review" + /announcements, finances -> "Review" + /finances, members -> "Review" + /members.
If the context does not contain enough data, return status "ok" with text "Not enough data yet." and omit actionLabel/actionHref.
If the request is vague/underspecified, return status "needs_info" with missingInfo describing what to clarify and omit text.
If the request does not make sense or doesn't map to any insight, return status "invalid" and omit text.
Also return contextText for the assistant, phrased as a request for next steps (e.g., "There are 5 unreplied messages. Help me reply to them.").
Return only JSON matching: { "status"?: "ok" | "needs_info" | "invalid", "text"?: string, "missingInfo"?: string, "actionLabel"?: string, "actionHref"?: string, "contextText"?: string }`,
      },
      {
        role: 'user',
        content: input.context
          ? `App context:\n${input.context}\n\nInsight request:\n${input.prompt}`
          : input.prompt,
      },
    ],
  });
  if (!result.ok) return result;
  const resolved: ResolveInsightRequestOutput = { ...result.data };
  const prompt = input.prompt.toLowerCase();
  const overrideHref = () => {
    if (
      prompt.includes('message') ||
      prompt.includes('messages') ||
      prompt.includes('dm') ||
      prompt.includes('chat') ||
      prompt.includes('reply')
    ) {
      return '/messages';
    }
    if (prompt.includes('form') || prompt.includes('response')) return '/forms';
    if (prompt.includes('event') || prompt.includes('calendar') || prompt.includes('rsvp')) {
      return '/calendar';
    }
    if (prompt.includes('announcement')) return '/announcements';
    if (prompt.includes('finance') || prompt.includes('expense') || prompt.includes('balance')) {
      return '/finances';
    }
    if (prompt.includes('member')) return '/members';
    return undefined;
  };
  const forcedHref = overrideHref();
  const sanitizedHref = sanitizeInternalHref(resolved.actionHref) ?? forcedHref;
  if (sanitizedHref) {
    resolved.actionHref = sanitizedHref;
    resolved.actionLabel = 'Review';
  } else {
    resolved.actionHref = undefined;
    resolved.actionLabel = undefined;
  }
  return ok(resolved);
}
