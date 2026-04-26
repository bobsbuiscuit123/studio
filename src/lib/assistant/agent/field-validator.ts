import { callAI } from '@/ai/genkit';
import type { AiChatHistoryMessage } from '@/lib/ai-chat';
import {
  geminiFieldValidationResultSchema,
} from '@/lib/assistant/agent/schemas';
import {
  buildFieldValidatorPrompt,
  FIELD_VALIDATOR_SYSTEM_PROMPT,
} from '@/lib/assistant/agent/field-validator-prompt';
import type {
  AgentActionType,
  GeminiFieldValidationResult,
} from '@/lib/assistant/agent/types';

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
    temperature: 0.35,
    timeoutMs: 12_000,
  });

  if (!result.ok) {
    throw new Error(result.error.detail || result.error.message);
  }

  return geminiFieldValidationResultSchema.parse(result.data);
}
