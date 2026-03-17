import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { getUtcDayKey } from '@/lib/day-key';

export async function GET(
  _request: Request,
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
  const [{ data: plan }, { data: sub }, { count }, { data: usage }] = await Promise.all([
    admin
      .from('org_billing_plans')
      .select('max_user_limit, daily_credit_per_user')
      .eq('org_id', parsed.data)
      .maybeSingle(),
    admin
      .from('org_subscriptions')
      .select('status, cancel_at_period_end')
      .eq('org_id', parsed.data)
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
      .eq('usage_date', getUtcDayKey())
      .maybeSingle(),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      orgId: parsed.data,
      role: membership.role,
      status: sub?.status ?? 'inactive',
      cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
      maxUserLimit: plan?.max_user_limit ?? 0,
      dailyCreditPerUser: plan?.daily_credit_per_user ?? 0,
      activeUsers: count ?? 0,
      creditsUsedToday: usage?.credits_used ?? 0,
    },
  });
}
