import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUtcDayKey } from '@/lib/day-key';
import { err } from '@/lib/result';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';

export async function POST() {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const ipLimiter = rateLimit(`ai-refresh-insights:ip:${ip}`, 20, 60_000);
  if (!ipLimiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many AI requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(ipLimiter) }
    );
  }

  const cookieStore = await cookies();
  const orgId = cookieStore.get('selectedOrgId')?.value;
  if (!orgId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Missing organization.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`ai-refresh-insights:user:${userId}`, 10, 60_000);
  if (!userLimiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many AI requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(userLimiter) }
    );
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Not a member.', source: 'app' }),
      { status: 403 }
    );
  }

  const admin = createSupabaseAdmin();
  const [{ data: plan }, { data: sub }] = await Promise.all([
    admin
      .from('org_billing_plans')
      .select('daily_credit_per_user')
      .eq('org_id', orgId)
      .maybeSingle(),
    admin
      .from('org_subscriptions')
      .select('status')
      .eq('org_id', orgId)
      .maybeSingle(),
  ]);

  const status = sub?.status ?? 'inactive';
  if (!['active', 'trialing'].includes(status)) {
    return NextResponse.json(
      err({
        code: 'BILLING_INACTIVE',
        message: 'Billing inactive. In-app purchase access is not active for this organization.',
        source: 'app',
      }),
      { status: 402 }
    );
  }

  const dailyLimit = plan?.daily_credit_per_user ?? 0;
  const usageDate = getUtcDayKey();
  const { data: result } = await admin.rpc('increment_daily_credits', {
    p_org_id: orgId,
    p_user_id: userId,
    p_usage_date: usageDate,
    p_increment_by: 1,
    p_daily_limit: dailyLimit,
  });
  const success = Array.isArray(result) ? result[0]?.success : result?.success;
  const newValue = Array.isArray(result) ? result[0]?.new_value : result?.new_value;
  if (!success) {
    return NextResponse.json(
      err({
        code: 'DAILY_LIMIT_REACHED',
        message: 'Daily limit reached.',
        source: 'ai',
      }),
      { status: 429 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      usedToday: Number(newValue ?? 0),
      remaining: Math.max(0, dailyLimit - Number(newValue ?? 0)),
    },
  });
}
