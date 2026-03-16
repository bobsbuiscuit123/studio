import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { canEditGroupContent, canManageGroupRoles, normalizeGroupRole } from '@/lib/group-permissions';

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const limiter = rateLimit(`org-state:${ip}`, 60, 60_000);
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
    groupId: z.string().uuid(),
    data: z.record(z.any()),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Invalid org payload.',
        source: 'app',
      }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const violation = findPolicyViolation(parsed.data.data);
  if (violation) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: policyErrorMessage,
        source: 'app',
        detail: `${violation.path}:${violation.match}`,
      }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401, headers: getRateLimitHeaders(limiter) }
    );
  }
  const userLimiter = rateLimit(`org-state-user:${userData.user.id}`, 120, 60_000);
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

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const admin = createSupabaseAdmin();
  const { data: existingState } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', parsed.data.groupId)
    .maybeSingle();

  const currentData = (existingState?.data ?? {}) as Record<string, any>;
  const nextData = parsed.data.data as Record<string, any>;
  const groupRole = normalizeGroupRole(membership.role);
  const currentMembers = JSON.stringify(Array.isArray(currentData.members) ? currentData.members : []);
  const nextMembers = JSON.stringify(Array.isArray(nextData.members) ? nextData.members : []);
  if (currentMembers !== nextMembers && !canManageGroupRoles(groupRole)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only group admins can manage member roles.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const contentKeys = ['announcements', 'events'];
  const contentChanged = contentKeys.some(
    (key) => JSON.stringify(currentData[key] ?? null) !== JSON.stringify(nextData[key] ?? null)
  );
  if (contentChanged && !canEditGroupContent(groupRole)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only group admins or officers can change announcements or events.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { error } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: parsed.data.orgId,
        group_id: parsed.data.groupId,
        data: parsed.data.data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );
  if (error) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: error.message,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  return NextResponse.json({ ok: true }, { headers: getRateLimitHeaders(limiter) });
}
