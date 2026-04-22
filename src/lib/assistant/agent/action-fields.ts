import type { RetrievalBundle } from '@/lib/assistant/agent/retrieval';
import type {
  AgentActionType,
  PendingActionFields,
  RecipientRef,
  RetrievalTargetResource,
} from '@/lib/assistant/agent/types';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

type NamedRecord = Record<string, unknown>;
type CandidateRecord = {
  id: string;
  title: string;
};
type MemberRecord = {
  email: string;
  name: string;
};

const normalize = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

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
