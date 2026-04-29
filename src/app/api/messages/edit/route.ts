import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { updateMessageContent } from '@/lib/assistant/agent/message-service';
import { MESSAGE_TEXT_MAX_CHARS } from '@/lib/message-state';
import { rateLimit } from '@/lib/rate-limit';
import { err } from '@/lib/result';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const messageEntityIdSchema = z.string().trim().min(1).max(MESSAGE_TEXT_MAX_CHARS + 400);

const schema = z.discriminatedUnion('conversationType', [
  z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    conversationType: z.literal('dm'),
    partnerEmail: z.string().trim().email().max(320),
    messageEntityId: messageEntityIdSchema,
    text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX_CHARS),
  }).strict(),
  z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    conversationType: z.literal('group'),
    chatId: z.string().trim().min(1).max(200),
    messageEntityId: messageEntityIdSchema,
    text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX_CHARS),
  }).strict(),
]);

const toErrorCode = (message: string) => {
  if (
    message === 'Access denied.' ||
    message === 'Unauthorized.' ||
    message === 'Conversation not found.' ||
    message === 'Message not found.' ||
    message === 'You are not in this conversation.' ||
    message === 'You can only edit your own messages.' ||
    message === 'Invalid message payload.'
  ) {
    return 'VALIDATION' as const;
  }

  return 'NETWORK_HTTP_ERROR' as const;
};

const toStatus = (message: string) => {
  if (message === 'Unauthorized.') return 401;
  if (
    message === 'Access denied.' ||
    message === 'You are not in this conversation.' ||
    message === 'You can only edit your own messages.'
  ) {
    return 403;
  }
  if (message === 'Conversation not found.' || message === 'Message not found.') return 404;
  if (message === 'Invalid message payload.') return 400;
  return 500;
};

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`messages-edit:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter, 'Too many edit requests. Please slow down.');
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

  const userLimiter = rateLimit(`messages-edit-user:${actingUser.id}`, 60, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter, 'Too many edit requests. Please slow down.');
  }

  try {
    const result =
      parsed.data.conversationType === 'dm'
        ? await updateMessageContent({
            conversationType: 'dm',
            userId: actingUser.id,
            userEmail: actingUser.email,
            orgId: parsed.data.orgId,
            groupId: parsed.data.groupId,
            partnerEmail: parsed.data.partnerEmail,
            messageEntityId: parsed.data.messageEntityId,
            body: parsed.data.text,
          })
        : await updateMessageContent({
            conversationType: 'group',
            userId: actingUser.id,
            userEmail: actingUser.email,
            orgId: parsed.data.orgId,
            groupId: parsed.data.groupId,
            chatId: parsed.data.chatId,
            messageEntityId: parsed.data.messageEntityId,
            body: parsed.data.text,
          });

    return NextResponse.json({ ok: true, data: { message: result.record } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to edit message.';
    return NextResponse.json(
      err({ code: toErrorCode(message), message, source: 'app' }),
      { status: toStatus(message) }
    );
  }
}
