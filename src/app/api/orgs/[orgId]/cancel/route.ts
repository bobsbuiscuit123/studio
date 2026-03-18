import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';

export async function POST(
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
  if (!membership || membership.role !== 'owner') {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Only the organization owner can delete it.', source: 'app' }),
      { status: 403 }
    );
  }

  const admin = createSupabaseAdmin();
  const [{ data: sub }, { data: org }] = await Promise.all([
    admin
      .from('org_subscriptions')
      .select('current_period_start, current_period_end, cancel_at_period_end')
      .eq('org_id', parsed.data)
      .maybeSingle(),
    admin
      .from('orgs')
      .select('created_at')
      .eq('id', parsed.data)
      .maybeSingle(),
  ]);

  const baseStart = sub?.current_period_start ?? org?.created_at ?? new Date().toISOString();
  const serviceEndsAt =
    sub?.current_period_end ??
    (() => {
      const next = new Date(baseStart);
      next.setMonth(next.getMonth() + 1);
      return next.toISOString();
    })();

  const { error: updateError } = await admin
    .from('org_subscriptions')
    .upsert({
      org_id: parsed.data,
      payment_provider: 'iap',
      status: 'active',
      current_period_start: baseStart,
      current_period_end: serviceEndsAt,
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    });

  if (updateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: updateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      orgId: parsed.data,
      serviceEndsAt,
      cancelAtPeriodEnd: true,
    },
  });
}
