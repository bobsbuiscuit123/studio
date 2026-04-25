import type { AiChatHistoryMessage } from '@/lib/ai-chat';
import type { RetrievalBundle } from '@/lib/assistant/agent/retrieval';
import { actionFieldSchemaByActionType } from '@/lib/assistant/agent/schemas';
import type {
  AgentActionType,
  PendingActionFields,
  RecipientRef,
  RetrievalTargetResource,
} from '@/lib/assistant/agent/types';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const weekdayPattern =
  /\b(?:next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const explicitTimePattern =
  /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const WEEKDAY_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAYPART_DEFAULTS = {
  morning: '09:00',
  afternoon: '14:00',
  evening: '19:00',
} as const;
const DEFAULT_EVENT_TIME = '18:00';
const DEFAULT_EVENT_LOCATION = 'TBD';
const REQUEST_PREFIX_PATTERN = /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?/i;
const COMMAND_NOISE_PATTERN =
  /\b(?:send|post|create|draft|write|make|publish|share|compose|generate|announce(?:ment)?|message|event|update|reminder|remind|everyone|everybody|team|group|members?|them|all)\b/gi;
const TOPIC_STOP_WORD_PATTERN =
  /\b(?:that|to|about|regarding|please|everyone|everybody|they|their|them|this|the|a|an|need|needs|should|just|quick|in|on|for|with|use)\b/gi;

const TITLE_KEYWORDS = [
  {
    pattern: /\bdues?\b/i,
    announcement: 'Dues Reminder',
    event: 'Dues Meeting',
  },
  {
    pattern: /\bvolunteer(?:ing)?\b/i,
    announcement: 'Volunteer Update',
    event: 'Volunteer Event',
  },
  {
    pattern: /\belections?\b/i,
    announcement: 'Election Update',
    event: 'Election Event',
  },
  {
    pattern: /\bmeeting\b/i,
    announcement: 'Meeting Reminder',
    event: 'Group Meeting',
  },
  {
    pattern: /\bfundraiser\b/i,
    announcement: 'Fundraiser Update',
    event: 'Fundraiser Event',
  },
  {
    pattern: /\bbudget\b/i,
    announcement: 'Budget Update',
    event: 'Budget Review',
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    announcement: 'Payment Reminder',
    event: 'Payment Meeting',
  },
] as const;

type NamedRecord = Record<string, unknown>;
type CandidateRecord = {
  id: string;
  title: string;
};
type MemberRecord = {
  email: string;
  name: string;
  role?: string;
};
type NormalizedFieldResult =
  | { ok: true; value: string }
  | { ok: false };

export const ALLOWED_INFERRED_FIELDS_BY_ACTION: Record<AgentActionType, Set<string>> = {
  create_announcement: new Set(['title', 'body']),
  update_announcement: new Set(['title', 'body']),
  create_event: new Set(['title', 'description', 'location', 'date', 'time']),
  update_event: new Set(['title', 'description', 'location', 'date', 'time']),
  create_message: new Set(['body']),
  create_email: new Set(['subject', 'body']),
};

const normalize = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const stripTrailingPunctuation = (value: string) => value.replace(/[.!?]+$/g, '').trim();

const sentenceCase = (value: string) => {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) return '';
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
};

const ensureSentence = (value: string) => {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) return '';
  return /[.!?]$/.test(collapsed) ? collapsed : `${collapsed}.`;
};

const joinSentences = (...values: string[]) =>
  values
    .map(value => ensureSentence(value))
    .filter(Boolean)
    .join(' ');

const toTitleCase = (value: string) =>
  collapseWhitespace(value)
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const countWords = (value: string) =>
  collapseWhitespace(value)
    .split(' ')
    .filter(Boolean).length;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const hasResolvedValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined;
};

const asRecord = (value: unknown): NamedRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as NamedRecord)
    : null;

const removeLeadingRequestPhrase = (value: string) =>
  collapseWhitespace(value.replace(REQUEST_PREFIX_PATTERN, ''));

