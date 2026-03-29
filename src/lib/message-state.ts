import type { GroupChat, Message } from '@/lib/mock-data';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export const normalizeMessageActor = (value?: string | null) =>
  String(value ?? '').trim().toLowerCase();

export const normalizeStringList = (
  value: unknown,
  { lowercase = false }: { lowercase?: boolean } = {}
) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map(item => toTrimmedString(item))
        .filter(Boolean)
        .map(item => (lowercase ? item.toLowerCase() : item))
    )
  );

export const normalizeMessage = (value: unknown): Message | null => {
  if (!isRecord(value)) return null;

  const sender = normalizeMessageActor(toTrimmedString(value.sender));
  const text = toTrimmedString(value.text);
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : '';
  const readBy = normalizeStringList(value.readBy, { lowercase: true });

  if (!sender && !text && !timestamp && readBy.length === 0) {
    return null;
  }

  return {
    sender,
    text,
    timestamp,
    readBy,
  };
};

export const normalizeMessageList = (value: unknown): Message[] =>
  (Array.isArray(value) ? value : [])
    .map(item => normalizeMessage(item))
    .filter((item): item is Message => Boolean(item));

export const normalizeMessageMap = (value: unknown): Record<string, Message[]> => {
  if (!isRecord(value)) return {};

  const normalized: Record<string, Message[]> = {};
  for (const [key, messages] of Object.entries(value)) {
    const normalizedKey = normalizeMessageActor(key);
    if (!normalizedKey) continue;
    normalized[normalizedKey] = normalizeMessageList(messages);
  }

  return normalized;
};

export const normalizeGroupChats = (value: unknown): GroupChat[] =>
  (Array.isArray(value) ? value : []).flatMap((chat): GroupChat[] => {
    if (!isRecord(chat)) return [];

    const id = toTrimmedString(chat.id);
    if (!id) return [];

    return [{
      id,
      name: toTrimmedString(chat.name) || 'Group chat',
      members: normalizeStringList(chat.members, { lowercase: true }),
      messages: normalizeMessageList(chat.messages),
    }];
  });

export const messageIncludesReader = (message: Pick<Message, 'readBy'> | null | undefined, actor: string) => {
  const normalizedActor = normalizeMessageActor(actor);
  if (!normalizedActor) return false;
  return normalizeStringList(message?.readBy, { lowercase: true }).includes(normalizedActor);
};

export const isMessageFromActor = (message: Pick<Message, 'sender'> | null | undefined, actor: string) => {
  const normalizedActor = normalizeMessageActor(actor);
  if (!normalizedActor) return false;
  return normalizeMessageActor(message?.sender) === normalizedActor;
};

export const markMessageReadByActor = (message: Message, actor: string): Message => {
  const normalizedActor = normalizeMessageActor(actor);
  if (!normalizedActor || messageIncludesReader(message, normalizedActor)) {
    return message;
  }

  return {
    ...message,
    readBy: [...normalizeStringList(message.readBy, { lowercase: true }), normalizedActor],
  };
};

export const getMessageTimestampMs = (message: Pick<Message, 'timestamp'> | null | undefined) => {
  if (!message?.timestamp) return 0;
  const timestamp = new Date(message.timestamp).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};
