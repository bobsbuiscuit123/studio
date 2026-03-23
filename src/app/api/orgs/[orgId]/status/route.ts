import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { getRequestDayKey } from '@/lib/day-key';
import { isMissingColumnError, isMissingFunctionError, readBalance } from '@/lib/org-balance';
import {
  calculateDailyTokenEstimate,
  calculateEstimatedDaysRemaining,
  calculateMonthlyTokenEstimate,
  getAiAvailability,
  getTokenHealth,
} from '@/lib/pricing';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const parsed = z.string().uuid().safeParse(orgId);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid org id.', source: 'app' }),
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

  const admin = createSupabaseAdmin();
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('org_id', parsed.data)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Not a member.', source: 'app' }),
      { status: 403 }
    );
  }

  const [
    orgResponse,
    { count },
    { data: usage },
    statsResponse,
  ] = await Promise.all([
    admin
      .from('orgs')
      .select('name, join_code, owner_id, member_cap, daily_ai_limit, token_balance, created_at, updated_at')
      .eq('id', parsed.data)
      .maybeSingle(),
    admin
      .from('memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', parsed.data),
    admin
      .from('org_usage_daily')
      .select('request_count')
      .eq('org_id', parsed.data)
      .eq('user_id', userId)
      .eq('usage_date', getRequestDayKey(request))
      .maybeSingle(),
    admin.rpc('get_org_token_stats', { p_org_id: parsed.data }),
  ]);

  let org = orgResponse.data;
  if (orgResponse.error && (
    isMissingColumnError(orgResponse.error, 'token_balance') ||
    isMissingColumnError(orgResponse.error, 'owner_id') ||
    isMissingColumnError(orgResponse.error, 'member_cap') ||
    isMissingColumnError(orgResponse.error, 'daily_ai_limit')
  )) {
    const legacyOrgResponse = await admin
      .from('orgs')
      .select('name, join_code, owner_user_id, member_limit, ai_daily_limit_per_user, credit_balance, created_at, updated_at')
      .eq('id', parsed.data)
      .maybeSingle();

    if (legacyOrgResponse.error) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: legacyOrgResponse.error.message, source: 'network' }),
        { status: 500 }
      );
    }

    org = legacyOrgResponse.data
      ? {
          ...legacyOrgResponse.data,
          owner_id: legacyOrgResponse.data.owner_user_id,
          member_cap: legacyOrgResponse.data.member_limit,
          daily_ai_limit: legacyOrgResponse.data.ai_daily_limit_per_user,
          token_balance: legacyOrgResponse.data.credit_balance,
        }
      : null;
  } else if (orgResponse.error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: orgResponse.error.message, source: 'network' }),
      { status: 500 }
    );
  }

  const memberLimit = Number(org?.member_cap ?? 0);
  const dailyAiLimitPerUser = Number(org?.daily_ai_limit ?? 0);
  const estimatedMonthlyTokens = calculateMonthlyTokenEstimate(memberLimit, dailyAiLimitPerUser);
  const estimatedDailyTokens = calculateDailyTokenEstimate(memberLimit, dailyAiLimitPerUser);

  let tokenBalance = readBalance(org).balance;
  let estimatedDaysRemaining = calculateEstimatedDaysRemaining(tokenBalance, estimatedMonthlyTokens);
  let recentTokenActivity: Array<{
    id: string;
    amount: number;
    type: string;
    description: string;
    metadata?: Record<string, unknown> | null;
    created_at: string;
  }> = [];

  if (membership.role === 'owner') {
    const { data: activity, error: activityError } = await admin
      .from('token_transactions')
      .select('id, amount, type, description, metadata, created_at')
      .eq('organization_id', parsed.data)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!activityError) {
      recentTokenActivity = activity ?? [];
    }
  }

  const aiAvailability = getAiAvailability(tokenBalance, estimatedMonthlyTokens);
  const tokenHealth = getTokenHealth(calculateEstimatedDaysRemaining(tokenBalance, estimatedMonthlyTokens));

  const statsError = statsResponse?.error;
  const statsDataRaw =
    statsError && isMissingFunctionError(statsError, 'get_org_token_stats')
      ? null
      : statsResponse?.data;
  const statsData = Array.isArray(statsDataRaw) ? statsDataRaw[0] : statsDataRaw;
  const tokensPurchased = Math.max(0, Number(statsData?.tokens_purchased ?? 0));
  const tokensUsed = Math.max(0, Math.min(Number(statsData?.tokens_used ?? 0), tokensPurchased));

  return NextResponse.json({
    ok: true,
    data: {
      orgId: parsed.data,
      orgName: org?.name ?? 'Organization',
      role: membership.role,
      memberLimit,
      dailyAiLimitPerUser,
      activeUsers: count ?? 0,
      requestsUsedToday: usage?.request_count ?? 0,
      aiAvailability,
      estimatedMonthlyTokens,
      estimatedDailyTokens,
      tokenHealth,
      tokensPurchased,
      tokensUsed,
      createdAt: org?.created_at ?? null,
      updatedAt: org?.updated_at ?? null,
      ...(membership.role === 'owner'
        ? {
            joinCode: org?.join_code ?? null,
            tokenBalance,
            estimatedDaysRemaining,
            recentTokenActivity,
          }
        : {}),
    },
  });
}
