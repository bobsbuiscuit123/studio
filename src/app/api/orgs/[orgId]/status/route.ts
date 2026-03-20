import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { getRequestDayKey } from '@/lib/day-key';
import {
  calculateEstimatedDailyCredits,
  calculateEstimatedDaysRemaining,
  calculateEstimatedMonthlyCredits,
  getAiAvailability,
  getCreditHealth,
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

  const { data: membership } = await supabase
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

  const admin = createSupabaseAdmin();
  const [{ data: org }, { count }, { data: usage }, { data: activity }] = await Promise.all([
    admin
      .from('orgs')
      .select('name, owner_user_id, member_limit, ai_daily_limit_per_user, credit_balance, created_at, updated_at')
      .eq('id', parsed.data)
      .maybeSingle(),
    admin
      .from('memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', parsed.data),
    admin
      .from('org_usage_daily')
      .select('credits_used')
      .eq('org_id', parsed.data)
      .eq('user_id', userId)
      .eq('usage_date', getRequestDayKey(request))
      .maybeSingle(),
    membership.role === 'owner'
      ? admin
          .from('credit_transactions')
          .select('id, amount, type, description, metadata, created_at')
          .eq('organization_id', parsed.data)
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null as null }),
  ]);

  const memberLimit = Number(org?.member_limit ?? 0);
  const dailyAiLimitPerUser = Number(org?.ai_daily_limit_per_user ?? 0);
  const creditBalance = Number(org?.credit_balance ?? 0);
  const estimatedMonthlyCredits = calculateEstimatedMonthlyCredits(memberLimit, dailyAiLimitPerUser);
  const estimatedDailyCredits = calculateEstimatedDailyCredits(memberLimit, dailyAiLimitPerUser);
  const estimatedDaysRemaining = calculateEstimatedDaysRemaining(creditBalance, estimatedMonthlyCredits);
  const aiAvailability = getAiAvailability(creditBalance, estimatedMonthlyCredits);
  const creditHealth = getCreditHealth(estimatedDaysRemaining);

  return NextResponse.json({
    ok: true,
    data: {
      orgId: parsed.data,
      orgName: org?.name ?? 'Organization',
      role: membership.role,
      memberLimit,
      dailyAiLimitPerUser,
      activeUsers: count ?? 0,
      requestsUsedToday: usage?.credits_used ?? 0,
      aiAvailability,
      estimatedMonthlyCredits,
      estimatedDailyCredits,
      creditHealth,
      createdAt: org?.created_at ?? null,
      updatedAt: org?.updated_at ?? null,
      ...(membership.role === 'owner'
        ? {
            creditBalance,
            estimatedDaysRemaining,
            recentCreditActivity: activity ?? [],
          }
        : {}),
    },
  });
}
