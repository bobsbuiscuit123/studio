import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { sendPushToUsers } from '@/lib/send-push';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const schema = z.discriminatedUnion('conversationType', [
  z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    conversationType: z.literal('dm'),
    partnerEmail: z.string().trim().email().max(320),
    clientTimestamp: z.string().trim().max(64).optional(),
    text: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    conversationType: z.literal('group'),
    chatId: z.string().trim().min(1).max(200),
    clientTimestamp: z.string().trim().max(64).optional(),
    text: z.string().trim().min(1).max(500),
  }).strict(),
]);

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

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`messages-send:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter, 'Too many messages sent too quickly. Please slow down.');
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid message payload.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const actingUser = userData.user;
  if (!actingUser?.id || !actingUser.email) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`messages-send-user:${actingUser.id}`, 60, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter, 'Too many messages sent too quickly. Please slow down.');
  }

  const admin = createSupabaseAdmin();
  const normalizedActorEmail = normalizeEmail(actingUser.email);
  const membershipQuery = await admin
    .from('group_memberships')
    .select('user_id')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', actingUser.id)
    .maybeSingle();

  if (!membershipQuery.data) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403 }
    );
  }

  const { data: stateRow, error: stateError } = await admin
    .from('group_state')
    .select('data')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .maybeSingle();

  if (stateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: stateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const currentData = ((stateRow?.data as Record<string, unknown> | null) ?? {}) as Record<string, any>;
  const nextData = { ...currentData };
  const newMessage = {
    sender: actingUser.email,
    text: parsed.data.text,
    timestamp: resolveMessageTimestamp(parsed.data.clientTimestamp),
    readBy: [actingUser.email],
  };

  const violation = findPolicyViolation(newMessage);
  if (violation) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: policyErrorMessage, source: 'app' }),
      { status: 400 }
    );
  }

  let pushJob: Parameters<typeof sendPushToUsers>[0] | null = null;
  let messageAuditContent = '';

  if (parsed.data.conversationType === 'dm') {
    const partnerEmail = normalizeEmail(parsed.data.partnerEmail);
    const members = Array.isArray(currentData.members) ? currentData.members : [];
    const partnerIsMember = members.some(
      member => typeof member?.email === 'string' && normalizeEmail(member.email) === partnerEmail
    );
    if (!partnerIsMember) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Recipient is not in this group.', source: 'app' }),
        { status: 404 }
      );
    }

    const conversationKey = getConversationId(normalizedActorEmail, partnerEmail);
    const existingMessages = currentData.messages && typeof currentData.messages === 'object'
      ? currentData.messages
      : {};
    nextData.messages = {
      ...existingMessages,
      [conversationKey]: [...(Array.isArray(existingMessages[conversationKey]) ? existingMessages[conversationKey] : []), newMessage],
    };
    messageAuditContent = buildMessageAuditEnvelope({
      conversationType: 'dm',
      conversationKey,
      message: newMessage,
    });

    let recipientIds: string[] = [];
    try {
      recipientIds = await resolveGroupMemberUserIdsByEmails({
        admin,
        orgId: parsed.data.orgId,
        groupId: parsed.data.groupId,
        emails: [partnerEmail],
        excludeUserId: actingUser.id,
      });
    } catch (profilesError) {
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: profilesError instanceof Error ? profilesError.message : 'Failed to resolve push recipient.',
          source: 'network',
        }),
        { status: 500 }
      );
    }
    if (recipientIds.length > 0) {
      const threadId = `dm__${encodeURIComponent(normalizedActorEmail)}`;
      pushJob = {
        userIds: recipientIds,
        title: 'New message',
        body: getMessagePreview(parsed.data.text),
        route: `/messages/${threadId}`,
        params: { threadId },
        type: 'message',
        entityId: threadId,
      };
    }
  } else {
    const chatId = parsed.data.chatId;
    const groupChats = Array.isArray(currentData.groupChats) ? currentData.groupChats : [];
    const chatIndex = groupChats.findIndex(chat => chat && typeof chat === 'object' && chat.id === chatId);
    if (chatIndex === -1) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Conversation not found.', source: 'app' }),
        { status: 404 }
      );
    }

    const chat = groupChats[chatIndex];
    const memberEmails = Array.isArray(chat.members)
      ? chat.members
          .map((member: unknown) => (typeof member === 'string' ? normalizeEmail(member) : ''))
          .filter(Boolean)
      : [];
    if (!memberEmails.includes(normalizedActorEmail)) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'You are not in this conversation.', source: 'app' }),
        { status: 403 }
      );
    }

    const updatedChats = [...groupChats];
    updatedChats[chatIndex] = {
      ...chat,
      messages: [...(Array.isArray(chat.messages) ? chat.messages : []), newMessage],
    };
    nextData.groupChats = updatedChats;
    messageAuditContent = buildMessageAuditEnvelope({
      conversationType: 'group',
      chatId,
      message: newMessage,
    });

    const recipientEmails = memberEmails.filter((email: string) => email !== normalizedActorEmail);
    if (recipientEmails.length > 0) {
      let recipientIds: string[] = [];
      try {
        recipientIds = await resolveGroupMemberUserIdsByEmails({
          admin,
          orgId: parsed.data.orgId,
          groupId: parsed.data.groupId,
          emails: recipientEmails,
          excludeUserId: actingUser.id,
        });
      } catch (profilesError) {
        return NextResponse.json(
          err({
            code: 'NETWORK_HTTP_ERROR',
            message: profilesError instanceof Error ? profilesError.message : 'Failed to resolve push recipients.',
            source: 'network',
          }),
          { status: 500 }
        );
      }

      if (recipientIds.length > 0) {
        const threadId = `group__${encodeURIComponent(chatId)}`;
        pushJob = {
          userIds: recipientIds,
          title: 'New message',
          body: getMessagePreview(parsed.data.text),
          route: `/messages/${threadId}`,
          params: { threadId },
          type: 'message',
          entityId: threadId,
        };
      }
    }
  }

  const { error: upsertError } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: parsed.data.orgId,
        group_id: parsed.data.groupId,
        data: nextData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );

  if (upsertError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: upsertError.message, source: 'network' }),
      { status: 500 }
    );
  }

  if (messageAuditContent) {
    const { error: auditInsertError } = await admin.from('messages').insert({
      org_id: parsed.data.orgId,
      group_id: parsed.data.groupId,
      sender_id: actingUser.id,
      content: messageAuditContent,
      created_at: newMessage.timestamp,
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

  return NextResponse.json({ ok: true, data: { message: newMessage } });
}
