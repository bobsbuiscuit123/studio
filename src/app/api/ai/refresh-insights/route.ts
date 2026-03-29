import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRequestDayKey } from '@/lib/day-key';
import { getEffectiveOrgAiAllowance, parseOptionalPositiveInt } from '@/lib/org-settings';
import { err } from '@/lib/result';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';

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

  const admin = createSupabaseAdmin();
  const refreshResponse = await admin.rpc('refresh_org_subscription_period', {
    p_org_id: orgId,
  });
  if (refreshResponse.error) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: refreshResponse.error.message,
        source: 'network',
      }),
      { status: 500 }
    );
  }

  const { data: orgRow, error: orgError } = await admin
    .from('orgs')
    .select('*')
    .eq('id', orgId)
    .maybeSingle();

  if (orgError) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: orgError.message,
        source: 'network',
      }),
      { status: 500 }
    );
  }

  if (!orgRow) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization not found.', source: 'app' }),
      { status: 404 }
    );
  }

  const aiTokenLimitOverride = parseOptionalPositiveInt(
    (orgRow as Record<string, unknown>).ai_token_limit_override
  );
  if (aiTokenLimitOverride) {
    const effectiveAllowance = getEffectiveOrgAiAllowance({
      monthlyTokenLimit: Number(orgRow.monthly_token_limit ?? 0),
      bonusTokensThisPeriod: Number(orgRow.bonus_tokens_this_period ?? 0),
      aiTokenLimitOverride,
    });
    const usedThisPeriod = Number(orgRow.tokens_used_this_period ?? 0);
    if (usedThisPeriod >= effectiveAllowance) {
      return NextResponse.json(
        err({
          code: 'AI_CREDITS_DEPLETED',
          message: 'AI is unavailable for this organization right now.',
          source: 'app',
        }),
        { status: 402 }
      );
    }
  }

  const usageDate = getRequestDayKey(request);
  const { data: result, error: consumeError } = await admin.rpc('consume_org_subscription_token', {
    p_org_id: orgId,
    p_user_id: userId,
    p_usage_date: usageDate,
  });

  const consumeResult = Array.isArray(result) ? result[0] : result;

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

  const reason = String(consumeResult?.reason ?? '');
  const usedThisPeriod = Number(consumeResult?.tokens_used_this_period ?? 0);
  const remainingTokens = Number(consumeResult?.effective_available_tokens ?? 0);

  if (!consumeResult?.success) {
    if (reason === 'not_member') {
      return NextResponse.json(
        err({ code: 'VALIDATION', message: 'Not a member.', source: 'app' }),
        { status: 403 }
      );
    }

    return NextResponse.json(
      err({
        code: 'AI_CREDITS_DEPLETED',
        message: 'AI is unavailable for this organization right now.',
        source: 'app',
      }),
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      usedThisPeriod,
      remaining: remainingTokens,
      remainingTokens,
      tokenCost: 1,
    },
  });
}