const extractIntentClause = (value: string) => {
  const cleaned = removeLeadingRequestPhrase(value);
  if (!cleaned) return '';

  const patterns = [
    /\bremind\b.*?\bthat\s+(.+)$/i,
    /\b(?:announcement|message|note|post)\b.*?\bthat\s+(.+)$/i,
    /\bremind\b.*?\bto\s+(.+)$/i,
    /\b(?:about|regarding)\s+(.+)$/i,
    /\b(?:for|on)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      return collapseWhitespace(match[1]);
    }
  }

  const stripped = collapseWhitespace(cleaned.replace(COMMAND_NOISE_PATTERN, ' '));
  return stripped || cleaned;
};

const getKeywordTitle = (sourceText: string, kind: 'announcement' | 'event') => {
  for (const config of TITLE_KEYWORDS) {
    if (config.pattern.test(sourceText)) {
      return config[kind];
    }
  }
  return null;
};

const getFallbackTitleFromClause = (sourceText: string, suffix: string, fallback: string) => {
  const words = extractIntentClause(sourceText)
    .replace(TOPIC_STOP_WORD_PATTERN, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  if (words.length < 2) {
    return fallback;
  }

  return `${toTitleCase(words.join(' '))} ${suffix}`.trim();
};

const buildAnnouncementTitle = (sourceText: string) =>
  getKeywordTitle(sourceText, 'announcement') ??
  getFallbackTitleFromClause(sourceText, 'Update', 'Group Announcement');

const buildAnnouncementBody = (sourceText: string) => {
  const normalizedSource = normalize(sourceText);
  if (/\bdues?\b/i.test(normalizedSource)) {
    return joinSentences(
      'This is a reminder that dues still need to be paid',
      'Please submit your dues as soon as possible',
      'Thank you'
    );
  }

  if (/\bvolunteer(?:ing)?\b/i.test(normalizedSource)) {
    return joinSentences(
      'We are looking for volunteers',
      'Please sign up if you are available to help'
    );
  }

  if (/\bmeeting\b/i.test(normalizedSource)) {
    return joinSentences(
      'This is a reminder about the upcoming meeting',
      'Please plan accordingly'
    );
  }

  const clause = extractIntentClause(sourceText);
  if (!clause || countWords(clause) < 2) {
    return joinSentences(
      'Please review this announcement draft',
      'Edit any details you would like before posting'
    );
  }

  if (/^that\s+/i.test(clause)) {
    return joinSentences(
      `This is a reminder ${stripTrailingPunctuation(clause)}`,
      'Please review the details and plan accordingly'
    );
  }

  if (/^to\s+/i.test(clause)) {
    return joinSentences(
      `This is a reminder to ${stripTrailingPunctuation(clause.replace(/^to\s+/i, ''))}`,
      'Please plan accordingly'
    );
  }

  if (/^(about|regarding)\s+/i.test(clause)) {
    return joinSentences(
      `We wanted to share an update ${stripTrailingPunctuation(clause)}`,
      'Please review the details and plan accordingly'
    );
  }

  return joinSentences(
    sentenceCase(stripTrailingPunctuation(clause)),
    'Please review the details and plan accordingly'
  );
};

const buildMessageBody = (sourceText: string) => {
  const normalizedSource = normalize(sourceText);
  if (/\bdues?\b/i.test(normalizedSource)) {
    return joinSentences(
      'Just a quick reminder that dues are still due',
      'Please submit yours when you can',
      'Thank you'
    );
  }

  if (/\bmeeting\b/i.test(normalizedSource)) {
    return joinSentences(
      'Just a quick reminder about the upcoming meeting',
      'Please let me know if you have any questions'
    );
  }

  if (/\bremind(?:er)?\b/i.test(normalizedSource) && !/\b(?:that|to|about|regarding|for|on)\b/i.test(normalizedSource)) {
    return joinSentences(
      'Just a quick note to follow up on this request',
      'Feel free to edit any details before sending'
    );
  }

  const clause = extractIntentClause(sourceText);
  if (!clause || countWords(clause) < 2) {
    return joinSentences(
      'Just a quick note to follow up on this request',
      'Feel free to edit any details before sending'
    );
  }

  if (/^that\s+/i.test(clause)) {
    return joinSentences(`Just a quick note ${stripTrailingPunctuation(clause)}`, 'Thank you');
  }

  if (/^to\s+/i.test(clause)) {
    return joinSentences(
      `Just a quick reminder to ${stripTrailingPunctuation(clause.replace(/^to\s+/i, ''))}`,
      'Thank you'
    );
  }

  if (/^(about|regarding)\s+/i.test(clause)) {
    return joinSentences(`Just a quick note ${stripTrailingPunctuation(clause)}`, 'Thank you');
  }

  return joinSentences(`Just a quick note: ${sentenceCase(stripTrailingPunctuation(clause))}`, 'Thank you');
};

const buildEventTitle = (sourceText: string) =>
  getKeywordTitle(sourceText, 'event') ??
  getFallbackTitleFromClause(sourceText, 'Event', 'Group Event');

const buildEventDescription = (sourceText: string) => {
  const normalizedSource = normalize(sourceText);
  if (/\bdues?\b/i.test(normalizedSource)) {
    return joinSentences(
      'We will use this time to review dues and next steps together',
      'Please edit any details as needed'
    );
  }

  const clause = extractIntentClause(sourceText);
  if (!clause || countWords(clause) < 2) {
    return joinSentences(
      'Please review this event draft',
      'Add any additional details you would like attendees to see'
    );
  }

  if (/^to\s+/i.test(clause)) {
    return joinSentences(
      `We will use this time to ${stripTrailingPunctuation(clause.replace(/^to\s+/i, ''))}`,
      'Please edit any details as needed'
    );
  }

  if (/^(about|regarding)\s+/i.test(clause)) {
    return joinSentences(
      `We will gather to discuss ${stripTrailingPunctuation(clause.replace(/^(about|regarding)\s+/i, ''))}`,
      'Please edit any details as needed'
    );
  }

  return joinSentences(
    sentenceCase(stripTrailingPunctuation(clause)),
    'Please edit any details as needed'
  );
};

const isTimeLikeLocation = (value: string) =>
  explicitTimePattern.test(value) ||
  /\b(?:tomorrow|tonight|morning|afternoon|evening|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
    value
  );

const extractExplicitLocation = (sourceText: string) => {
  const matches = sourceText.matchAll(/\b(?:at|in)\s+([^,.;!?]+)/gi);
  for (const match of matches) {
    const candidate = collapseWhitespace(stripTrailingPunctuation(match[1] ?? ''));
    if (!candidate || candidate.split(' ').length > 6 || isTimeLikeLocation(candidate)) {
      continue;
    }
    return sentenceCase(candidate);
  }
  return null;
};

const buildDefaultEventDate = (
  sourceText: string,
  requestTimezone: string,
  requestReceivedAt: string
) =>
  getRelativeDateKeyFromSource(sourceText, requestTimezone, requestReceivedAt) ??
  addDaysToDateKey(getZonedReference(requestReceivedAt, requestTimezone).localDate, 1);

const buildDefaultEventTime = (args: {
  sourceText: string;
  requestTimezone: string;
  requestReceivedAt: string;
}) =>
  getRelativeTimeFromSource({
    sourceText: args.sourceText,
    candidateTime: '6:00 PM',
    requestTimezone: args.requestTimezone,
    requestReceivedAt: args.requestReceivedAt,
  }) ?? DEFAULT_EVENT_TIME;

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(item => (typeof item === 'string' ? [item] : []));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
};

