import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import type { Message } from '@/lib/mock-data';
import {
  getMessageEntityId,
  getMessageLegacyEntityId,
  normalizeMessage,
  normalizeMessageReplyReference,
} from '@/lib/message-state';
import { sendPushToUsers } from '@/lib/send-push';
import type { RecipientRef } from '@/lib/assistant/agent/types';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const getConversationId = (email1: string, email2: string) => [email1, email2].sort().join('_');

const getMessagePreview = (value: string) =>
  value.length > 120 ? `${value.slice(0, 117).trimEnd()}...` : value;

const normalizeMessageEntityIds = (values: string[]) =>
  Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));

const resolveConversationReplyReference = (
  replyTo: Message['replyTo'] | null | undefined,
  messages: unknown,
  normalizedActorEmail: string
) => {
  const requestedReplyTo = normalizeMessageReplyReference(replyTo);
  if (!requestedReplyTo) {
    return null;
  }

  const targetMessage = (Array.isArray(messages) ? messages : [])
    .map(message => normalizeMessage(message))
    .find((message): message is Message =>
      Boolean(message) && getMessageEntityId(message) === requestedReplyTo.id
    );

  if (!targetMessage) {
    throw new Error('Reply target not found.');
  }

  if (normalizeEmail(targetMessage.sender) === normalizedActorEmail) {
    throw new Error('Reply target must be from someone else.');
  }

  return normalizeMessageReplyReference({
    id: getMessageEntityId(targetMessage),
    sender: targetMessage.sender,
    text: targetMessage.text,
    timestamp: targetMessage.timestamp,
  });
};

const findMessageIndexByEntityId = (messages: unknown[], messageEntityId: string) =>
  messages.findIndex(message => {
    const normalizedMessage = normalizeMessage(message);
    return (
      getMessageEntityId(normalizedMessage) === messageEntityId ||
      getMessageLegacyEntityId(normalizedMessage) === messageEntityId
    );
  });

const updateMessageAuditRow = async ({
  admin,
  orgId,
  groupId,
  conversationType,
  conversationKey,
  chatId,
  previousMessageEntityId,
  message,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  orgId: string;
  groupId: string;
  conversationType: 'dm' | 'group';
  conversationKey?: string;
  chatId?: string;
  previousMessageEntityId: string;
  message: Message;
}) => {
  const { data: auditRows, error: auditRowsError } = await admin
    .from('messages')
    .select('id, content')
    .eq('org_id', orgId)
    .eq('group_id', groupId);

  if (auditRowsError) {
    throw new Error(auditRowsError.message);
  }

  const matchingAuditId = (auditRows ?? []).find(row => {
    const parsedContent = parseMessageAuditContent(row.content);
    if (!parsedContent || parsedContent.conversationType !== conversationType) {
      return false;
    }
    if (conversationType === 'dm' && parsedContent.conversationKey !== conversationKey) {
      return false;
    }
    if (conversationType === 'group' && parsedContent.chatId !== chatId) {
      return false;
    }
    return getMessageEntityId(parsedContent.message) === previousMessageEntityId;
  })?.id;

  if (typeof matchingAuditId !== 'string' || !matchingAuditId) {
    return;
  }

  const { error: updateAuditError } = await admin
    .from('messages')
    .update({
      content: buildMessageAuditEnvelope({
        conversationType,
        conversationKey,
        chatId,
        message,
      }),
    })
    .eq('id', matchingAuditId);

  if (updateAuditError) {
    throw new Error(updateAuditError.message);
  }
};

const resolveMessageTimestamp = (value?: string) => {
  if (!value) {
    return new Date().toISOString();
  }
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return new Date().toISOString();
  }
  return new Date(timestampMs).toISOString();
};

