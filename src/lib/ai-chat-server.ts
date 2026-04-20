import 'server-only';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { isGroupAdminRole, normalizeGroupRole } from '@/lib/group-permissions';
import {
  AI_CHAT_ENTITIES,
  AI_CHAT_HISTORY_LIMIT,
  type AiChatEntity,
  type AiChatHistoryMessage,
  type AiChatPlannerResult,
} from '@/lib/ai-chat';

type GroupStateSelectionRow = Partial<
  Record<
    | 'announcements'
    | 'members'
    | 'events'
    | 'messages'
    | 'groupChats'
    | 'forms'
    | 'socialPosts'
    | 'galleryImages'
    | 'pointEntries'
    | 'transactions',
    unknown
  >
> | null;

export type AiChatDataContext = {
  announcements?: unknown[];
  members?: unknown[];
  events?: unknown[];
  messages?: Record<string, unknown[]>;
  groupChats?: unknown[];
  forms?: unknown[];
  socialPosts?: unknown[];
  galleryImages?: unknown[];
  pointEntries?: unknown[];
  transactions?: unknown[];
};

const ENTITY_SELECTS: Record<AiChatEntity, string[]> = {
  announcements: ['announcements:data->announcements'],
  messages: ['messages:data->messages', 'groupChats:data->groupChats'],
  members: ['members:data->members'],
  events: ['events:data->events'],
  forms: ['forms:data->forms'],
  social_posts: ['socialPosts:data->socialPosts'],
  gallery: ['galleryImages:data->galleryImages'],
  points: ['pointEntries:data->pointEntries'],
  transactions: ['transactions:data->transactions'],
};

const AI_CHAT_HISTORY_PROMPT_CHARS = 480;
const AI_CHAT_CURRENT_MESSAGE_PROMPT_CHARS = 1_600;
const AI_CHAT_ANNOUNCEMENT_CONTENT_CHARS = 320;
const AI_CHAT_EVENT_DESCRIPTION_CHARS = 280;
const AI_CHAT_FORM_DESCRIPTION_CHARS = 240;
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

const projectForms = (forms: unknown[], currentUserEmail: string) =>
  forms.slice(-8).map(item => {
    const form = isRecord(item) ? item : {};
    const responses = Array.isArray(form.responses) ? form.responses : [];
    const normalizedCurrentUserEmail = currentUserEmail.trim().toLowerCase();
    const currentUserResponded = normalizedCurrentUserEmail
      ? responses.some(response => {
          if (!isRecord(response)) return false;
          return trimText(response.respondentEmail, 160).toLowerCase() === normalizedCurrentUserEmail;
        })
      : false;
    const questions = Array.isArray(form.questions) ? form.questions : [];

    return {
      id: trimText(form.id, 80),
      title: trimText(form.title, 120),
      description: trimText(form.description, AI_CHAT_FORM_DESCRIPTION_CHARS),
      createdBy: trimText(form.createdBy, 120),
      createdAt: typeof form.createdAt === 'string' ? form.createdAt : '',
      questionCount: questions.length,
      responseCount: responses.length,
      currentUserResponded,
      needsResponseFromCurrentUser: !currentUserResponded,
    };
  });

const projectSocialPosts = (socialPosts: unknown[]) =>
  socialPosts.slice(-8).map(item => {
    const post = isRecord(item) ? item : {};
    return {
      id: typeof post.id === 'string' || typeof post.id === 'number' ? String(post.id) : '',
      title: trimText(post.title, 120),
      content: trimText(post.content, 280),
      author: trimText(post.author, 120),
      date: typeof post.date === 'string' ? post.date : '',
      likes: typeof post.likes === 'number' ? post.likes : 0,
      commentCount: Array.isArray(post.comments) ? post.comments.length : 0,
    };
  });