const extractCandidates = (items: unknown): CandidateRecord[] =>
  (Array.isArray(items) ? items : [])
    .map(item => asRecord(item))
    .flatMap(item => {
      if (!item) return [];
      const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      return id && title ? [{ id, title }] : [];
    });

const extractMembers = (items: unknown): MemberRecord[] =>
  (Array.isArray(items) ? items : [])
    .map(item => asRecord(item))
    .flatMap(item => {
      if (!item) return [];
      const email = typeof item.email === 'string' ? item.email.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const role = typeof item.role === 'string' ? item.role.trim() : '';
      return email ? [{ email, name, ...(role ? { role } : {}) }] : [];
    });

const uniqueByEmail = (recipients: RecipientRef[]) =>
  Array.from(
    recipients.reduce((map, recipient) => {
      map.set(normalize(recipient.email), recipient);
      return map;
    }, new Map<string, RecipientRef>()).values()
  );

const allRecipientsPattern = /^(?:all|everyone|everybody|all members)$/i;

const recipientsFromMembers = (members: MemberRecord[]) =>
  uniqueByEmail(
    members.map(member => ({
      email: member.email,
      ...(member.name ? { name: member.name } : {}),
    }))
  );

const resolveNamedMember = (value: string, members: MemberRecord[]) => {
  const normalized = normalize(value);
  const byEmail = members.filter(member => normalize(member.email) === normalized);
  if (byEmail.length === 1) {
    return { email: byEmail[0].email, name: byEmail[0].name || undefined };
  }

  const byName = members.filter(member => normalize(member.name) === normalized);
  if (byName.length === 1) {
    return { email: byName[0].email, name: byName[0].name || undefined };
  }

  return null;
};