const resolveGroupMemberUserIdsByEmails = async ({
  admin,
  orgId,
  groupId,
  emails,
  excludeUserId,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  orgId: string;
  groupId: string;
  emails: string[];
  excludeUserId?: string;
}) => {
  const normalizedEmails = Array.from(
    new Set(emails.map(email => normalizeEmail(email)).filter(Boolean))
  );
  if (normalizedEmails.length === 0) {
    return [];
  }

  const { data: memberships, error: membershipsError } = await admin
    .from('group_memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('group_id', groupId);

  if (membershipsError) {
    throw membershipsError;
  }

  const candidateUserIds = Array.from(
    new Set(
      (memberships ?? [])
        .map(row => row.user_id)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0 && value !== excludeUserId
        )
    )
  );
  if (candidateUserIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', candidateUserIds);

  if (profilesError) {
    throw profilesError;
  }

  return Array.from(
    new Set(
      (profiles ?? [])
        .filter(profile => {
          const email = typeof profile.email === 'string' ? normalizeEmail(profile.email) : '';
          return Boolean(email) && normalizedEmails.includes(email);
        })
        .map(profile => profile.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );
};

const buildMessageAuditEnvelope = ({
  conversationType,
  conversationKey,
  chatId,
  message,
}: {
  conversationType: 'dm' | 'group';
  conversationKey?: string;
  chatId?: string;
  message: Message;
}) =>
  JSON.stringify({
    version: 1,
    conversationType,
    conversationKey,
    chatId,
    message,
  });

const loadAuthorizedGroupState = async ({
  admin,
  orgId,
  groupId,
  userId,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  orgId: string;
  groupId: string;
  userId: string;
}) => {
  const { data: membership, error: membershipError } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }
  if (!membership) {
    throw new Error('Access denied.');
  }

  const { data: stateRow, error: stateError } = await admin
    .from('group_state')
    .select('data')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .maybeSingle();

  if (stateError) {
    throw new Error(stateError.message);
  }

  return ((stateRow?.data as Record<string, unknown> | null) ?? {}) as Record<string, any>;
};

const parseMessageAuditContent = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as {
      conversationType?: 'dm' | 'group';
      conversationKey?: string;
      chatId?: string;
      message?: Message;
    };
  } catch {
    return null;
  }
};

const purgeMessageAuditRows = async ({
  admin,
  orgId,
  groupId,
  conversationType,
  conversationKey,
  chatId,
  messageEntityIds,
  clearConversation = false,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  orgId: string;
  groupId: string;
  conversationType: 'dm' | 'group';
  conversationKey?: string;
  chatId?: string;
  messageEntityIds?: string[];
  clearConversation?: boolean;
}) => {
  const { data: auditRows, error: auditRowsError } = await admin
    .from('messages')
    .select('id, content')
    .eq('org_id', orgId)
    .eq('group_id', groupId);

  if (auditRowsError) {
    throw new Error(auditRowsError.message);
  }

  const idsToDelete = new Set(messageEntityIds ?? []);
  const matchingAuditIds = (auditRows ?? []).flatMap(row => {
    const rowId = typeof row.id === 'string' ? row.id : '';
    if (!rowId) {
      return [];
    }

    const parsedContent = parseMessageAuditContent(row.content);
    if (!parsedContent || parsedContent.conversationType !== conversationType) {
      return [];
    }

    if (conversationType === 'dm' && parsedContent.conversationKey !== conversationKey) {
      return [];
    }

    if (conversationType === 'group' && parsedContent.chatId !== chatId) {
      return [];
    }

    if (clearConversation) {
      return [rowId];
    }

    const messageEntityId = getMessageEntityId(parsedContent.message);
    return idsToDelete.has(messageEntityId) ? [rowId] : [];
  });

  if (matchingAuditIds.length === 0) {
    return;
  }

  const { error: deleteAuditError } = await admin
    .from('messages')
    .delete()
    .in('id', matchingAuditIds);

  if (deleteAuditError) {
    throw new Error(deleteAuditError.message);
  }
};

type BaseInput = {
  userId: string;
  userEmail: string;
  orgId: string;
  groupId: string;
  body: string;
  clientTimestamp?: string;
  replyTo?: Message['replyTo'];
};

type CreateMessageInput =
  | (BaseInput & {
      mode: 'recipients';
      recipients: RecipientRef[];
    })
  | (BaseInput & {
      mode: 'conversation';
      conversationType: 'dm';
      partnerEmail: string;
    })
  | (BaseInput & {
      mode: 'conversation';
      conversationType: 'group';
      chatId: string;
    });

type DeleteMessageInput =
  | {
      mode: 'messages';
      conversationType: 'dm';
      userId: string;
      userEmail: string;
      orgId: string;
      groupId: string;
      partnerEmail: string;
      messageEntityIds: string[];
    }
  | {
      mode: 'messages';
      conversationType: 'group';
      userId: string;
      userEmail: string;
      orgId: string;
      groupId: string;
      chatId: string;
      messageEntityIds: string[];
    }
  | {
      mode: 'conversation';
      conversationType: 'dm';
      userId: string;
      userEmail: string;
      orgId: string;
      groupId: string;
      partnerEmail: string;
    };

