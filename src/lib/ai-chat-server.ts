import 'server-only';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  AI_CHAT_ENTITIES,
  AI_CHAT_HISTORY_LIMIT,
  type AiChatEntity,
  type AiChatHistoryMessage,
  type AiChatPlannerResult,
} from '@/lib/ai-chat';

type GroupStateSelectionRow = Partial<Record<'announcements' | 'members' | 'events' | 'messages' | 'groupChats', unknown>> | null;

export type AiChatDataContext = {
  announcements?: unknown[];
  members?: unknown[];
  events?: unknown[];
  messages?: Record<string, unknown[]>;
  groupChats?: unknown[];
};

const ENTITY_SELECTS: Record<AiChatEntity, string[]> = {
  announcements: ['announcements:data->announcements'],
  messages: ['messages:data->messages', 'groupChats:data->groupChats'],
  members: ['members:data->members'],
  events: ['events:data->events'],
};

const AI_CHAT_HISTORY_PROMPT_CHARS = 480;
const AI_CHAT_CURRENT_MESSAGE_PROMPT_CHARS = 1_600;
const AI_CHAT_ANNOUNCEMENT_CONTENT_CHARS = 320;
const AI_CHAT_EVENT_DESCRIPTION_CHARS = 280;
const AI_CHAT_MESSAGE_TEXT_CHARS = 240;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const trimText = (value: unknown, maxChars: number) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
};

const normalizeHistory = (history?: AiChatHistoryMessage[]) =>
  Array.isArray(history)
    ? history
        .slice(-AI_CHAT_HISTORY_LIMIT)
        .map(message => ({
          role: message.role,
          content: trimText(message.content, AI_CHAT_HISTORY_PROMPT_CHARS),
        }))
    : [];

const projectAnnouncements = (announcements: unknown[]) =>
  announcements.slice(-6).map(item => {
    const announcement = isRecord(item) ? item : {};
    return {
      id: typeof announcement.id === 'string' || typeof announcement.id === 'number' ? String(announcement.id) : '',
      title: trimText(announcement.title, 120),
      content: trimText(announcement.content, AI_CHAT_ANNOUNCEMENT_CONTENT_CHARS),
      author: trimText(announcement.author, 80),
      date: typeof announcement.date === 'string' ? announcement.date : '',
      viewedBy: Array.isArray(announcement.viewedBy) ? announcement.viewedBy.slice(0, 20) : [],
    };
  });

const projectMembers = (members: unknown[]) =>
  members.slice(0, 28).map(item => {
    const member = isRecord(item) ? item : {};
    return {
      name: trimText(member.name, 80),
      email: trimText(member.email, 120),
      role: trimText(member.role, 40),
    };
  });

const projectEvents = (events: unknown[]) =>
  events.slice(-6).map(item => {
    const event = isRecord(item) ? item : {};
    const rsvps = isRecord(event.rsvps) ? event.rsvps : {};
    return {
      id: trimText(event.id, 80),
      title: trimText(event.title, 120),
      date:
        typeof event.date === 'string'
          ? event.date
          : event.date instanceof Date
            ? event.date.toISOString()
            : '',
      location: trimText(event.location, 120),
      description: trimText(event.description, AI_CHAT_EVENT_DESCRIPTION_CHARS),
      attendees: Array.isArray(event.attendees) ? event.attendees.slice(0, 20) : [],
      rsvps: {
        yes: Array.isArray(rsvps.yes) ? rsvps.yes.slice(0, 20) : [],
        no: Array.isArray(rsvps.no) ? rsvps.no.slice(0, 20) : [],
        maybe: Array.isArray(rsvps.maybe) ? rsvps.maybe.slice(0, 20) : [],
      },
    };
  });

const projectMessageList = (messages: unknown[]) =>
  messages.slice(-10).map(item => {
    const message = isRecord(item) ? item : {};
    return {
      sender: trimText(message.sender, 120),
      text: trimText(message.text, AI_CHAT_MESSAGE_TEXT_CHARS),
      timestamp: typeof message.timestamp === 'string' ? message.timestamp : '',
    };
  });