const resolveExplicitRecipients = (rawRecipients: unknown, members: MemberRecord[]) => {
  const values = Array.isArray(rawRecipients) ? rawRecipients : toStringArray(rawRecipients);
  if (values.length === 0) return undefined;

  const resolved: RecipientRef[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      if (emailPattern.test(value.trim())) {
        resolved.push({ email: value.trim() });
        continue;
      }

      const member = resolveNamedMember(value, members);
      if (!member) {
        return undefined;
      }
      resolved.push(member);
      continue;
    }

    const record = asRecord(value);
    if (!record) {
      return undefined;
    }

    const email = typeof record.email === 'string' ? record.email.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (emailPattern.test(email)) {
      resolved.push({ email, ...(name ? { name } : {}) });
      continue;
    }

    if (name) {
      const member = resolveNamedMember(name, members);
      if (!member) {
        return undefined;
      }
      resolved.push(member);
      continue;
    }

    return undefined;
  }

  return uniqueByEmail(resolved);
};

const resolveRecipientsFromMessage = (message: string, members: MemberRecord[]) => {
  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return undefined;

  const matches = members.filter(member => {
    const normalizedName = normalize(member.name);
    const normalizedEmail = normalize(member.email);
    return (
      (normalizedName.length >= 3 && normalizedMessage.includes(normalizedName)) ||
      normalizedMessage.includes(normalizedEmail)
    );
  });

  if (matches.length === 0) return undefined;
  return uniqueByEmail(
    matches.map(member => ({ email: member.email, ...(member.name ? { name: member.name } : {}) }))
  );
};

const resolveInferredRecipients = (candidate: unknown, members: MemberRecord[]) => {
  if (members.length === 0) {
    return undefined;
  }

  if (typeof candidate === 'string' && allRecipientsPattern.test(candidate.trim())) {
    return recipientsFromMembers(members);
  }

  if (
    Array.isArray(candidate) &&
    candidate.length === 1 &&
    typeof candidate[0] === 'string' &&
    allRecipientsPattern.test(candidate[0].trim())
  ) {
    return recipientsFromMembers(members);
  }

  return resolveExplicitRecipients(candidate, members);
};

const resolveCandidateTarget = (
  rawTargetRef: unknown,
  message: string,
  candidates: CandidateRecord[]
) => {
  const normalizedMessage = normalize(message);

  const tryExactMatch = (value: string) => {
    const normalizedValue = normalize(value);
    if (!normalizedValue) return null;

    const byId = candidates.filter(candidate => normalize(candidate.id) === normalizedValue);
    if (byId.length === 1) {
      return byId[0].id;
    }

    const byTitle = candidates.filter(candidate => normalize(candidate.title) === normalizedValue);
    if (byTitle.length === 1) {
      return byTitle[0].id;
    }

    return null;
  };

  const explicitString =
    typeof rawTargetRef === 'string'
      ? rawTargetRef.trim()
      : (() => {
          const record = asRecord(rawTargetRef);
          if (!record) return '';
          if (typeof record.id === 'string' || typeof record.id === 'number') {
            return String(record.id);
          }
          if (typeof record.title === 'string') {
            return record.title;
          }
          return '';
        })();

  if (explicitString) {
    const exactMatch = tryExactMatch(explicitString);
    if (exactMatch) {
      return exactMatch;
    }
    return candidates.length === 0 ? explicitString : undefined;
  }

  const titleMatches = candidates.filter(candidate => {
    const normalizedTitle = normalize(candidate.title);
    return normalizedTitle.length >= 3 && normalizedMessage.includes(normalizedTitle);
  });

  return titleMatches.length === 1 ? titleMatches[0].id : undefined;
};

