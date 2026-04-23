import { callAI } from '@/ai/genkit';
import {
  announcementDraftPreviewSchema,
  eventDraftPreviewSchema,
  messageDraftPreviewSchema,
} from '@/lib/assistant/agent/schemas';
import type { DraftPreview, AgentActionType } from '@/lib/assistant/agent/types';
import type { RetrievalBundle } from '@/lib/assistant/agent/retrieval';

const baseDraftInstructions = [
  'Return JSON only.',
  'Generate a structured in-app draft preview.',
  'Treat provided_fields as the authoritative resolved action fields.',
  'Assemble the preview from provided_fields and retrieval context, not by reinterpreting the raw user request as missing field content.',
  'Do not invent recipients, target references, or scheduling details that are absent from provided_fields.',
  'Do not replace provided field content with copied imperative request text.',
  'Keep the draft concise, helpful, and ready for preview editing.',
].join(' ');

const buildDraftPrompt = ({
  actionType,
  message,
  fieldsProvided,
  retrieval,
  seedPreview,
}: {
  actionType: AgentActionType;
  message: string;
  fieldsProvided: Record<string, unknown>;
  retrieval: RetrievalBundle;
  seedPreview?: DraftPreview | null;
}) =>
  [
    baseDraftInstructions,
    `action_type: ${actionType}`,
    `user_message: ${message}`,
    `provided_fields: ${JSON.stringify(fieldsProvided)}`,
    `retrieval_context: ${JSON.stringify(retrieval.context)}`,
    `used_entities: ${JSON.stringify(retrieval.usedEntities)}`,
    `existing_preview: ${seedPreview ? JSON.stringify(seedPreview) : 'null'}`,
  ].join('\n\n');

export async function generateDraftPreview(args: {
  actionType: AgentActionType;
  message: string;
  fieldsProvided: Record<string, unknown>;
  retrieval: RetrievalBundle;
  seedPreview?: DraftPreview | null;
}): Promise<DraftPreview> {
  const prompt = buildDraftPrompt(args);

  const result =
    args.actionType === 'create_announcement' || args.actionType === 'update_announcement'
      ? await callAI({
          messages: [{ role: 'user', content: prompt }],
          responseFormat: 'json_object',
          outputSchema: announcementDraftPreviewSchema,
          temperature: 0.4,
          timeoutMs: 18_000,
        })
      : args.actionType === 'create_event' || args.actionType === 'update_event'
        ? await callAI({
            messages: [{ role: 'user', content: prompt }],
            responseFormat: 'json_object',
            outputSchema: eventDraftPreviewSchema,
            temperature: 0.3,
            timeoutMs: 18_000,
          })
        : await callAI({
            messages: [{ role: 'user', content: prompt }],
            responseFormat: 'json_object',
            outputSchema: messageDraftPreviewSchema,
            temperature: 0.35,
            timeoutMs: 18_000,
          });

  if (!result.ok) {
    throw new Error(result.error.detail || result.error.message);
  }

  return result.data;
}
