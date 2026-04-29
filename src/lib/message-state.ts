import type { GroupChat, Message, MessageReplyReference } from '@/lib/mock-data';

export const MESSAGE_TEXT_MAX_CHARS = 2_000;
export const MESSAGE_REPLY_TEXT_MAX_CHARS = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toTrimmedString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const truncateReplyText = (value: string) =>
  value.length > MESSAGE_REPLY_TEXT_MAX_CHARS
    ? `${value.slice(0, MESSAGE_REPLY_TEXT_MAX_CHARS - 3).trimEnd()}...`
    : value;

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

export const normalizeMessageReplyReference = (value: unknown): MessageReplyReference | null => {
  if (!isRecord(value)) return null;

  const id = toTrimmedString(value.id);
  const sender = normalizeMessageActor(toTrimmedString(value.sender));
  const text = truncateReplyText(toTrimmedString(value.text));
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : '';

  if (!id || !sender || !text || !timestamp) {
    return null;
  }

  return {
    id,
    sender,
    text,
    timestamp,
  };
};

export const normalizeMessage = (value: unknown): Message | null => {
  if (!isRecord(value)) return null;

  const id = toTrimmedString(value.id);
  const sender = normalizeMessageActor(toTrimmedString(value.sender));
  const text = toTrimmedString(value.text);
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : '';
  const readBy = normalizeStringList(value.readBy, { lowercase: true });
  const replyTo = normalizeMessageReplyReference(value.replyTo);
  const editedAt = typeof value.editedAt === 'string' ? value.editedAt : '';

  if (!sender && !text && !timestamp && readBy.length === 0) {
    return null;
  }

  return {
    ...(id ? { id } : {}),
    sender,
    text,
    timestamp,
    readBy,
    ...(replyTo ? { replyTo } : {}),
    ...(editedAt ? { editedAt } : {}),
  };
};

export const getMessageEntityId = (
  message: Message | Pick<Message, 'id' | 'sender' | 'text' | 'timestamp'> | null | undefined
) => {
  const id = toTrimmedString(message?.id);
  if (id) {
    return id;
  }

  const sender = normalizeMessageActor(message?.sender);
  const text = toTrimmedString(message?.text);
  const timestamp = typeof message?.timestamp === 'string' ? message.timestamp : '';
  if (!sender || !text || !timestamp) return '';
  return `${sender}:${timestamp}:${text}`;
};

export const getMessageKey = (
  message: Pick<Message, 'sender' | 'text' | 'timestamp'> | null | undefined
) => {
  const sender = normalizeMessageActor(message?.sender);
  const text = toTrimmedString(message?.text);
  const timestamp = typeof message?.timestamp === 'string' ? message.timestamp : '';
  if (!sender || !text || !timestamp) return '';
  return `${sender}__${timestamp}__${text}`;
};

const getMessageTimelineKey = (
  message: Pick<Message, 'sender' | 'timestamp'> | null | undefined
) => {
  const sender = normalizeMessageActor(message?.sender);
  const timestamp = typeof message?.timestamp === 'string' ? message.timestamp : '';
  if (!sender || !timestamp) return '';
  return `${sender}__${timestamp}`;
};