const getInferenceSourceText = (userMessage: string, recentHistory?: AiChatHistoryMessage[]) =>
  [...(recentHistory ?? []).map(item => item.content), userMessage]
    .map(value => value.trim())
    .filter(Boolean)
    .join('\n');

const getFormatterParts = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  return formatter.formatToParts(date).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
    return parts;
  }, {});
};

const getReferenceDate = (requestReceivedAt: string) => {
  const parsed = new Date(requestReceivedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const getZonedReference = (requestReceivedAt: string, requestTimezone: string) => {
  const referenceDate = getReferenceDate(requestReceivedAt);
  const parts = getFormatterParts(referenceDate, requestTimezone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const weekdayIndex = WEEKDAY_TO_INDEX[normalize(parts.weekday)];
  const localDate = new Date(Date.UTC(year, month - 1, day));

  return {
    localDate,
    hour,
    minute,
    weekdayIndex,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
};

const addDaysToDateKey = (baseDate: Date, daysToAdd: number) => {
  const nextDate = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  return nextDate.toISOString().slice(0, 10);
};

const getRelativeDateKeyFromSource = (
  sourceText: string,
  requestTimezone: string,
  requestReceivedAt: string
) => {
  const normalizedSource = normalize(sourceText);
  if (!normalizedSource || normalizedSource.includes('this weekend')) {
    return null;
  }

  const reference = getZonedReference(requestReceivedAt, requestTimezone);

  if (/\b(tomorrow|tmr|tmrw)\b/i.test(normalizedSource)) {
    return addDaysToDateKey(reference.localDate, 1);
  }

  if (/\b(tonight|tonite|this evening)\b/i.test(normalizedSource)) {
    return reference.hour < 19 ? reference.dateKey : null;
  }

  const weekdayMatch = normalizedSource.match(weekdayPattern);
  if (!weekdayMatch) {
    return null;
  }

  const [, weekday] = weekdayMatch;
  const targetIndex = WEEKDAY_TO_INDEX[weekday.toLowerCase()];
  if (typeof targetIndex !== 'number') {
    return null;
  }

  if (normalizedSource.includes(`next ${weekday.toLowerCase()}`)) {
    const delta = ((targetIndex - reference.weekdayIndex + 7) % 7) || 7;
    return addDaysToDateKey(reference.localDate, delta);
  }

  if (normalizedSource.includes(`this ${weekday.toLowerCase()}`)) {
    const delta = (targetIndex - reference.weekdayIndex + 7) % 7;
    return addDaysToDateKey(reference.localDate, delta);
  }

  return null;
};

const normalizeCandidateTime = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1]);
    const minute = Number(twentyFourHourMatch[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    return null;
  }

  const meridiemMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!meridiemMatch) {
    return null;
  }

  let hour = Number(meridiemMatch[1]);
  const minute = Number(meridiemMatch[2] ?? '0');
  const meridiem = meridiemMatch[3].toLowerCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem === 'pm' && hour < 12) {
    hour += 12;
  }
  if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const normalizeCandidateDate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (ISO_DATE_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const isoDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoDateMatch?.[1]) {
    return isoDateMatch[1];
  }

  return null;
};

const getDaypartFromText = (sourceText: string) => {
  const normalizedSource = normalize(sourceText);
  if (/\b(morning)\b/i.test(normalizedSource)) return 'morning';
  if (/\b(afternoon)\b/i.test(normalizedSource)) return 'afternoon';
  if (/\b(evening|tonight|tonite|this evening)\b/i.test(normalizedSource)) return 'evening';
  return null;
};