type UpdateMessageInput =
  | {
      conversationType: 'dm';
      userId: string;
      userEmail: string;
      orgId: string;
      groupId: string;
      partnerEmail: string;
      messageEntityId: string;
      body: string;
    }
  | {
      conversationType: 'group';
      userId: string;
      userEmail: string;
      orgId: string;
      groupId: string;
      chatId: string;
      messageEntityId: string;
      body: string;
    };

export async function createMessage(input: CreateMessageInput) {
  const admin = createSupabaseAdmin();
  const { data: membership, error: membershipError } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', input.orgId)
    .eq('group_id', input.groupId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }
  if (!membership) {
    throw new Error('Access denied.');
  }

  const { data: stateRow, error: stateError } = await admin
    .from('group_state')
    .select('data')
    .eq('org_id', input.orgId)
    .eq('group_id', input.groupId)
    .maybeSingle();

  if (stateError) {
    throw new Error(stateError.message);
  }

  const normalizedActorEmail = normalizeEmail(input.userEmail);
  const currentData = ((stateRow?.data as Record<string, unknown> | null) ?? {}) as Record<string, any>;
  const members = Array.isArray(currentData.members) ? currentData.members : [];
  const nextData = { ...currentData };
  const message: Message = {
    id: crypto.randomUUID(),
    sender: input.userEmail,
    text: input.body.trim(),
    timestamp: resolveMessageTimestamp(input.clientTimestamp),
    readBy: [input.userEmail],
  };

  const violation = findPolicyViolation(message);
  if (violation) {
    throw new Error(policyErrorMessage);
  }

  let auditContent = '';
  let threadId = message.id ?? message.timestamp;
  let pushJob: Parameters<typeof sendPushToUsers>[0] | null = null;

  if (input.mode === 'conversation' && input.conversationType === 'dm') {
    const partnerEmail = normalizeEmail(input.partnerEmail);
    const partnerIsMember = members.some(
      member => typeof member?.email === 'string' && normalizeEmail(member.email) === partnerEmail
    );
    if (!partnerIsMember) {
      throw new Error('Recipient is not in this group.');
    }

    const conversationKey = getConversationId(normalizedActorEmail, partnerEmail);
    const existingMessages =
      nextData.messages && typeof nextData.messages === 'object' ? nextData.messages : {};
    const currentConversationMessages = Array.isArray(existingMessages[conversationKey])
      ? existingMessages[conversationKey]
      : [];
    const replyTo = resolveConversationReplyReference(
      input.replyTo,
      currentConversationMessages,
      normalizedActorEmail
    );
    if (replyTo) {
      message.replyTo = replyTo;
    }
    nextData.messages = {
      ...existingMessages,
      [conversationKey]: [
        ...currentConversationMessages,
        message,
      ],
    };
    auditContent = buildMessageAuditEnvelope({
      conversationType: 'dm',
      conversationKey,
      message,
    });

    const recipientIds = await resolveGroupMemberUserIdsByEmails({
      admin,
      orgId: input.orgId,
      groupId: input.groupId,
      emails: [partnerEmail],
      excludeUserId: input.userId,
    });
    threadId = `dm__${encodeURIComponent(normalizedActorEmail)}`;

    if (recipientIds.length > 0) {
      pushJob = {
        userIds: recipientIds,
        title: 'New message',
        body: getMessagePreview(input.body),
        route: `/messages/${threadId}`,
        params: { threadId },
        type: 'message',
        entityId: threadId,
      };
    }
  } else if (input.mode === 'conversation' && input.conversationType === 'group') {
    const groupChats = Array.isArray(currentData.groupChats) ? currentData.groupChats : [];
    const chatIndex = groupChats.findIndex(chat => chat && typeof chat === 'object' && chat.id === input.chatId);
    if (chatIndex === -1) {
      throw new Error('Conversation not found.');
    }

    const chat = groupChats[chatIndex];
    const memberEmails = Array.isArray(chat.members)
      ? chat.members
          .map((member: unknown) => (typeof member === 'string' ? normalizeEmail(member) : ''))
          .filter(Boolean)
      : [];
    if (!memberEmails.includes(normalizedActorEmail)) {
      throw new Error('You are not in this conversation.');
    }

    const updatedChats = [...groupChats];
    const currentConversationMessages = Array.isArray(chat.messages) ? chat.messages : [];
    const replyTo = resolveConversationReplyReference(
      input.replyTo,
      currentConversationMessages,
      normalizedActorEmail
    );
    if (replyTo) {
      message.replyTo = replyTo;
    }
    updatedChats[chatIndex] = {
      ...chat,
      messages: [...currentConversationMessages, message],
    };
    nextData.groupChats = updatedChats;
    auditContent = buildMessageAuditEnvelope({
      conversationType: 'group',
      chatId: input.chatId,
      message,
    });

    const recipientEmails = memberEmails.filter((email: string) => email !== normalizedActorEmail);
    const recipientIds = await resolveGroupMemberUserIdsByEmails({
      admin,
      orgId: input.orgId,
      groupId: input.groupId,
      emails: recipientEmails,
      excludeUserId: input.userId,
    });
    threadId = `group__${encodeURIComponent(input.chatId)}`;

    if (recipientIds.length > 0) {
      pushJob = {
        userIds: recipientIds,
        title: 'New message',
        body: getMessagePreview(input.body),
        route: `/messages/${threadId}`,
        params: { threadId },
        type: 'message',
        entityId: threadId,
      };
    }
  } else {
    const normalizedRecipients = input.recipients.map(recipient => normalizeEmail(recipient.email));
    const invalidRecipient = normalizedRecipients.find(email =>
      !members.some(member => normalizeEmail(String(member?.email ?? '')) === email)
    );
    if (invalidRecipient) {
      throw new Error('Recipient is not in this group.');
    }

    if (normalizedRecipients.length === 1) {
      const conversationKey = getConversationId(normalizedActorEmail, normalizedRecipients[0]);
      const existingMessages =
        nextData.messages && typeof nextData.messages === 'object' ? nextData.messages : {};
      nextData.messages = {
        ...existingMessages,
        [conversationKey]: [
          ...(Array.isArray(existingMessages[conversationKey]) ? existingMessages[conversationKey] : []),
          message,
        ],
      };
      auditContent = buildMessageAuditEnvelope({
        conversationType: 'dm',
        conversationKey,
        message,
      });
      threadId = `dm__${encodeURIComponent(normalizedActorEmail)}`;
    } else {
      const groupChats = Array.isArray(nextData.groupChats) ? nextData.groupChats : [];
      const chatId = crypto.randomUUID();
      nextData.groupChats = [
        ...groupChats,
        {
          id: chatId,
          name: `Assistant message ${new Date().toLocaleTimeString()}`,
          members: [normalizedActorEmail, ...normalizedRecipients],
          messages: [message],
        },
      ];
      auditContent = buildMessageAuditEnvelope({
        conversationType: 'group',
        chatId,
        message,
      });
      threadId = `group__${encodeURIComponent(chatId)}`;
    }

    const recipientIds = await resolveGroupMemberUserIdsByEmails({
      admin,
      orgId: input.orgId,
      groupId: input.groupId,
      emails: normalizedRecipients,
      excludeUserId: input.userId,
    });

    if (recipientIds.length > 0) {
      pushJob = {
        userIds: recipientIds,
        title: 'New message',
        body: getMessagePreview(input.body),
        route: `/messages/${threadId}`,
        params: { threadId },
        type: 'message',
        entityId: threadId,
      };
    }
  }

  const { error } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: input.orgId,
        group_id: input.groupId,
        data: nextData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );

  if (error) {
    throw new Error(error.message);
  }

  if (auditContent) {
    const { error: auditInsertError } = await admin.from('messages').insert({
      org_id: input.orgId,
      group_id: input.groupId,
      sender_id: input.userId,
      content: auditContent,
      created_at: message.timestamp,
    });
    if (auditInsertError) {
      console.error('Message audit insert failed', auditInsertError);
    }
  }

  if (pushJob) {
    void sendPushToUsers(pushJob).catch(error => {
      console.error('Message push failed', error);
    });
  }

  return {
    entityId: threadId,
    entityType: 'message' as const,
    message: 'Message sent successfully.',
    record: message,
  };
}

