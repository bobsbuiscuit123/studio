import { NextResponse } from 'next/server';
import { z } from 'zod';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import {
  isGroupAdminRole,
  removeGroupStateMember,
  updateGroupStateMemberRole,
} from '@/lib/group-permissions';

const schema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  transferAdminUserId: z.string().uuid().optional(),
}).strict();

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const limiter = rateLimit(`group-leave:${ip}`, 20, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(limiter) }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid request.', source: 'app' }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  const userEmail = userData.user?.email || '';
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401, headers: getRateLimitHeaders(limiter) }
    );
  }

  const userLimiter = rateLimit(`group-leave-user:${userId}`, 30, 60_000);
  if (!userLimiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(userLimiter) }
    );
  }

  const admin = createSupabaseAdmin();
  const { data: membership } = await admin
    .from('group_memberships')
    .select('group_id, role')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Not a group member.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: groupStateRow } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', parsed.data.groupId)
    .maybeSingle();
  if (!groupStateRow?.data) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: 'Group state missing.', source: 'network' }),
      { status: 404, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: groupMembers } = await admin
    .from('group_memberships')
    .select('user_id, role')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId);

  const adminCount = (groupMembers || []).filter((member) => isGroupAdminRole(member.role)).length;
  if (isGroupAdminRole(membership.role) && adminCount <= 1 && !parsed.data.transferAdminUserId) {
    return NextResponse.json(
      err({
        code: 'ADMIN_REQUIRED',
        message: 'Assign another admin or delete the group before leaving.',
        source: 'app',
      }),
      { status: 409, headers: getRateLimitHeaders(limiter) }
    );
  }

  if (parsed.data.transferAdminUserId) {
    if (parsed.data.transferAdminUserId === userId) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Invalid transfer target.', source: 'app' }),
        { status: 400, headers: getRateLimitHeaders(limiter) }
      );
    }
    const targetMembership = (groupMembers || []).find(
      (member) => member.user_id === parsed.data.transferAdminUserId
    );
    if (!targetMembership) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Transfer target not in group.', source: 'app' }),
        { status: 400, headers: getRateLimitHeaders(limiter) }
      );
    }
    await admin
      .from('group_memberships')
      .update({ role: 'admin' })
      .eq('org_id', parsed.data.orgId)
      .eq('group_id', parsed.data.groupId)
      .eq('user_id', parsed.data.transferAdminUserId);
  }

  let nextState = groupStateRow.data as Record<string, unknown>;
  if (parsed.data.transferAdminUserId) {
    nextState = updateGroupStateMemberRole(
      nextState,
      parsed.data.transferAdminUserId,
      'admin'
    ) as Record<string, unknown>;
  }
  nextState = removeGroupStateMember(nextState, userId, userEmail) as Record<string, unknown>;

  await admin
    .from('group_state')
    .update({ data: nextState })
    .eq('group_id', parsed.data.groupId);

  await admin
    .from('group_memberships')
    .delete()
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', userId);

  return NextResponse.json({ ok: true }, { headers: getRateLimitHeaders(limiter) });
}
