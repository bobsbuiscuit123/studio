import { callAI } from '@/ai/genkit';
import type { AiChatHistoryMessage } from '@/lib/ai-chat';
import {
  geminiFieldValidationResultSchema,
} from '@/lib/assistant/agent/schemas';
import type {
  AgentActionType,
  GeminiFieldValidationResult,
} from '@/lib/assistant/agent/types';

const REQUIRED_FIELD_SPEC: Record<AgentActionType, string[]> = {
  create_announcement: ['title or body'],
  update_announcement: ['title or body'],
  create_event: ['date', 'time'],
  update_event: ['at least one of title, description, location, date, time'],
  create_message: ['body'],
};

const ALLOWED_INFERENCE_FIELDS: Record<AgentActionType, string[]> = {
  create_announcement: ['title', 'body'],
  update_announcement: ['title', 'body'],
  create_event: ['title', 'description', 'location', 'date', 'time'],
  update_event: ['title', 'description', 'location', 'date', 'time'],
  create_message: ['body'],
};

const FIELD_VALIDATOR_SYSTEM_PROMPT = [
  'Return JSON only.',
  'You are the authoritative field-generation validator for an already-selected in-app action.',
  'Determine which Gemini-owned fields are explicit, reasonably inferable, or still missing.',
  'For fields you can determine, generate the final field values that should be stored before draft assembly.',
  'Generate polished user-facing content for copy fields such as title, body, description, and location when they are explicit or reasonably inferable.',
  'If a required Gemini-owned field cannot be reasonably inferred, omit it from inferredFields, include it in missingFields, and provide a concise clarificationMessage for the user.',
  'You must not change intent or action type.',
  'You must not decide permissions.',
  'You must not decide whether the action is safe to execute.',
  'You must not create preview payloads, DB payloads, or execution payloads.',
  'You must never infer recipients.',
  'You must never infer targetRef.',
  'You must not return permissions or execution metadata.',
  'Use resolved_action_fields only as fixed structural context, not as a source of missing copy generation.',
  'Use recent history only to interpret the current request as a continuation, not as hidden state.',
  'Never copy an imperative request verbatim into a user-facing field unless the user clearly already wrote final-form content.',
  'Confidence is telemetry only and will not control gating.',
].join(' ');

const buildFieldValidatorPrompt = (args: {
  actionType: AgentActionType;
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  resolvedActionFields: Record<string, unknown>;
  requestTimezone: string;
  requestReceivedAt: string;
}) =>
  [
    `action_type: ${args.actionType}`,
    `required_fields: ${JSON.stringify(REQUIRED_FIELD_SPEC[args.actionType] ?? [])}`,
    `allowed_inference_fields: ${JSON.stringify(ALLOWED_INFERENCE_FIELDS[args.actionType] ?? [])}`,
    `resolved_action_fields: ${JSON.stringify(args.resolvedActionFields)}`,
    `request_timezone: ${args.requestTimezone}`,
    `request_received_at: ${args.requestReceivedAt}`,
    `recent_history: ${JSON.stringify(args.recentHistory ?? [])}`,
    `user_message: ${args.userMessage}`,
    'Return only valid JSON matching: {"inferredFields": Record<string, unknown>, "missingFields": string[], "clarificationMessage"?: string, "usedInference": boolean, "telemetry"?: {"confidence"?: number, "notes"?: string[]}}',
  ].join('\n\n');

export async function runGeminiFieldValidator(args: {
  actionType: AgentActionType;
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  resolvedActionFields: Record<string, unknown>;
  requestTimezone: string;
  requestReceivedAt: string;
}): Promise<GeminiFieldValidationResult> {
  const result = await callAI({
    messages: [
      { role: 'system', content: FIELD_VALIDATOR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildFieldValidatorPrompt(args),
      },
    ],
    responseFormat: 'json_object',
    outputSchema: geminiFieldValidationResultSchema,
    temperature: 0.1,
    timeoutMs: 12_000,
  });

  if (!result.ok) {
    throw new Error(result.error.detail || result.error.message);
  }

  return geminiFieldValidationResultSchema.parse(result.data);
}