export async function deleteMessageContent(input: DeleteMessageInput) {
  const admin = createSupabaseAdmin();
  const currentData = await loadAuthorizedGroupState({
    admin,
    orgId: input.orgId,
    groupId: input.groupId,
    userId: input.userId,
  });
  const normalizedActorEmail = normalizeEmail(input.userEmail);
  const nextData = { ...currentData };

  let deletedMessageEntityIds: string[] = [];
  let conversationDeleted = false;

  if (input.conversationType === 'dm') {
    const conversationKey = getConversationId(normalizedActorEmail, normalizeEmail(input.partnerEmail));
    const currentMessages =
      currentData.messages && typeof currentData.messages === 'object'
        ? (currentData.messages as Record<string, unknown>)
        : {};
    const existingMessages = Array.isArray(currentMessages[conversationKey])
      ? (currentMessages[conversationKey] as Message[])
      : [];
    const nextMessages = { ...currentMessages };

    if (input.mode === 'conversation') {
      deletedMessageEntityIds = existingMessages.map(message => getMessageEntityId(message)).filter(Boolean);
      delete nextMessages[conversationKey];
      nextData.messages = nextMessages;
      conversationDeleted = true;
    } else {
      const idsToDelete = new Set(normalizeMessageEntityIds(input.messageEntityIds));
      const keptMessages = existingMessages.filter(message => !idsToDelete.has(getMessageEntityId(message)));
      deletedMessageEntityIds = existingMessages
        .filter(message => idsToDelete.has(getMessageEntityId(message)))
        .map(message => getMessageEntityId(message))
        .filter(Boolean);

      if (deletedMessageEntityIds.length === 0) {
        return { deletedCount: 0, deletedMessageEntityIds: [], conversationDeleted: false };
      }

      if (keptMessages.length === 0) {
        delete nextMessages[conversationKey];
      } else {
        nextMessages[conversationKey] = keptMessages;
      }
      nextData.messages = nextMessages;
    }

    const { error } = await admin
      .from('group_state')
      .upsert(
        {
          org_id: input.orgId,
          group_id: input.groupId,
          data: nextData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'group_id' }
      );

    if (error) {
      throw new Error(error.message);
    }

    try {
      await purgeMessageAuditRows({
        admin,
        orgId: input.orgId,
        groupId: input.groupId,
        conversationType: 'dm',
        conversationKey,
        messageEntityIds: deletedMessageEntityIds,
        clearConversation: input.mode === 'conversation',
      });
    } catch (error) {
      console.error('Message audit purge failed', error);
    }

    return {
      deletedCount: deletedMessageEntityIds.length,
      deletedMessageEntityIds,
      conversationDeleted,
    };
  }

  const groupChats = Array.isArray(currentData.groupChats) ? currentData.groupChats : [];
  const chatIndex = groupChats.findIndex(chat => chat && typeof chat === 'object' && chat.id === input.chatId);
  if (chatIndex === -1) {
    throw new Error('Conversation not found.');
  }

  const chat = groupChats[chatIndex];
  const memberEmails = Array.isArray(chat.members)
    ? chat.members
        .map((member: unknown) => (typeof member === 'string' ? normalizeEmail(member) : ''))
        .filter(Boolean)
    : [];
  if (!memberEmails.includes(normalizedActorEmail)) {
    throw new Error('You are not in this conversation.');
  }

  const existingMessages = Array.isArray(chat.messages) ? (chat.messages as Message[]) : [];
  const idsToDelete = new Set(normalizeMessageEntityIds(input.messageEntityIds));
  const keptMessages = existingMessages.filter(message => !idsToDelete.has(getMessageEntityId(message)));
  deletedMessageEntityIds = existingMessages
    .filter(message => idsToDelete.has(getMessageEntityId(message)))
    .map(message => getMessageEntityId(message))
    .filter(Boolean);

  if (deletedMessageEntityIds.length === 0) {
    return { deletedCount: 0, deletedMessageEntityIds: [], conversationDeleted: false };
  }

  const updatedChats = [...groupChats];
  updatedChats[chatIndex] = {
    ...chat,
    messages: keptMessages,
  };
  nextData.groupChats = updatedChats;

  const { error } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: input.orgId,
        group_id: input.groupId,
        data: nextData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );

  if (error) {
    throw new Error(error.message);
  }

  try {
    await purgeMessageAuditRows({
      admin,
      orgId: input.orgId,
      groupId: input.groupId,
      conversationType: 'group',
      chatId: input.chatId,
      messageEntityIds: deletedMessageEntityIds,
    });
  } catch (error) {
    console.error('Message audit purge failed', error);
  }

  return {
    deletedCount: deletedMessageEntityIds.length,
    deletedMessageEntityIds,
    conversationDeleted: false,
  };
}