const getRelativeTimeFromSource = (args: {
  sourceText: string;
  candidateTime: string;
  requestTimezone: string;
  requestReceivedAt: string;
}) => {
  const normalizedSource = normalize(args.sourceText);
  if (!normalizedSource || normalizedSource.includes('this weekend')) {
    return null;
  }

  const reference = getZonedReference(args.requestReceivedAt, args.requestTimezone);
  const daypart = getDaypartFromText(args.sourceText);
  const explicitTimeMatch = args.sourceText.match(explicitTimePattern);

  if (explicitTimeMatch) {
    const [, rawHour, rawMinute = '00', rawMeridiem] = explicitTimeMatch;
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
      return null;
    }

    if (rawMeridiem) {
      return normalizeCandidateTime(`${rawHour}:${rawMinute} ${rawMeridiem}`);
    }

    if (daypart === 'morning') {
      const normalizedHour = hour === 12 ? 0 : hour;
      return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    if (daypart === 'afternoon' || daypart === 'evening') {
      let normalizedHour = hour;
      if (normalizedHour < 12) {
        normalizedHour += 12;
      }
      return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }

    return normalizeCandidateTime(args.candidateTime);
  }

  if (daypart === 'evening') {
    if (/\b(tonight|tonite|this evening)\b/i.test(normalizedSource) && reference.hour >= 19) {
      return null;
    }
    return DAYPART_DEFAULTS.evening;
  }

  if (daypart === 'morning') {
    return DAYPART_DEFAULTS.morning;
  }

  if (daypart === 'afternoon') {
    return DAYPART_DEFAULTS.afternoon;
  }

  return null;
};

export function normalizeInferredField(args: {
  actionType: AgentActionType;
  field: string;
  value: string;
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  requestTimezone: string;
  requestReceivedAt: string;
}): NormalizedFieldResult {
  const trimmedValue = args.value.trim();
  if (!trimmedValue) {
    return { ok: false };
  }

  if (
    args.field !== 'date' &&
    args.field !== 'time' &&
    args.field !== 'recipients' &&
    args.field !== 'targetRef'
  ) {
    return { ok: true, value: trimmedValue };
  }

  if (args.field === 'recipients' || args.field === 'targetRef') {
    return { ok: false };
  }

  if (args.actionType !== 'create_event' && args.actionType !== 'update_event') {
    return { ok: false };
  }

  if (args.field === 'date') {
    const dateKey = normalizeCandidateDate(trimmedValue);
    return dateKey ? { ok: true, value: dateKey } : { ok: false };
  }

  if (args.field === 'time') {
    const timeValue = normalizeCandidateTime(trimmedValue);
    return timeValue ? { ok: true, value: timeValue } : { ok: false };
  }

  return { ok: false };
}

export function mergeInferredActionFields(args: {
  actionType: AgentActionType;
  resolvedActionFields: PendingActionFields;
  inferredFields?: Record<string, unknown> | null;
  availableRecipients?: RecipientRef[];
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  requestTimezone: string;
  requestReceivedAt: string;
}): { mergedFields: PendingActionFields; mergedFieldKeys: string[] } {
  const mergedFields: PendingActionFields = { ...args.resolvedActionFields };
  const mergedFieldKeys: string[] = [];
  const allowedFields = ALLOWED_INFERRED_FIELDS_BY_ACTION[args.actionType];
  const availableRecipientMembers = (args.availableRecipients ?? []).map(recipient => ({
    email: recipient.email,
    name: recipient.name ?? '',
  }));
  const schemaMap = actionFieldSchemaByActionType[args.actionType] as Record<
    string,
    { safeParse: (value: unknown) => { success: boolean; data?: string } }
  >;

  for (const [field, candidate] of Object.entries(args.inferredFields ?? {})) {
    if (!allowedFields.has(field)) continue;
    if (field === 'targetRef') continue;
    if (hasResolvedValue(mergedFields[field])) continue;

    if (field === 'recipients') {
      const normalizedRecipients = resolveInferredRecipients(candidate, availableRecipientMembers);
      if (!normalizedRecipients || normalizedRecipients.length === 0) continue;

      mergedFields[field] = normalizedRecipients;
      mergedFieldKeys.push(field);
      continue;
    }

    const schema = schemaMap[field];
    if (!schema) continue;

    const parsed = schema.safeParse(candidate);
    if (!parsed.success || typeof parsed.data !== 'string') continue;

    const normalized = normalizeInferredField({
      actionType: args.actionType,
      field,
      value: parsed.data,
      userMessage: args.userMessage,
      recentHistory: args.recentHistory,
      requestTimezone: args.requestTimezone,
      requestReceivedAt: args.requestReceivedAt,
    });

    if (!normalized.ok || !hasResolvedValue(normalized.value)) continue;

    mergedFields[field] = normalized.value;
    mergedFieldKeys.push(field);
  }

  return {
    mergedFields,
    mergedFieldKeys,
  };
}

