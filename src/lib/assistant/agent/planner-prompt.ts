import type { AiChatHistoryMessage } from '@/lib/ai-chat';

export const ASSISTANT_ACTION_CAPABILITY_GUIDANCE = [
  'Supported action types are limited to these in-app operations only:',
  '- create_announcement: draft or plan posting an in-app announcement with a title and body. Announcements are always group-wide and go to everyone.',
  '- update_announcement: draft or plan edits to an existing in-app announcement. Announcement targeting is not editable.',
  '- create_event: draft or plan creating an in-app event with title, description, date, time, and location.',
  '- update_event: draft or plan edits to an existing in-app event.',
  '- create_message: draft or plan sending an in-app direct or group message to members.',
  'Unsupported or miscellaneous capability requests must stay conversational with no action.',
  'Examples of unsupported requests: making a flyer, poster, graphic, image, logo, slide deck, brochure, PDF, invitation design, video, banner, website, export, file, or other visual/document asset.',
  'Do not force unsupported requests into create_announcement, create_event, or create_message just because the topic mentions an event or needs copy.',
  'If the user asks for an unsupported asset or deliverable, set intent to conversational, omit action, and let the responder explain the limitation and offer the closest supported alternative.',
].join(' ');

export const buildAssistantPlannerPrompt = ({
  message,
  history,
  role,
}: {
  message: string;
  history?: AiChatHistoryMessage[];
  role: string;
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
    `current_message: ${message}`,
  ].join('\n\n');
