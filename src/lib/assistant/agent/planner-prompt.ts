import type { AiChatHistoryMessage } from '@/lib/ai-chat';

type PlannerTargetCandidate = {
  id: string;
  title: string;
  date?: string;
};

type PlannerDraftContext = {
  pendingActionId: string;
  actionType: string;
  currentPayload: unknown;
  targetRef?: string;
};

export const ASSISTANT_ACTION_CAPABILITY_GUIDANCE = [
  'Supported action types are limited to these in-app operations only:',
  '- create_announcement: draft or plan posting an in-app announcement with a title and body. Announcements are always group-wide and go to everyone.',
  '- update_announcement: draft or plan edits to an existing in-app announcement. Announcement targeting is not editable.',
  '- create_event: draft or plan creating an in-app event with title, description, date, time, and location.',
  '- update_event: draft or plan edits to an existing in-app event.',
  '- create_message: draft or plan sending an in-app direct or group message to members.',
  'If recent_history includes assistant_state: draft_preview or assistant_state: awaiting_confirmation for an announcement draft and the current message is a short editorial follow-up about that draft, classify it as update_announcement.',
  'If recent_history includes assistant_state: draft_preview or assistant_state: awaiting_confirmation for an event draft and the current message is a short editorial follow-up about that draft, classify it as update_event.',
  'When the user is revising the active draft from recent_history or active_draft_context, do not require action.fieldsProvided.targetRef. The active draft context is the edit target.',
  'If current_message clearly refers to one existing announcement or event in the available target lists, classify as the matching update action and set action.fieldsProvided.targetRef to that candidate id.',
  'If current_message is ambiguous between multiple existing targets, keep the update action but leave action.fieldsProvided.targetRef empty so the assistant can ask for clarification.',
  'If active_draft_context exists and current_message sounds like a revision to that draft, prefer the active draft over existing targets unless the user clearly names a different existing announcement or event.',
  'Unsupported or miscellaneous capability requests must stay conversational with no action.',
  'Examples of unsupported requests: making a flyer, poster, graphic, image, logo, slide deck, brochure, PDF, invitation design, video, banner, website, export, file, or other visual/document asset.',
  'Do not force unsupported requests into create_announcement, create_event, or create_message just because the topic mentions an event or needs copy.',
  'If the user asks for an unsupported asset or deliverable, set intent to conversational, omit action, and let the responder explain the limitation and offer the closest supported alternative.',
].join(' ');

export const buildAssistantPlannerPrompt = ({
  message,
  history,
  role,
  activeDraft,
  announcementTargets,
  eventTargets,
}: {
  message: string;
  history?: AiChatHistoryMessage[];
  role: string;
  activeDraft?: PlannerDraftContext | null;
  announcementTargets?: PlannerTargetCandidate[];
  eventTargets?: PlannerTargetCandidate[];
}) =>
  [
    'Return JSON only. You are the planning pass for a production in-app assistant.',
    'Never assume hidden state, permissions, or missing required fields.',
    'Supported intents: conversational, retrieval, draft_action, execute_action, mixed.',
    'Supported retrieval resources: announcements, events, members, messages, activity.',
    'Supported action types: create_announcement, update_announcement, create_event, update_event, create_message.',
    ASSISTANT_ACTION_CAPABILITY_GUIDANCE,
    'Use draft_action for low-commitment asks like draft, write, or example when the request fits a supported action type.',
    'Use execute_action for high-commitment asks like create, post, or send when the request fits a supported action type, but still only as a plan.',
    'Populate action.fieldsProvided only with explicit structural values needed before validation, such as recipients or target ids.',
    'Do not populate title, body, description, location, date, or time. Those fields are generated later from the user message and recent history.',
    `current_user_role: ${role}`,
    `recent_history: ${JSON.stringify(history ?? [])}`,
    `active_draft_context: ${JSON.stringify(activeDraft ?? null)}`,
    `available_announcement_targets: ${JSON.stringify(announcementTargets ?? [])}`,
    `available_event_targets: ${JSON.stringify(eventTargets ?? [])}`,
    `current_message: ${message}`,
  ].join('\n\n');
