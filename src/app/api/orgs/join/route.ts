import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';

export async function POST(request: Request) {
  try {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`org-join:${ip}`, 15, 60_000);
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
      joinCode: z.string().min(3),
    });
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
    const userLimiter = rateLimit(`org-join-user:${userId}`, 10, 60_000);
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
    const joinCode = parsed.data.joinCode.toUpperCase();
    const { data: orgRow } = await admin
      .from('orgs')
      .select('id, member_cap')
      .eq('join_code', joinCode)
      .maybeSingle();
    if (!orgRow?.id) {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Organization not found.', source: 'app' }),
        { status: 404, headers: getRateLimitHeaders(limiter) }
      );
    }

    const maxUserLimit = Number(orgRow.member_cap ?? 0);
    const { count } = await admin
      .from('memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', orgRow.id);
    if (maxUserLimit > 0 && (count ?? 0) >= maxUserLimit) {
      return NextResponse.json(
        err({ code: 'ORG_FULL', message: 'Organization is at capacity.', source: 'app' }),
        { status: 409, headers: getRateLimitHeaders(limiter) }
      );
    }

    const { error: insertError } = await admin
      .from('memberships')
      .insert({ org_id: orgRow.id, user_id: userId, role: 'member' });
    if (insertError && insertError.code !== '23505') {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: insertError.message, source: 'network' }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    return NextResponse.json(
      { ok: true, orgId: orgRow.id },
      { headers: getRateLimitHeaders(limiter) }
    );
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Join failed.';
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message, source: 'network' }),
      { status: 500 }
    );
  }
}
