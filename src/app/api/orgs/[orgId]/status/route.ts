import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { getRequestDayKey } from '@/lib/day-key';
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
  const [{ data: org }, { count }, { data: usage }] = await Promise.all([
    admin
      .from('orgs')
      .select('name, owner_id, member_cap, daily_ai_limit, created_at, updated_at')
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
  ]);

  const memberLimit = Number(org?.member_cap ?? 0);
  const dailyAiLimitPerUser = Number(org?.daily_ai_limit ?? 0);
  const estimatedMonthlyTokens = calculateMonthlyTokenEstimate(memberLimit, dailyAiLimitPerUser);
  const estimatedDailyTokens = calculateDailyTokenEstimate(memberLimit, dailyAiLimitPerUser);

  let tokenBalance = 0;
  let estimatedDaysRemaining = 0;
  let recentTokenActivity: Array<{
    id: string;
    amount: number;
    type: string;
    description: string;
    metadata?: Record<string, unknown> | null;
    created_at: string;
  }> = [];

  if (membership.role === 'owner' && org?.owner_id) {
    const [{ data: ownerProfile }, { data: activity }] = await Promise.all([
      admin
        .from('profiles')
        .select('token_balance')
        .eq('id', org.owner_id)
        .maybeSingle(),
      admin
        .from('token_transactions')
        .select('id, amount, type, description, metadata, created_at')
        .eq('user_id', org.owner_id)
        .eq('organization_id', parsed.data)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    tokenBalance = Number(ownerProfile?.token_balance ?? 0);
    estimatedDaysRemaining = calculateEstimatedDaysRemaining(tokenBalance, estimatedMonthlyTokens);
    recentTokenActivity = activity ?? [];
  } else if (org?.owner_id) {
    const { data: ownerProfile } = await admin
      .from('profiles')
      .select('token_balance')
      .eq('id', org.owner_id)
      .maybeSingle();
    tokenBalance = Number(ownerProfile?.token_balance ?? 0);
  }

  const aiAvailability = getAiAvailability(tokenBalance, estimatedMonthlyTokens);
  const tokenHealth = getTokenHealth(calculateEstimatedDaysRemaining(tokenBalance, estimatedMonthlyTokens));

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
      createdAt: org?.created_at ?? null,
      updatedAt: org?.updated_at ?? null,
      ...(membership.role === 'owner'
        ? {
            tokenBalance,
            estimatedDaysRemaining,
            recentTokenActivity,
          }
        : {}),
    },
  });
}