export function fillGeneratedActionFields(args: {
  actionType: AgentActionType;
  actionFields: PendingActionFields;
  availableRecipients?: RecipientRef[];
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  requestTimezone: string;
  requestReceivedAt: string;
}): { filledFields: PendingActionFields; defaultedFieldKeys: string[] } {
  return {
    filledFields: { ...args.actionFields },
    defaultedFieldKeys: [],
  };
}

export const getActionRequiredRetrievalResources = (
  actionType: AgentActionType
): RetrievalTargetResource[] => {
  switch (actionType) {
    case 'create_message':
      return ['members'];
    case 'update_announcement':
      return ['announcements'];
    case 'update_event':
      return ['events'];
    default:
      return [];
  }
};

export function getAvailableRecipients(args: {
  actionType: AgentActionType;
  retrieval: RetrievalBundle;
  userEmail: string;
}): Array<RecipientRef & { role?: string }> {
  if (
    args.actionType !== 'create_message'
  ) {
    return [];
  }

  const members = extractMembers(args.retrieval.context.members).filter(member =>
    args.actionType === 'create_message' ? normalize(member.email) !== normalize(args.userEmail) : true
  );

  return members.map(member => ({
    email: member.email,
    ...(member.name ? { name: member.name } : {}),
    ...(member.role ? { role: member.role } : {}),
  }));
}

export function resolveActionFields(args: {
  actionType: AgentActionType;
  fieldsProvided: Record<string, unknown>;
  message: string;
  retrieval: RetrievalBundle;
}): PendingActionFields {
  const baseFields = { ...args.fieldsProvided };
  const geminiOwnedFields = ALLOWED_INFERRED_FIELDS_BY_ACTION[args.actionType];
  for (const field of geminiOwnedFields) {
    delete baseFields[field];
  }

  if (args.actionType === 'create_announcement') {
    return baseFields;
  }

  if (args.actionType === 'update_announcement') {
    const { targetRef: _ignoredTargetRef, ...remainingFields } = baseFields;
    const targetRef = resolveCandidateTarget(
      args.fieldsProvided.targetRef,
      args.message,
      extractCandidates(args.retrieval.context.announcements)
    );
    return {
      ...remainingFields,
      ...(targetRef ? { targetRef } : {}),
    };
  }

  if (args.actionType === 'update_event') {
    const { targetRef: _ignoredTargetRef, ...remainingFields } = baseFields;
    const targetRef = resolveCandidateTarget(
      args.fieldsProvided.targetRef,
      args.message,
      extractCandidates(args.retrieval.context.events)
    );
    return {
      ...remainingFields,
      ...(targetRef ? { targetRef } : {}),
    };
  }

  if (args.actionType === 'create_message') {
    const members = extractMembers(args.retrieval.context.members);
    const recipients =
      resolveExplicitRecipients(args.fieldsProvided.recipients, members) ??
      resolveRecipientsFromMessage(args.message, members);

    return {
      ...baseFields,
      ...(recipients ? { recipients } : {}),
    };
  }

  return baseFields;
}
