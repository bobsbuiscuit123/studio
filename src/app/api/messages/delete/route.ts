import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { deleteMessageContent } from '@/lib/assistant/agent/message-service';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

const messageEntityIdsSchema = z.array(z.string().trim().min(1)).min(1).max(100);

const schema = z.union([
  z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    deleteMode: z.literal('messages'),
    conversationType: z.literal('dm'),
    partnerEmail: z.string().trim().email().max(320),
    messageEntityIds: messageEntityIdsSchema,
  }).strict(),
  z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    deleteMode: z.literal('messages'),
    conversationType: z.literal('group'),
    chatId: z.string().trim().min(1).max(200),
    messageEntityIds: messageEntityIdsSchema,
  }).strict(),
  z.object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    deleteMode: z.literal('conversation'),
    conversationType: z.literal('dm'),
    partnerEmail: z.string().trim().email().max(320),
  }).strict(),
]);

const toErrorCode = (message: string) => {
  if (
    message === 'Conversation not found.' ||
    message === 'You are not in this conversation.' ||
    message === 'Access denied.' ||
    message === 'Unauthorized.'
  ) {
    return 'VALIDATION' as const;
  }

  return 'NETWORK_HTTP_ERROR' as const;
};

const toStatus = (message: string) => {
  if (message === 'Unauthorized.') return 401;
  if (message === 'Access denied.' || message === 'You are not in this conversation.') return 403;
  if (message === 'Conversation not found.') return 404;
  if (message === 'Invalid delete payload.') return 400;
  return 500;
};

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`messages-delete:${getRequestIp(request.headers)}`, 20, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter, 'Too many delete requests. Please slow down.');
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid delete payload.', source: 'app' }),
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

  const userLimiter = rateLimit(`messages-delete-user:${actingUser.id}`, 40, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter, 'Too many delete requests. Please slow down.');
  }

  try {
    const result =
      parsed.data.deleteMode === 'conversation'
        ? await deleteMessageContent({
            mode: 'conversation',
            conversationType: 'dm',
            userId: actingUser.id,
            userEmail: actingUser.email,
            orgId: parsed.data.orgId,
            groupId: parsed.data.groupId,
            partnerEmail: parsed.data.partnerEmail,
          })
        : parsed.data.conversationType === 'dm'
          ? await deleteMessageContent({
              mode: 'messages',
              conversationType: 'dm',
              userId: actingUser.id,
              userEmail: actingUser.email,
              orgId: parsed.data.orgId,
              groupId: parsed.data.groupId,
              partnerEmail: parsed.data.partnerEmail,
              messageEntityIds: parsed.data.messageEntityIds,
            })
          : await deleteMessageContent({
              mode: 'messages',
              conversationType: 'group',
              userId: actingUser.id,
              userEmail: actingUser.email,
              orgId: parsed.data.orgId,
              groupId: parsed.data.groupId,
              chatId: parsed.data.chatId,
              messageEntityIds: parsed.data.messageEntityIds,
            });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete messages.';
    return NextResponse.json(
      err({ code: toErrorCode(message), message, source: 'app' }),
      { status: toStatus(message) }
    );
  }
}
