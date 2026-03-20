import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { getDefaultOrgState } from '@/lib/org-state';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { displayGroupRole } from '@/lib/group-permissions';

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const limiter = rateLimit(`group-create:${ip}`, 10, 60_000);
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
    name: z.string().min(3),
    description: z.string().optional(),
    joinCode: z.string().min(4),
    logo: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Invalid group payload.',
        source: 'app',
      }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const contentViolation =
    findPolicyViolation(parsed.data.name) || findPolicyViolation(parsed.data.description ?? '');
  if (contentViolation) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: policyErrorMessage,
        source: 'app',
      }),
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

  const admin = createSupabaseAdmin();
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('org_id', parsed.data.orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data, error } = await admin
    .from('groups')
    .insert({
      org_id: parsed.data.orgId,
      name: parsed.data.name,
      created_by: userId,
      description: parsed.data.description ?? '',
      join_code: parsed.data.joinCode,
    })
    .select('id,join_code')
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const groupId = data?.id;
  if (!groupId) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: 'Failed to create group.', source: 'network' }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('email, display_name')
    .eq('id', userId)
    .maybeSingle();
  const displayName = profile?.display_name || profile?.email || 'Member';
  const defaults = getDefaultOrgState();
  const initialMembers = [
    {
      id: userId,
      name: displayName,
      email: profile?.email || '',
      role: displayGroupRole('admin'),
      avatar: `https://placehold.co/100x100.png?text=${displayName.charAt(0)}`,
    },
  ];
  const membershipInsert = await admin
    .from('group_memberships')
    .insert({ org_id: parsed.data.orgId, group_id: groupId, user_id: userId, role: 'admin' });
  if (membershipInsert.error) {
    await admin.from('groups').delete().eq('id', groupId);
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: `Group was created but membership setup failed: ${membershipInsert.error.message}`,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }
  const stateInsert = await admin
    .from('group_state')
    .insert({
      org_id: parsed.data.orgId,
      group_id: groupId,
      data: {
        ...defaults,
        members: initialMembers,
        logo: parsed.data.logo ?? '',
      },
    });
  if (stateInsert.error) {
    await admin.from('group_memberships').delete().eq('group_id', groupId);
    await admin.from('groups').delete().eq('id', groupId);
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: `Group was created but initial state setup failed: ${stateInsert.error.message}`,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      groupId,
      joinCode: data?.join_code ?? parsed.data.joinCode,
    },
    { headers: getRateLimitHeaders(limiter) }
  );
}
