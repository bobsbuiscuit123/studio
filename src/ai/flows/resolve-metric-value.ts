/**
 * @fileOverview Resolve a custom metric request into a single numeric value.
 */

import { callAI } from '@/ai/genkit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const ResolveMetricValueInputSchema = z.object({
  prompt: z.string().describe('The user-provided metric request.'),
  context: z
    .string()
    .optional()
    .describe('JSON app context including members, messages, forms, events, etc.'),
});
export type ResolveMetricValueInput = z.infer<typeof ResolveMetricValueInputSchema>;

const ResolveMetricValueOutputSchema = z.object({
  status: z
    .enum(['ok', 'needs_info', 'invalid'])
    .optional()
    .describe('Whether the request is actionable, needs more info, or is invalid.'),
  label: z.string().optional().describe('Short label for the metric.'),
  value: z.number().optional().describe('Numeric value for the metric.'),
  unit: z.string().optional().describe('Optional unit suffix (e.g., %, $, people).'),
  missingInfo: z
    .string()
    .optional()
    .describe('If more info is needed, describe what is missing.'),
  contextText: z
    .string()
    .optional()
    .describe('Short context string for Assistant follow-up.'),
});
export type ResolveMetricValueOutput = z.infer<typeof ResolveMetricValueOutputSchema>;

export async function resolveMetricValue(
  input: ResolveMetricValueInput
): Promise<Result<ResolveMetricValueOutput>> {
  const result = await callAI<ResolveMetricValueOutput>({
    responseFormat: 'json_object',
    outputSchema: ResolveMetricValueOutputSchema,
    messages: [
      {
        role: 'system',
        content: `Turn a metric request into a single numeric value using the provided JSON context.
Return a short label and numeric value (e.g., label "Unreplied messages", value 5).
If the request is vague/underspecified, return status "needs_info" with missingInfo describing what to clarify and omit label/value.
If the request does not make sense or doesn't map to app data, return status "invalid" and omit label/value.
If the context does not contain enough data, return status "ok" with label and value 0 plus unit "N/A" if appropriate.
Also return contextText for assistant follow-up (e.g., "There are 5 unreplied messages. Help me reply to them.").
Return only JSON matching: { "status"?: "ok" | "needs_info" | "invalid", "label"?: string, "value"?: number, "unit"?: string, "missingInfo"?: string, "contextText"?: string }`,
      },
      {
        role: 'user',
        content: input.context
          ? `App context:\n${input.context}\n\nMetric request:\n${input.prompt}`
          : input.prompt,
      },
    ],
  });
  return result;
}