const projectDirectMessages = (messagesByConversation: Record<string, unknown[]>) =>
  Object.entries(messagesByConversation)
    .slice(-4)
    .map(([conversationKey, messages]) => ({
      conversationKey,
      messages: projectMessageList(Array.isArray(messages) ? messages : []),
    }));

const projectGroupChats = (groupChats: unknown[]) =>
  groupChats.slice(-4).map(item => {
    const chat = isRecord(item) ? item : {};
    return {
      id: trimText(chat.id, 80),
      name: trimText(chat.name, 120),
      members: Array.isArray(chat.members) ? chat.members.slice(0, 12) : [],
      messages: projectMessageList(Array.isArray(chat.messages) ? chat.messages : []),
    };
  });

const projectContextForPrompt = (context: AiChatDataContext) => {
  const projected: Record<string, unknown> = {};

  if (context.announcements) {
    projected.announcements = projectAnnouncements(context.announcements);
  }
  if (context.members) {
    projected.members = projectMembers(context.members);
  }
  if (context.events) {
    projected.events = projectEvents(context.events);
  }
  if (context.messages) {
    projected.directMessages = projectDirectMessages(context.messages);
  }
  if (context.groupChats) {
    projected.groupChats = projectGroupChats(context.groupChats);
  }

  return projected;
};

export const AI_CHAT_PLANNER_SYSTEM_PROMPT = `
You are the planner for CASPO's in-app assistant.
Decide whether the assistant needs group data to answer the user's request.

Return only valid JSON that matches this exact schema:
{
  "needs_data": boolean,
  "intent": "GENERATION" | "MEMBERSHIP" | "GROUP_DATA",
  "entities": ["announcements" | "messages" | "members" | "events"]
}

Rules:
- Do not include markdown.
- Do not include explanations.
- Do not infer access outside the provided org_id and group_id.
- Retrieval is required only when the answer depends on real facts from this specific group's announcements, messages, members, or events.
- Set "needs_data" to false for drafting, rewriting, brainstorming, summarizing user-provided text, editing tone, translation, generic advice, and other requests that can be answered helpfully without looking up group records.
- If group data would only make the answer more tailored but is not required to produce a useful response, set "needs_data" to false.
- Only include entities that are truly needed.

Examples:
- "Are there any announcements in this group?" -> {"needs_data": true, "intent": "GROUP_DATA", "entities": ["announcements"]}
- "Who is the admin of this group?" -> {"needs_data": true, "intent": "MEMBERSHIP", "entities": ["members"]}
- "Can you draft an announcement reminding everyone to pay dues?" -> {"needs_data": false, "intent": "GENERATION", "entities": []}
- "Rewrite this announcement to sound friendlier: ..." -> {"needs_data": false, "intent": "GENERATION", "entities": []}
- "Summarize our latest event turnout." -> {"needs_data": true, "intent": "GROUP_DATA", "entities": ["events", "members"]}
`.trim();

export const AI_CHAT_RESPONDER_SYSTEM_PROMPT = `
You are CASPO's in-app assistant.
Answer clearly and directly.
Follow the planner result.
When planner_result.needs_data is true, use only the fetched_group_data plus recent_history and do not hallucinate missing group facts.
When planner_result.needs_data is false, answer from the user's request and recent_history without pretending you need group retrieval.
For generation requests, be helpful: draft, rewrite, brainstorm, or format the response directly.
If a generation request is underspecified, make reasonable assumptions, use neutral placeholders when needed, and keep the draft easy to customize.
Only say that you do not have enough data when planner_result.needs_data is true and the requested fact is missing from fetched_group_data.
`.trim();

export const normalizeAiChatEntities = (entities: AiChatEntity[]) =>
  AI_CHAT_ENTITIES.filter(entity => entities.includes(entity));

export const buildAiChatGroupStateSelect = (entities: AiChatEntity[]) =>
  normalizeAiChatEntities(entities)
    .flatMap(entity => ENTITY_SELECTS[entity])
    .join(',');

