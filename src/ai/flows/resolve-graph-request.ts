/**
 * @fileOverview Resolve a custom graph request into a dataset + chart config.
 */

import { callAI } from '@/ai/genkit';
import { type Result } from '@/lib/result';
import { z } from 'zod';

const ResolveGraphRequestInputSchema = z.object({
  prompt: z.string().describe('The user-provided graph request.'),
  context: z
    .string()
    .optional()
    .describe('JSON description of available datasets and fields.'),
});
export type ResolveGraphRequestInput = z.infer<typeof ResolveGraphRequestInputSchema>;

const ResolveGraphRequestOutputSchema = z.object({
  status: z
    .enum(['ok', 'needs_info', 'invalid'])
    .optional()
    .describe('Whether the request is actionable, needs more info, or is invalid.'),
  title: z.string().optional().describe('Short chart title.'),
  datasetId: z.string().optional().describe('Dataset id to use.'),
  chartType: z
    .enum(['line', 'bar', 'pie'])
    .optional()
    .describe('Chart type to use.'),
  xKey: z.string().optional().describe('X axis key for line/bar charts.'),
  yKey: z.string().optional().describe('Y axis key for line/bar charts.'),
  seriesKeys: z
    .array(z.string())
    .optional()
    .describe('Optional multiple series keys for line/bar charts.'),
  nameKey: z.string().optional().describe('Label key for pie charts.'),
  valueKey: z.string().optional().describe('Value key for pie charts.'),
  missingInfo: z
    .string()
    .optional()
    .describe('If more info is needed, describe what is missing.'),
});
export type ResolveGraphRequestOutput = z.infer<typeof ResolveGraphRequestOutputSchema>;

export async function resolveGraphRequest(
  input: ResolveGraphRequestInput
): Promise<Result<ResolveGraphRequestOutput>> {
  const result = await callAI<ResolveGraphRequestOutput>({
    responseFormat: 'json_object',
    outputSchema: ResolveGraphRequestOutputSchema,
    messages: [
      {
        role: 'system',
        content: `Pick the best chart configuration for the user's request using the provided dataset catalog.
Choose datasetId from the catalog. If the user doesn't specify a chart type, choose the best fit.
Use chartType: line, bar, or pie. For line/bar choose xKey/yKey or seriesKeys for multiple series. For pie choose nameKey/valueKey.
Be decisive: if a request roughly matches a dataset description, pick it instead of asking for more detail.
If the user mentions "most recent", "latest", or "last event", prefer a dataset whose description includes "most recent".
Only return status "needs_info" when no dataset can reasonably satisfy the request or the user asks for a specific field that isn't available. Include missingInfo with what to clarify.
Never return "needs_info" if any dataset reasonably matches the request; choose the closest dataset instead.
Only return status "invalid" for clearly nonsensical/gibberish input. Otherwise choose the closest dataset.
Examples: "number of attendees per event" -> attendancePerEvent (bar). "rsvp vs attendance for most recent event" -> rsvpVsAttendanceRecent (bar).
Return only JSON matching: { "status"?: "ok" | "needs_info" | "invalid", "title"?: string, "datasetId"?: string, "chartType"?: "line" | "bar" | "pie", "xKey"?: string, "yKey"?: string, "seriesKeys"?: string[], "nameKey"?: string, "valueKey"?: string, "missingInfo"?: string }`,
      },
      {
        role: 'user',
        content: input.context
          ? `Datasets:\n${input.context}\n\nGraph request:\n${input.prompt}`
          : input.prompt,
      },
    ],
  });
  return result;
}
