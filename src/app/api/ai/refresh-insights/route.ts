import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRequestDayKey } from '@/lib/day-key';
import { err } from '@/lib/result';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { calculateCreditCostPerRequest } from '@/lib/pricing';

export async function POST(request: Request) {
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
  const { data: org } = await admin
    .from('orgs')
    .select('member_limit, ai_daily_limit_per_user, credit_balance')
    .eq('id', orgId)
    .maybeSingle();

  const memberLimit = Number(org?.member_limit ?? 0);
  const dailyLimit = Number(org?.ai_daily_limit_per_user ?? 0);
  const creditBalance = Number(org?.credit_balance ?? 0);
  const creditCost = calculateCreditCostPerRequest(memberLimit);

  if (dailyLimit <= 0) {
    return NextResponse.json(
      err({
        code: 'DAILY_LIMIT_REACHED',
        message: 'Daily limit reached.',
        source: 'ai',
      }),
      { status: 429 }
    );
  }

  if (creditBalance <= 0 || creditBalance < creditCost) {
    return NextResponse.json(
      err({
        code: 'AI_CREDITS_DEPLETED',
        message: 'AI temporarily unavailable. Your organization has run out of credits.',
        source: 'app',
      }),
      { status: 402 }
    );
  }

  const usageDate = getRequestDayKey(request);
  const { data: result, error: consumeError } = await admin.rpc('consume_org_ai_credit', {
    p_org_id: orgId,
    p_user_id: userId,
    p_usage_date: usageDate,
    p_daily_limit: dailyLimit,
    p_credit_cost: creditCost,
  });

  if (consumeError) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: consumeError.message,
        source: 'network',
      }),
      { status: 500 }
    );
  }

  const consumeResult = Array.isArray(result) ? result[0] : result;
  const reason = String(consumeResult?.reason ?? '');
  const usedToday = Number(consumeResult?.new_request_count ?? 0);
  const remainingBalance = Number(consumeResult?.remaining_balance ?? 0);

  if (!consumeResult?.success) {
    if (reason === 'daily_limit_reached') {
      return NextResponse.json(
        err({
          code: 'DAILY_LIMIT_REACHED',
          message: 'Daily limit reached.',
          source: 'ai',
        }),
        { status: 429 }
      );
    }

    return NextResponse.json(
      err({
        code: 'AI_CREDITS_DEPLETED',
        message: 'AI temporarily unavailable. Your organization has run out of credits.',
        source: 'app',
      }),
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      usedToday,
      remaining: Math.max(0, dailyLimit - usedToday),
      remainingBalance,
      creditCost,
    },
  });
}