export const normalizeAiChatContext = (
  row: GroupStateSelectionRow,
  entities: AiChatEntity[]
): AiChatDataContext => {
  const normalizedEntities = normalizeAiChatEntities(entities);
  const context: AiChatDataContext = {};

  if (normalizedEntities.includes('announcements')) {
    context.announcements = Array.isArray(row?.announcements) ? row.announcements : [];
  }
  if (normalizedEntities.includes('members')) {
    context.members = Array.isArray(row?.members) ? row.members : [];
  }
  if (normalizedEntities.includes('events')) {
    context.events = Array.isArray(row?.events) ? row.events : [];
  }
  if (normalizedEntities.includes('messages')) {
    context.messages = isRecord(row?.messages)
      ? Object.fromEntries(
          Object.entries(row.messages).map(([conversationKey, messages]) => [
            conversationKey,
            Array.isArray(messages) ? messages : [],
          ])
        )
      : {};
    context.groupChats = Array.isArray(row?.groupChats) ? row.groupChats : [];
  }

  return context;
};

export const buildAiChatPlannerPrompt = ({
  message,
  history,
  userId,
  orgId,
  groupId,
}: {
  message: string;
  history?: AiChatHistoryMessage[];
  userId: string;
  orgId: string;
  groupId: string;
}) => {
  const recentHistory = normalizeHistory(history);

  return [
    `user_id: ${userId}`,
    `org_id: ${orgId}`,
    `group_id: ${groupId}`,
    `recent_history: ${recentHistory.length ? JSON.stringify(recentHistory) : '[]'}`,
    `current_user_message: ${trimText(message, AI_CHAT_CURRENT_MESSAGE_PROMPT_CHARS)}`,
    [
      'available_group_data:',
      '- announcements: recent announcement records with title, content, author, date, viewedBy',
      '- messages: direct message threads plus group chats with recent messages',
      '- members: group member roster with names, emails, and roles',
      '- events: group events with title, date, location, attendees, and RSVPs',
    ].join('\n'),
  ].join('\n\n');
};

export const buildAiChatResponderPrompt = ({
  message,
  history,
  planner,
  usedEntities,
  context,
}: {
  message: string;
  history?: AiChatHistoryMessage[];
  planner: AiChatPlannerResult;
  usedEntities: AiChatEntity[];
  context: AiChatDataContext;
}) => {
  const recentHistory = normalizeHistory(history);
  const projectedContext = projectContextForPrompt(context);
  const fetchedDataNote = usedEntities.length
    ? 'The backend provided a bounded subset of the requested group data. If the answer is not in that subset, say you do not have enough data.'
    : 'No group data was fetched because the planner determined this request can be answered without retrieval. Use the user message and recent history to respond helpfully. Do not refuse just because fetched_group_data is null.';

  return [
    `planner_result: ${JSON.stringify(planner)}`,
    `used_entities: ${JSON.stringify(usedEntities)}`,
    fetchedDataNote,
    `recent_history: ${recentHistory.length ? JSON.stringify(recentHistory) : '[]'}`,
    `fetched_group_data: ${usedEntities.length ? JSON.stringify(projectedContext) : 'null'}`,
    `current_user_message: ${trimText(message, AI_CHAT_CURRENT_MESSAGE_PROMPT_CHARS)}`,
  ].join('\n\n');
};

export const fetchAiChatDataContext = async ({
  admin,
  groupId,
  entities,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  groupId: string;
  entities: AiChatEntity[];
}) => {
  const usedEntities = normalizeAiChatEntities(entities);
  if (usedEntities.length === 0) {
    return {
      context: {} satisfies AiChatDataContext,
      usedEntities,
    };
  }

  const select = buildAiChatGroupStateSelect(usedEntities);
  const { data, error } = await admin
    .from('group_state')
    .select(select)
    .eq('group_id', groupId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    context: normalizeAiChatContext(data as GroupStateSelectionRow, usedEntities),
    usedEntities,
  };
};
