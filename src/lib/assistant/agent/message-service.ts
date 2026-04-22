import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import type { Message } from '@/lib/mock-data';
import { sendPushToUsers } from '@/lib/send-push';
import type { RecipientRef } from '@/lib/assistant/agent/types';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const getConversationId = (email1: string, email2: string) => [email1, email2].sort().join('_');

const getMessagePreview = (value: string) =>
  value.length > 120 ? `${value.slice(0, 117).trimEnd()}...` : value;

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
  message: {
    sender: string;
    text: string;
    timestamp: string;
    readBy: string[];
  };
}) =>
  JSON.stringify({
    version: 1,
    conversationType,
    conversationKey,
    chatId,
    message,
  });

type BaseInput = {
  userId: string;
  userEmail: string;
  orgId: string;
  groupId: string;
  body: string;
  clientTimestamp?: string;
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
    updatedChats[chatIndex] = {
      ...chat,
      messages: [...(Array.isArray(chat.messages) ? chat.messages : []), message],
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
