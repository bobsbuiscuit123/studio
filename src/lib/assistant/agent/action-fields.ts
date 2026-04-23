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

type NamedRecord = Record<string, unknown>;
type CandidateRecord = {
  id: string;
  title: string;
};
type MemberRecord = {
  email: string;
  name: string;
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
};

const normalize = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const hasResolvedValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined;
};

const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

const asRecord = (value: unknown): NamedRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as NamedRecord)
    : null;

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
      return email ? [{ email, name }] : [];
    });

const uniqueByEmail = (recipients: RecipientRef[]) =>
  Array.from(
    recipients.reduce((map, recipient) => {
      map.set(normalize(recipient.email), recipient);
      return map;
    }, new Map<string, RecipientRef>()).values()
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

const extractAnnouncementBodyFromMessage = (message: string) => {
  let candidate = message.trim();
  if (!candidate) {
    return undefined;
  }

  const leadingInstructionPatterns = [
    /^(please\s+)?(send|post|create|write|draft|make|publish|share)\s+(out\s+)?(an?\s+)?announcement\b[:\s,-]*/i,
    /^(please\s+)?(send|post|create|write|draft|make|publish|share)\s+(an?\s+)?annou?n?c(e)?m?e?n?t?\b[:\s,-]*/i,
    /^(please\s+)?announcement\b[:\s,-]*/i,
  ];

  for (const pattern of leadingInstructionPatterns) {
    candidate = candidate.replace(pattern, '').trim();
  }

  candidate = candidate.replace(/^to\s+/i, '').trim();

  if (!candidate) {
    return undefined;
  }

  const normalizedCandidate = normalize(candidate);
  if (
    normalizedCandidate === 'announcement' ||
    normalizedCandidate === 'an announcement' ||
    normalizedCandidate === 'send announcement' ||
    normalizedCandidate === 'post announcement' ||
    normalizedCandidate === 'create announcement' ||
    normalizedCandidate === 'write announcement'
  ) {
    return undefined;
  }

  return candidate;
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

  const sourceText = getInferenceSourceText(args.userMessage, args.recentHistory);

  if (args.field === 'date') {
    const dateKey = getRelativeDateKeyFromSource(
      sourceText,
      args.requestTimezone,
      args.requestReceivedAt
    );
    return dateKey ? { ok: true, value: dateKey } : { ok: false };
  }

  if (args.field === 'time') {
    const timeValue = getRelativeTimeFromSource({
      sourceText,
      candidateTime: trimmedValue,
      requestTimezone: args.requestTimezone,
      requestReceivedAt: args.requestReceivedAt,
    });
    return timeValue ? { ok: true, value: timeValue } : { ok: false };
  }

  return { ok: false };
}

export function mergeInferredActionFields(args: {
  actionType: AgentActionType;
  resolvedActionFields: PendingActionFields;
  inferredFields?: Record<string, unknown> | null;
  userMessage: string;
  recentHistory?: AiChatHistoryMessage[];
  requestTimezone: string;
  requestReceivedAt: string;
}): { mergedFields: PendingActionFields; mergedFieldKeys: string[] } {
  const mergedFields: PendingActionFields = { ...args.resolvedActionFields };
  const mergedFieldKeys: string[] = [];
  const allowedFields = ALLOWED_INFERRED_FIELDS_BY_ACTION[args.actionType];
  const schemaMap = actionFieldSchemaByActionType[args.actionType] as Record<
    string,
    { safeParse: (value: unknown) => { success: boolean; data?: string } }
  >;

  for (const [field, candidate] of Object.entries(args.inferredFields ?? {})) {
    if (!allowedFields.has(field)) continue;
    if (field === 'recipients' || field === 'targetRef') continue;
    if (hasResolvedValue(mergedFields[field])) continue;

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

export function resolveActionFields(args: {
  actionType: AgentActionType;
  fieldsProvided: Record<string, unknown>;
  message: string;
  retrieval: RetrievalBundle;
}): PendingActionFields {
  const baseFields = { ...args.fieldsProvided };

  if (args.actionType === 'create_announcement') {
    const inferredBody = extractAnnouncementBodyFromMessage(args.message);

    return {
      ...baseFields,
      ...(hasText(baseFields.body) ? {} : inferredBody ? { body: inferredBody } : {}),
    };
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
    const { recipients: _ignoredRecipients, ...remainingFields } = baseFields;
    const members = extractMembers(args.retrieval.context.members);
    const explicitRecipients = resolveExplicitRecipients(args.fieldsProvided.recipients, members);
    const resolvedRecipients =
      explicitRecipients ?? resolveRecipientsFromMessage(args.message, members);

    return {
      ...remainingFields,
      ...(resolvedRecipients ? { recipients: resolvedRecipients } : {}),
    };
  }

  return baseFields;
}
