import { NextResponse } from 'next/server';
import { z } from 'zod';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { isGroupAdminRole } from '@/lib/group-permissions';

const schema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
}).strict();

type DeleteResult = {
  error: { message: string; code?: string } | null;
};

const isIgnorableDeleteError = (result: DeleteResult) =>
  result.error?.code === '42P01' ||
  result.error?.code === 'PGRST205' ||
  result.error?.message.toLowerCase().includes('does not exist') ||
  result.error?.message.toLowerCase().includes('schema cache');

export async function POST(request: Request) {
  try {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`group-delete:${ip}`, 10, 60_000);
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
    if (!userId) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
        { status: 401, headers: getRateLimitHeaders(limiter) }
      );
    }

    const userLimiter = rateLimit(`group-delete-user:${userId}`, 15, 60_000);
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
    const { data: membership, error: membershipError } = await admin
      .from('group_memberships')
      .select('role')
      .eq('org_id', parsed.data.orgId)
      .eq('group_id', parsed.data.groupId)
      .eq('user_id', userId)
      .maybeSingle();
    if (membershipError) {
      console.error('[group-delete] membership lookup failed', membershipError);
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: membershipError.message, source: 'network' }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }
    if (!membership || !isGroupAdminRole(membership.role)) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Admins only.', source: 'app' }),
        { status: 403, headers: getRateLimitHeaders(limiter) }
      );
    }

    const deleteSteps = [
      ['group_user_state', () => admin.from('group_user_state').delete().eq('org_id', parsed.data.orgId).eq('group_id', parsed.data.groupId)],
      ['group_state', () => admin.from('group_state').delete().eq('group_id', parsed.data.groupId)],
      ['messages', () => admin.from('messages').delete().eq('org_id', parsed.data.orgId).eq('group_id', parsed.data.groupId)],
      ['announcements', () => admin.from('announcements').delete().eq('org_id', parsed.data.orgId).eq('group_id', parsed.data.groupId)],
    ] as const;

    for (const [name, executeDelete] of deleteSteps) {
      const result = await executeDelete();
      if (result.error) {
        if (!isIgnorableDeleteError(result)) {
          console.warn('[group-delete] cleanup warning', name, result.error);
        }
      }
    }

    const { data: deletedGroup, error: deleteGroupError } = await admin
      .from('groups')
      .delete()
      .select('id')
      .eq('org_id', parsed.data.orgId)
      .eq('id', parsed.data.groupId)
      .maybeSingle();
    if (deleteGroupError) {
      console.error('[group-delete] groups delete failed', deleteGroupError);
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: `groups: ${deleteGroupError.message}`,
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }
    if (!deletedGroup) {
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: 'groups: no group row was deleted.',
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    const { data: remainingGroup, error: verifyError } = await admin
      .from('groups')
      .select('id')
      .eq('id', parsed.data.groupId)
      .maybeSingle();
    if (verifyError) {
      console.error('[group-delete] verify failed', verifyError);
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: `verify: ${verifyError.message}`,
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }
    if (remainingGroup) {
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: 'verify: group delete did not complete.',
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    return NextResponse.json({ ok: true }, { headers: getRateLimitHeaders(limiter) });
  } catch (error) {
    console.error('[group-delete] unexpected failure', error);
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: error instanceof Error ? error.message : 'Unexpected delete failure.',
        source: 'network',
      }),
      { status: 500 }
    );
  }
}
