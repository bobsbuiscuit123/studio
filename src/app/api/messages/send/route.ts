import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { createMessage } from '@/lib/assistant/agent/message-service';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

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

const toErrorCode = (message: string) => {
  if (
    message === 'Recipient is not in this group.' ||
    message === 'Conversation not found.' ||
    message === 'You are not in this conversation.'
  ) {
    return 'VALIDATION' as const;
  }

  if (message === 'Access denied.' || message === 'Unauthorized.') {
    return 'VALIDATION' as const;
  }

  return 'NETWORK_HTTP_ERROR' as const;
};

const toStatus = (message: string) => {
  if (message === 'Unauthorized.') return 401;
  if (message === 'Access denied.' || message === 'You are not in this conversation.') return 403;
  if (message === 'Recipient is not in this group.' || message === 'Conversation not found.') return 404;
  if (message === 'Invalid message payload.') return 400;
  return 500;
};

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

  try {
    const result =
      parsed.data.conversationType === 'dm'
        ? await createMessage({
            mode: 'conversation',
            conversationType: 'dm',
            userId: actingUser.id,
            userEmail: actingUser.email,
            orgId: parsed.data.orgId,
            groupId: parsed.data.groupId,
            partnerEmail: parsed.data.partnerEmail,
            clientTimestamp: parsed.data.clientTimestamp,
            body: parsed.data.text,
          })
        : await createMessage({
            mode: 'conversation',
            conversationType: 'group',
            userId: actingUser.id,
            userEmail: actingUser.email,
            orgId: parsed.data.orgId,
            groupId: parsed.data.groupId,
            chatId: parsed.data.chatId,
            clientTimestamp: parsed.data.clientTimestamp,
            body: parsed.data.text,
          });

    return NextResponse.json({ ok: true, data: { message: result.record } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send message.';
    return NextResponse.json(
      err({ code: toErrorCode(message), message, source: 'app' }),
      { status: toStatus(message) }
    );
  }
}