export const createMessageReplyReference = (message: Message): MessageReplyReference | null => {
  const id = getMessageEntityId(message);
  const sender = normalizeMessageActor(message.sender);
  const text = truncateReplyText(toTrimmedString(message.text));
  const timestamp = typeof message.timestamp === 'string' ? message.timestamp : '';

  if (!id || !sender || !text || !timestamp) {
    return null;
  }

  return {
    id,
    sender,
    text,
    timestamp,
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

export const mergeMessageLists = (currentMessages: unknown, incomingMessages: unknown): Message[] =>
  normalizeMessageList(incomingMessages).reduce(
    (messages, message) => upsertMessageInList(messages, message),
    normalizeMessageList(currentMessages)
  );

export const mergeMessageMaps = (
  currentMessagesByConversation: unknown,
  incomingMessagesByConversation: unknown
) => {
  const currentMessages = normalizeMessageMap(currentMessagesByConversation);
  const incomingMessages = normalizeMessageMap(incomingMessagesByConversation);
  const merged: Record<string, Message[]> = {};

  Array.from(new Set([...Object.keys(currentMessages), ...Object.keys(incomingMessages)])).forEach(
    conversationKey => {
      merged[conversationKey] = mergeMessageLists(
        currentMessages[conversationKey],
        incomingMessages[conversationKey]
      );
    }
  );

  return merged;
};

export const mergeGroupChatLists = (currentGroupChats: unknown, incomingGroupChats: unknown) => {
  const currentChats = normalizeGroupChats(currentGroupChats);
  const incomingChats = normalizeGroupChats(incomingGroupChats);
  const currentById = new Map(currentChats.map(chat => [chat.id, chat] as const));
  const incomingById = new Map(incomingChats.map(chat => [chat.id, chat] as const));
  const orderedIds = Array.from(
    new Set([...incomingChats.map(chat => chat.id), ...currentChats.map(chat => chat.id)])
  );

  return orderedIds.map(chatId => {
    const currentChat = currentById.get(chatId);
    const incomingChat = incomingById.get(chatId);

    return {
      id: chatId,
      name: incomingChat?.name || currentChat?.name || 'Group chat',
      members: normalizeStringList(
        [...(currentChat?.members ?? []), ...(incomingChat?.members ?? [])],
        { lowercase: true }
      ),
      messages: mergeMessageLists(currentChat?.messages, incomingChat?.messages),
    };
  });
};

const compareMessages = (left: Message, right: Message) => {
  const leftTime = getMessageTimestampMs(left);
  const rightTime = getMessageTimestampMs(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return getMessageKey(left).localeCompare(getMessageKey(right));
};

const replyReferencesEqual = (
  left: MessageReplyReference | null | undefined,
  right: MessageReplyReference | null | undefined
) => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.sender === right.sender &&
    left.text === right.text &&
    left.timestamp === right.timestamp
  );
};

export const upsertMessageInList = (messages: unknown, incoming: unknown): Message[] => {
  const normalizedMessages = normalizeMessageList(messages);
  const nextMessage = normalizeMessage(incoming);
  if (!nextMessage) {
    return normalizedMessages;
  }

  const nextKey = getMessageKey(nextMessage);
  const nextId = toTrimmedString(nextMessage.id);
  const nextTimelineKey = getMessageTimelineKey(nextMessage);
  let existingIndex = nextId
    ? normalizedMessages.findIndex(message => toTrimmedString(message.id) === nextId)
    : -1;
  if (existingIndex === -1 && nextKey) {
    existingIndex = normalizedMessages.findIndex(message => getMessageKey(message) === nextKey);
  }
  if (existingIndex === -1 && nextTimelineKey) {
    existingIndex = normalizedMessages.findIndex(message => getMessageTimelineKey(message) === nextTimelineKey);
  }

  if (existingIndex === -1) {
    return [...normalizedMessages, nextMessage].sort(compareMessages);
  }

  const existing = normalizedMessages[existingIndex];
  const mergedReadBy = normalizeStringList(
    [...existing.readBy, ...nextMessage.readBy],
    { lowercase: true }
  );
  const mergedMessage: Message = {
    ...existing,
    ...nextMessage,
    readBy: mergedReadBy,
  };

  if (
    existing.id === mergedMessage.id &&
    existing.sender === mergedMessage.sender &&
    existing.text === mergedMessage.text &&
    existing.timestamp === mergedMessage.timestamp &&
    existing.editedAt === mergedMessage.editedAt &&
    replyReferencesEqual(existing.replyTo, mergedMessage.replyTo) &&
    existing.readBy.length === mergedMessage.readBy.length &&
    existing.readBy.every((value, index) => value === mergedMessage.readBy[index])
  ) {
    return normalizedMessages;
  }

  return normalizedMessages.map((message, index) =>
    index === existingIndex ? mergedMessage : message
  );
};

export const upsertConversationMessage = (
  messagesByConversation: unknown,
  conversationKey: string,
  incoming: unknown
) => {
  const normalizedConversationKey = normalizeMessageActor(conversationKey);
  const normalizedMessages = normalizeMessageMap(messagesByConversation);
  if (!normalizedConversationKey) {
    return normalizedMessages;
  }

  const currentMessages = normalizedMessages[normalizedConversationKey] ?? [];
  const nextMessages = upsertMessageInList(currentMessages, incoming);
  if (nextMessages === currentMessages) {
    return normalizedMessages;
  }

  return {
    ...normalizedMessages,
    [normalizedConversationKey]: nextMessages,
  };
};

export const replaceMessageInList = (
  messages: unknown,
  messageEntityId: string,
  replacement: unknown
): Message[] => {
  const normalizedMessages = normalizeMessageList(messages);
  const normalizedReplacement = normalizeMessage(replacement);
  const normalizedMessageEntityId = toTrimmedString(messageEntityId);
  if (!normalizedMessageEntityId || !normalizedReplacement) {
    return normalizedMessages;
  }

  let changed = false;
  const nextMessages = normalizedMessages.map(message => {
    if (getMessageEntityId(message) !== normalizedMessageEntityId) {
      return message;
    }
    changed = true;
    return normalizedReplacement;
  });

  return changed ? nextMessages.sort(compareMessages) : normalizedMessages;
};

export const replaceConversationMessage = (
  messagesByConversation: unknown,
  conversationKey: string,
  messageEntityId: string,
  replacement: unknown
) => {
  const normalizedConversationKey = normalizeMessageActor(conversationKey);
  const normalizedMessages = normalizeMessageMap(messagesByConversation);
  if (!normalizedConversationKey) {
    return normalizedMessages;
  }

  const currentMessages = normalizedMessages[normalizedConversationKey] ?? [];
  const nextMessages = replaceMessageInList(currentMessages, messageEntityId, replacement);
  if (nextMessages === currentMessages) {
    return normalizedMessages;
  }

  return {
    ...normalizedMessages,
    [normalizedConversationKey]: nextMessages,
  };
};

export const replaceGroupChatMessage = (
  groupChats: unknown,
  chatId: string,
  messageEntityId: string,
  replacement: unknown
) => {
  const normalizedGroupChats = normalizeGroupChats(groupChats);
  const normalizedChatId = toTrimmedString(chatId);
  if (!normalizedChatId) {
    return normalizedGroupChats;
  }

  let changed = false;
  const nextGroupChats = normalizedGroupChats.map(chat => {
    if (chat.id !== normalizedChatId) {
      return chat;
    }

    const nextMessages = replaceMessageInList(chat.messages, messageEntityId, replacement);
    if (nextMessages === chat.messages) {
      return chat;
    }

    changed = true;
    return {
      ...chat,
      messages: nextMessages,
    };
  });

  return changed ? nextGroupChats : normalizedGroupChats;
};

export const upsertGroupChatMessage = (
  groupChats: unknown,
  chatId: string,
  incoming: unknown
) => {
  const normalizedGroupChats = normalizeGroupChats(groupChats);
  if (!chatId) {
    return normalizedGroupChats;
  }

  let changed = false;
  const nextGroupChats = normalizedGroupChats.map(chat => {
    if (chat.id !== chatId) {
      return chat;
    }

    const nextMessages = upsertMessageInList(chat.messages, incoming);
    if (nextMessages === chat.messages) {
      return chat;
    }

    changed = true;
    return {
      ...chat,
      messages: nextMessages,
    };
  });

  return changed ? nextGroupChats : normalizedGroupChats;
};

export const removeConversationMessages = (
  messagesByConversation: unknown,
  conversationKey: string,
  messageEntityIds: Iterable<string>
) => {
  const normalizedConversationKey = normalizeMessageActor(conversationKey);
  const normalizedMessages = normalizeMessageMap(messagesByConversation);
  if (!normalizedConversationKey) {
    return normalizedMessages;
  }

  const idsToDelete = new Set(
    Array.from(messageEntityIds, value => toTrimmedString(value)).filter(Boolean)
  );
  if (idsToDelete.size === 0) {
    return normalizedMessages;
  }

  const currentMessages = normalizedMessages[normalizedConversationKey] ?? [];
  const nextMessages = currentMessages.filter(message => !idsToDelete.has(getMessageEntityId(message)));
  if (nextMessages.length === currentMessages.length) {
    return normalizedMessages;
  }

  if (nextMessages.length === 0) {
    const { [normalizedConversationKey]: _deleted, ...rest } = normalizedMessages;
    return rest;
  }

  return {
    ...normalizedMessages,
    [normalizedConversationKey]: nextMessages,
  };
};

export const clearConversationMessages = (
  messagesByConversation: unknown,
  conversationKey: string
) => {
  const normalizedConversationKey = normalizeMessageActor(conversationKey);
  const normalizedMessages = normalizeMessageMap(messagesByConversation);
  if (!normalizedConversationKey || !(normalizedConversationKey in normalizedMessages)) {
    return normalizedMessages;
  }

  const { [normalizedConversationKey]: _deleted, ...rest } = normalizedMessages;
  return rest;
};

export const removeGroupChatMessages = (
  groupChats: unknown,
  chatId: string,
  messageEntityIds: Iterable<string>
) => {
  const normalizedGroupChats = normalizeGroupChats(groupChats);
  const normalizedChatId = toTrimmedString(chatId);
  if (!normalizedChatId) {
    return normalizedGroupChats;
  }

  const idsToDelete = new Set(
    Array.from(messageEntityIds, value => toTrimmedString(value)).filter(Boolean)
  );
  if (idsToDelete.size === 0) {
    return normalizedGroupChats;
  }

  let changed = false;
  const nextGroupChats = normalizedGroupChats.map(chat => {
    if (chat.id !== normalizedChatId) {
      return chat;
    }

    const nextMessages = chat.messages.filter(message => !idsToDelete.has(getMessageEntityId(message)));
    if (nextMessages.length === chat.messages.length) {
      return chat;
    }

    changed = true;
    return {
      ...chat,
      messages: nextMessages,
    };
  });

  return changed ? nextGroupChats : normalizedGroupChats;
};

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