export async function updateMessageContent(input: UpdateMessageInput) {
  const admin = createSupabaseAdmin();
  const currentData = await loadAuthorizedGroupState({
    admin,
    orgId: input.orgId,
    groupId: input.groupId,
    userId: input.userId,
  });
  const normalizedActorEmail = normalizeEmail(input.userEmail);
  const normalizedMessageEntityId = input.messageEntityId.trim();
  const nextText = input.body.trim();
  if (!normalizedMessageEntityId || !nextText) {
    throw new Error('Invalid message payload.');
  }

  const violation = findPolicyViolation(nextText);
  if (violation) {
    throw new Error(policyErrorMessage);
  }

  const nextData = { ...currentData };
  const editedAt = new Date().toISOString();
  let updatedMessage: Message | null = null;
  let previousMessageEntityId = normalizedMessageEntityId;
  let conversationKey: string | undefined;
  let chatId: string | undefined;

  if (input.conversationType === 'dm') {
    conversationKey = getConversationId(normalizedActorEmail, normalizeEmail(input.partnerEmail));
    const currentMessages =
      currentData.messages && typeof currentData.messages === 'object'
        ? (currentData.messages as Record<string, unknown>)
        : {};
    const existingMessages = Array.isArray(currentMessages[conversationKey])
      ? (currentMessages[conversationKey] as unknown[])
      : [];
    const messageIndex = findMessageIndexByEntityId(existingMessages, normalizedMessageEntityId);
    if (messageIndex === -1) {
      throw new Error('Message not found.');
    }

    const existingMessage = normalizeMessage(existingMessages[messageIndex]);
    if (!existingMessage) {
      throw new Error('Message not found.');
    }
    if (normalizeEmail(existingMessage.sender) !== normalizedActorEmail) {
      throw new Error('You can only edit your own messages.');
    }

    previousMessageEntityId = getMessageEntityId(existingMessage);
    updatedMessage = {
      ...existingMessage,
      id: existingMessage.id || crypto.randomUUID(),
      text: nextText,
      editedAt,
    };

    nextData.messages = {
      ...currentMessages,
      [conversationKey]: existingMessages.map((message, index) =>
        index === messageIndex ? updatedMessage : message
      ),
    };
  } else {
    const groupChats = Array.isArray(currentData.groupChats) ? currentData.groupChats : [];
    const chatIndex = groupChats.findIndex(chat => chat && typeof chat === 'object' && chat.id === input.chatId);
    if (chatIndex === -1) {
      throw new Error('Conversation not found.');
    }

    const chat = groupChats[chatIndex];
    const memberEmails = Array.isArray(chat.members)
      ? chat.members
          .map((member: unknown) => (typeof member === 'string' ? normalizeEmail(member) : ''))
          .filter(Boolean)
      : [];
    if (!memberEmails.includes(normalizedActorEmail)) {
      throw new Error('You are not in this conversation.');
    }

    const existingMessages = Array.isArray(chat.messages) ? (chat.messages as unknown[]) : [];
    const messageIndex = findMessageIndexByEntityId(existingMessages, normalizedMessageEntityId);
    if (messageIndex === -1) {
      throw new Error('Message not found.');
    }

    const existingMessage = normalizeMessage(existingMessages[messageIndex]);
    if (!existingMessage) {
      throw new Error('Message not found.');
    }
    if (normalizeEmail(existingMessage.sender) !== normalizedActorEmail) {
      throw new Error('You can only edit your own messages.');
    }

    previousMessageEntityId = getMessageEntityId(existingMessage);
    updatedMessage = {
      ...existingMessage,
      id: existingMessage.id || crypto.randomUUID(),
      text: nextText,
      editedAt,
    };
    chatId = input.chatId;

    const updatedChats = [...groupChats];
    updatedChats[chatIndex] = {
      ...chat,
      messages: existingMessages.map((message, index) =>
        index === messageIndex ? updatedMessage : message
      ),
    };
    nextData.groupChats = updatedChats;
  }

  const { error } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: input.orgId,
        group_id: input.groupId,
        data: nextData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );

  if (error) {
    throw new Error(error.message);
  }

  if (updatedMessage) {
    try {
      await updateMessageAuditRow({
        admin,
        orgId: input.orgId,
        groupId: input.groupId,
        conversationType: input.conversationType,
        conversationKey,
        chatId,
        previousMessageEntityId,
        message: updatedMessage,
      });
    } catch (error) {
      console.error('Message audit update failed', error);
    }
  }

  return {
    entityId: input.conversationType === 'dm'
      ? `dm__${encodeURIComponent(normalizedActorEmail)}`
      : `group__${encodeURIComponent(input.chatId)}`,
    entityType: 'message' as const,
    message: 'Message updated successfully.',
    record: updatedMessage,
  };
}
