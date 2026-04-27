import { callAI } from '@/ai/genkit';
import type { AiChatHistoryMessage } from '@/lib/ai-chat';
import {
  getGeminiFieldValidationResultSchema,
} from '@/lib/assistant/agent/schemas';
import {
  buildFieldValidatorPrompt,
  FIELD_VALIDATOR_FIELDS_BY_ACTION,
  FIELD_VALIDATOR_SYSTEM_PROMPT,
} from '@/lib/assistant/agent/field-validator-prompt';
import type {
  AgentActionType,
  GeminiFieldValidationResult,
} from '@/lib/assistant/agent/types';

type GeneratedFieldValidationResult =
  | { ok: true; missingFields: []; invalidFields: [] }
  | { ok: false; missingFields: string[]; invalidFields: string[] };

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const COPY_SCAFFOLDING_PATTERN =
  /(?:\bregarding the following\b|\b(?:the\s+)?following\s*:|\bcreate\s+(?:an?\s+)?(?:event|announcement|message|email)\b|\bmake\s+and\s+send\b|\bdraft\s+(?:an?\s+)?(?:event|announcement|message|email)\b)/i;

const isUsableGeneratedField = (field: string, value: unknown) => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (field === 'date') {
    return ISO_DATE_PATTERN.test(trimmed);
  }

  if (field === 'time') {
    return TIME_24H_PATTERN.test(trimmed);
  }

  return !COPY_SCAFFOLDING_PATTERN.test(trimmed);
};

export const validateGeminiGeneratedFields = (
  actionType: AgentActionType,
  inferredFields: Record<string, unknown>
): GeneratedFieldValidationResult => {
  const requiredFields = FIELD_VALIDATOR_FIELDS_BY_ACTION[actionType] ?? [];
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  requiredFields.forEach(field => {
    if (!(field in inferredFields)) {
      missingFields.push(field);
      return;
    }

    if (!isUsableGeneratedField(field, inferredFields[field])) {
      invalidFields.push(field);
    }
  });

  if (missingFields.length === 0 && invalidFields.length === 0) {
    return { ok: true, missingFields: [], invalidFields: [] };
  }

  return { ok: false, missingFields, invalidFields };
};

export const formatGeneratedFieldValidationError = (validation: GeneratedFieldValidationResult) => {
  if (validation.ok) {
    return '';
  }

  const parts = [
    validation.missingFields.length ? `missing: ${validation.missingFields.join(', ')}` : null,
    validation.invalidFields.length ? `invalid: ${validation.invalidFields.join(', ')}` : null,
  ].filter(Boolean);

  return `Gemini field validator did not return final generated fields (${parts.join('; ')}).`;
};

export async function runGeminiFieldValidator(args: {
  actionType: AgentActionType;
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  resolvedActionFields: Record<string, unknown>;
  requestTimezone: string;
  requestReceivedAt: string;
}): Promise<GeminiFieldValidationResult> {
  const outputSchema = getGeminiFieldValidationResultSchema(args.actionType);
  const result = await callAI({
    messages: [
      { role: 'system', content: FIELD_VALIDATOR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildFieldValidatorPrompt(args),
      },
    ],
    responseFormat: 'json_object',
    outputSchema,
    temperature: 0.35,
    timeoutMs: 12_000,
  });

  if (!result.ok) {
    throw new Error(result.error.detail || result.error.message);
  }

  const parsed = outputSchema.parse(result.data);
  const generatedFieldValidation = validateGeminiGeneratedFields(
    args.actionType,
    parsed.inferredFields
  );

  if (!generatedFieldValidation.ok) {
    throw new Error(formatGeneratedFieldValidationError(generatedFieldValidation));
  }

  return parsed;
}
