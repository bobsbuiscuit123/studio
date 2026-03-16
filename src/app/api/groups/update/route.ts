import { NextResponse } from 'next/server';
import { z } from 'zod';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';

export async function PATCH(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const limiter = rateLimit(`group-update:${ip}`, 30, 60_000);
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
    name: z.string().min(3),
    description: z.string().optional(),
    logo: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid group update payload.', source: 'app' }),
      { status: 400, headers: getRateLimitHeaders(limiter) }
    );
  }

  const violation =
    findPolicyViolation(parsed.data.name) || findPolicyViolation(parsed.data.description ?? '');
  if (violation) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: policyErrorMessage, source: 'app' }),
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

  const { data: membership } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only group admins can edit this group.', source: 'app' }),
      { status: 403, headers: getRateLimitHeaders(limiter) }
    );
  }

  const admin = createSupabaseAdmin();
  const groupUpdate = await admin
    .from('groups')
    .update({
      name: parsed.data.name.trim(),
      description: (parsed.data.description ?? '').trim(),
    })
    .eq('id', parsed.data.groupId)
    .eq('org_id', parsed.data.orgId);
  if (groupUpdate.error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: groupUpdate.error.message, source: 'network' }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: stateRow, error: stateError } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', parsed.data.groupId)
    .eq('org_id', parsed.data.orgId)
    .maybeSingle();
  if (stateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: stateError.message, source: 'network' }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const nextData = {
    ...((stateRow?.data as Record<string, unknown> | null) ?? {}),
    logo: parsed.data.logo ?? '',
  };
  const stateUpdate = await admin
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
  if (stateUpdate.error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: stateUpdate.error.message, source: 'network' }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        groupId: parsed.data.groupId,
        name: parsed.data.name.trim(),
        description: (parsed.data.description ?? '').trim(),
        logo: parsed.data.logo ?? '',
      },
    },
    { headers: getRateLimitHeaders(limiter) }
  );
}
