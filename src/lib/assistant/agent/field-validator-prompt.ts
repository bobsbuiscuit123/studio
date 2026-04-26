import type { AiChatHistoryMessage } from '@/lib/ai-chat';
import type { AgentActionType } from '@/lib/assistant/agent/types';

const ALLOWED_INFERENCE_FIELDS: Record<AgentActionType, string[]> = {
  create_announcement: ['title', 'body'],
  update_announcement: ['title', 'body'],
  create_event: ['title', 'description', 'location', 'date', 'time'],
  update_event: ['title', 'description', 'location', 'date', 'time'],
  create_message: ['body'],
  update_message: ['body'],
  create_email: ['subject', 'body'],
  update_email: ['subject', 'body'],
};

const GENERIC_FIELD_GENERATION_CONTRACT = [
  'inferredFields must include a usable non-empty value for every field listed in fields_to_generate.',
  'Never omit a listed field, never return null for it, and never leave it blank.',
  'Every generated field must be ready for downstream storage and draft assembly without extra interpretation.',
  'If a field allows an editable placeholder, use a concrete placeholder such as "TBD" rather than leaving it missing.',
].join(' ');

const EVENT_FIELD_GENERATION_CONTRACT = [
  'Event field contract:',
  'inferredFields.title must be a concise event title.',
  'inferredFields.description must be a complete editable event description.',
  'inferredFields.location must be a non-empty usable location string; use "TBD" if no location was given.',
  'inferredFields.date must always be a concrete calendar date in exact YYYY-MM-DD format, for example 2026-04-30.',
  'inferredFields.time must always be a concrete local time in exact HH:MM 24-hour format, for example 18:00.',
  'Never return natural-language dates or times such as "April 30", "the 30th", "next Tuesday", "6pm", or an ISO timestamp with timezone.',
  'If the user gives a day without a time, choose a reasonable editable time and still output inferredFields.time.',
  'If the user gives a time without a day, choose a reasonable editable date relative to request_received_at and request_timezone and still output inferredFields.date.',
  'If the user gives both a day and a time, inferredFields.date and inferredFields.time must both still be present in final stored format.',
].join(' ');

const ACTION_FIELD_GENERATION_CONTRACT: Partial<Record<AgentActionType, string>> = {
  create_event: EVENT_FIELD_GENERATION_CONTRACT,
  update_event: EVENT_FIELD_GENERATION_CONTRACT,
};

export const FIELD_VALIDATOR_SYSTEM_PROMPT = [
  'Return JSON only.',
  'You are the authoritative field-generation pass for an already-selected in-app action.',
  'Your job is to generate polished editable values for every Gemini-owned field listed in fields_to_generate.',
  'You are fully responsible for Gemini-owned fields. Do not rely on any downstream fallback to invent or repair them.',
  GENERIC_FIELD_GENERATION_CONTRACT,
  'Do not decide whether fields are missing for Gemini-owned fields.',
  'Always leave missingFields as [] and omit clarificationMessage unless an upstream caller explicitly asks for them.',
  'Generate final field values that should be stored before draft assembly.',
  'Generate polished user-facing content for copy fields such as title, body, description, and location.',
  'For new announcements, short intents like "remind everyone to pay dues in an announcement" are enough to generate both a concise title and a complete announcement body.',
  'For direct messages, short intents like "send Alex a reminder about dues" are enough to generate a complete message body once recipients are resolved.',
  'For group emails, generate both a clear subject line and a ready-to-edit email body.',
  'For events, if date, time, or location are not explicitly provided, choose reasonable editable defaults relative to request_received_at and request_timezone.',
  'For events, return date in YYYY-MM-DD format and time in HH:MM 24-hour format, both interpreted in request_timezone.',
  'When the user gives a calendar day like "the 30th", resolve it relative to request_received_at and request_timezone. Do not substitute a different date.',
  'If the user gives a short imperative request, convert it into final-form field content instead of copying the command.',
  'If details are underspecified, choose a reasonable editable default that fits the request and action type.',
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
  'Never return empty strings or partial sentence fragments in inferredFields.',
  'Concrete editable defaults such as "TBD" are allowed when the user did not specify a detail.',
  'Confidence is telemetry only and will not control gating.',
].join(' ');

export const buildFieldValidatorPrompt = (args: {
  actionType: AgentActionType;
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  resolvedActionFields: Record<string, unknown>;
  requestTimezone: string;
  requestReceivedAt: string;
}) =>
  [
    `action_type: ${args.actionType}`,
    `fields_to_generate: ${JSON.stringify(ALLOWED_INFERENCE_FIELDS[args.actionType] ?? [])}`,
    `field_generation_contract: ${GENERIC_FIELD_GENERATION_CONTRACT}`,
    ...(ACTION_FIELD_GENERATION_CONTRACT[args.actionType]
      ? [`action_field_contract: ${ACTION_FIELD_GENERATION_CONTRACT[args.actionType]}`]
      : []),
    `resolved_action_fields: ${JSON.stringify(args.resolvedActionFields)}`,
    `request_timezone: ${args.requestTimezone}`,
    `request_received_at: ${args.requestReceivedAt}`,
    `recent_history: ${JSON.stringify(args.recentHistory ?? [])}`,
    `user_message: ${args.userMessage}`,
    'Return only valid JSON matching: {"inferredFields": Record<string, unknown>, "missingFields": string[], "clarificationMessage"?: string, "usedInference": boolean, "telemetry"?: {"confidence"?: number, "notes"?: string[]}}',
  ].join('\n\n');
