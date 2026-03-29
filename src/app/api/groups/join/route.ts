import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { displayGroupRole } from '@/lib/group-permissions';

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const limiter = rateLimit(`group-join:${ip}`, 15, 60_000);
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
  const schema = z.object({
    orgId: z.string().uuid(),
    joinCode: z.string().min(4),
  }).strict();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid join code.', source: 'app' }),
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
  const userLimiter = rateLimit(`group-join-user:${userId}`, 20, 60_000);
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
    .from('memberships')
    .select('role')
    .eq('org_id', parsed.data.orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Join an organization first.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }
  const { data: groupRow, error: groupError } = await admin
    .from('groups')
    .select('id')
    .eq('org_id', parsed.data.orgId)
    .eq('join_code', parsed.data.joinCode.toUpperCase())
    .maybeSingle();
  if (groupError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: groupError.message, source: 'network' }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }
  if (!groupRow?.id) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid join code.', source: 'app' }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { error: membershipError } = await admin
    .from('group_memberships')
    .upsert(
      { org_id: parsed.data.orgId, group_id: groupRow.id, user_id: userId, role: 'member' },
      { onConflict: 'user_id,group_id' }
    );
  if (membershipError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: membershipError.message, source: 'network' }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('email, display_name')
    .eq('id', userId)
    .maybeSingle();
  const displayName = profile?.display_name || profile?.email || 'Member';
  const { data: groupStateRow } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', groupRow.id)
    .maybeSingle();
  if (groupStateRow?.data) {
    const data = groupStateRow.data as { members?: Array<any> };
    const members = Array.isArray(data.members) ? data.members : [];
    const exists = members.some((member) => member?.id === userId || member?.email === profile?.email);
    if (!exists) {
      const nextMembers = [
        ...members,
        {
          id: userId,
          name: displayName,
          email: profile?.email || '',
          role: displayGroupRole('member'),
          avatar: getPlaceholderImageUrl({ label: displayName.charAt(0) }),
        },
      ];
      await admin
        .from('group_state')
        .update({ data: { ...data, members: nextMembers } })
        .eq('group_id', groupRow.id);
    }
  }

  return NextResponse.json({ ok: true, groupId: groupRow.id }, { headers: getRateLimitHeaders(limiter) });
}