const projectGalleryImages = (galleryImages: unknown[]) =>
  galleryImages.slice(-10).map(item => {
    const image = isRecord(item) ? item : {};
    return {
      id: typeof image.id === 'string' || typeof image.id === 'number' ? String(image.id) : '',
      alt: trimText(image.alt, 120),
      author: trimText(image.author, 120),
      date: typeof image.date === 'string' ? image.date : '',
      likes: typeof image.likes === 'number' ? image.likes : 0,
      status: trimText(image.status, 40),
    };
  });

const projectPointEntries = (pointEntries: unknown[]) =>
  pointEntries.slice(-12).map(item => {
    const entry = isRecord(item) ? item : {};
    return {
      id: trimText(entry.id, 80),
      memberEmail: trimText(entry.memberEmail, 120),
      points: typeof entry.points === 'number' ? entry.points : 0,
      reason: trimText(entry.reason, 140),
      date: typeof entry.date === 'string' ? entry.date : '',
      awardedBy: trimText(entry.awardedBy, 120),
    };
  });

const projectTransactions = (transactions: unknown[]) =>
  transactions.slice(-12).map(item => {
    const transaction = isRecord(item) ? item : {};
    return {
      id: trimText(transaction.id, 80),
      description: trimText(transaction.description, 140),
      amount: typeof transaction.amount === 'number' ? transaction.amount : 0,
      date: typeof transaction.date === 'string' ? transaction.date : '',
      status: trimText(transaction.status, 40),
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

const projectContextForPrompt = (
  context: AiChatDataContext,
  options: { currentUserEmail: string }
) => {
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
  if (context.forms) {
    projected.forms = projectForms(context.forms, options.currentUserEmail);
  }
  if (context.socialPosts) {
    projected.socialPosts = projectSocialPosts(context.socialPosts);
  }
  if (context.galleryImages) {
    projected.galleryImages = projectGalleryImages(context.galleryImages);
  }
  if (context.pointEntries) {
    projected.pointEntries = projectPointEntries(context.pointEntries);
  }
  if (context.transactions) {
    projected.transactions = projectTransactions(context.transactions);
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
  "entities": ["announcements" | "messages" | "members" | "events" | "forms" | "social_posts" | "gallery" | "points" | "transactions"]
}

Rules:
- Do not include markdown.
- Do not include explanations.
- Do not infer access outside the provided org_id and group_id.
- Only choose entities that appear in accessible_entities.
- Retrieval is required only when the answer depends on real facts from this specific group's accessible records.
- Set "needs_data" to false for drafting, rewriting, brainstorming, summarizing user-provided text, editing tone, translation, generic advice, and other requests that can be answered helpfully without looking up group records.
- If group data would only make the answer more tailored but is not required to produce a useful response, set "needs_data" to false.
- Only include entities that are truly needed.

Examples:
- "Are there any announcements in this group?" -> {"needs_data": true, "intent": "GROUP_DATA", "entities": ["announcements"]}
- "Who is the admin of this group?" -> {"needs_data": true, "intent": "MEMBERSHIP", "entities": ["members"]}
- "Are there any forms I still need to fill out?" -> {"needs_data": true, "intent": "GROUP_DATA", "entities": ["forms"]}
- "How many points do I have?" -> {"needs_data": true, "intent": "GROUP_DATA", "entities": ["points"]}
- "Show recent gallery uploads." -> {"needs_data": true, "intent": "GROUP_DATA", "entities": ["gallery"]}
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

export const getAllowedAiChatEntities = (role?: string | null) => {
  const normalizedRole = normalizeGroupRole(role);
  const canSeeTransactions = isGroupAdminRole(normalizedRole);

  return AI_CHAT_ENTITIES.filter(entity => {
    if (entity === 'transactions') {
      return canSeeTransactions;
    }
    return true;
  });
};

export const filterAllowedAiChatEntities = (
  entities: AiChatEntity[],
  role?: string | null
) => {
  const allowed = new Set(getAllowedAiChatEntities(role));
  return normalizeAiChatEntities(entities).filter(entity => allowed.has(entity));
};

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
  if (normalizedEntities.includes('forms')) {
    context.forms = Array.isArray(row?.forms) ? row.forms : [];
  }
  if (normalizedEntities.includes('social_posts')) {
    context.socialPosts = Array.isArray(row?.socialPosts) ? row.socialPosts : [];
  }
  if (normalizedEntities.includes('gallery')) {
    context.galleryImages = Array.isArray(row?.galleryImages) ? row.galleryImages : [];
  }
  if (normalizedEntities.includes('points')) {
    context.pointEntries = Array.isArray(row?.pointEntries) ? row.pointEntries : [];
  }
  if (normalizedEntities.includes('transactions')) {
    context.transactions = Array.isArray(row?.transactions) ? row.transactions : [];
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
  userEmail,
  orgId,
  groupId,
  role,
  availableEntities,
}: {
  message: string;
  history?: AiChatHistoryMessage[];
  userId: string;
  userEmail: string;
  orgId: string;
  groupId: string;
  role: string;
  availableEntities: AiChatEntity[];
}) => {
  const recentHistory = normalizeHistory(history);
  const availableEntitySet = new Set(availableEntities);
  const availableDataLines = [
    availableEntitySet.has('announcements')
      ? '- announcements: recent announcement records with title, content, author, date, viewedBy'
      : null,
    availableEntitySet.has('messages')
      ? '- messages: direct message threads plus group chats with recent messages'
      : null,
    availableEntitySet.has('members')
      ? '- members: group member roster with names, emails, and roles'
      : null,
    availableEntitySet.has('events')
      ? '- events: group events with title, date, location, attendees, and RSVPs'
      : null,
    availableEntitySet.has('forms')
      ? '- forms: group forms with titles, descriptions, response counts, and whether the current user has responded'
      : null,
    availableEntitySet.has('social_posts')
      ? '- social_posts: recent social posts with titles, content, likes, comments, and dates'
      : null,
    availableEntitySet.has('gallery')
      ? '- gallery: recent gallery uploads with captions, authors, likes, and dates'
      : null,
    availableEntitySet.has('points')
      ? '- points: recent point entries with member emails, reasons, points, and dates'
      : null,
    availableEntitySet.has('transactions')
      ? '- transactions: recent finance transactions with descriptions, amounts, dates, and statuses'
      : null,
  ].filter(Boolean);

  return [
    `user_id: ${userId}`,
    `user_email: ${userEmail}`,
    `user_role: ${role}`,
    `org_id: ${orgId}`,
    `group_id: ${groupId}`,
    `recent_history: ${recentHistory.length ? JSON.stringify(recentHistory) : '[]'}`,
    `current_user_message: ${trimText(message, AI_CHAT_CURRENT_MESSAGE_PROMPT_CHARS)}`,
    `accessible_entities: ${JSON.stringify(availableEntities)}`,
    [
      'available_group_data:',
      ...(availableDataLines.length ? availableDataLines : ['- none']),
    ].join('\n'),
  ].join('\n\n');
};

export const buildAiChatResponderPrompt = ({
  message,
  history,
  planner,
  usedEntities,
  context,
  currentUserEmail,
}: {
  message: string;
  history?: AiChatHistoryMessage[];
  planner: AiChatPlannerResult;
  usedEntities: AiChatEntity[];
  context: AiChatDataContext;
  currentUserEmail: string;
}) => {
  const recentHistory = normalizeHistory(history);
  const projectedContext = projectContextForPrompt(context, { currentUserEmail });
  const fetchedDataNote = usedEntities.length
    ? 'The backend provided a bounded subset of the requested group data. If the answer is not in that subset, say you do not have enough data.'
    : 'No group data was fetched because the planner determined this request can be answered without retrieval. Use the user message and recent history to respond helpfully. Do not refuse just because fetched_group_data is null.';

  return [
    `planner_result: ${JSON.stringify(planner)}`,
    `used_entities: ${JSON.stringify(usedEntities)}`,
    `current_user_email: ${currentUserEmail}`,
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
  role,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  groupId: string;
  entities: AiChatEntity[];
  role?: string | null;
}) => {
  const usedEntities = filterAllowedAiChatEntities(entities, role);
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
