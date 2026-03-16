import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { computeOrgPricing } from '@/lib/pricing';

const ensureUniqueJoinCode = async (admin: ReturnType<typeof createSupabaseAdmin>, preferred?: string) => {
  if (preferred) {
    const { data } = await admin
      .from('orgs')
      .select('id')
      .eq('join_code', preferred)
      .maybeSingle();
    if (data?.id) return null;
    return preferred;
  }

  return undefined;
};

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const limiter = rateLimit(`org-create:${ip}`, 10, 60_000);
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
    name: z.string().min(3),
    category: z.string().optional(),
    description: z.string().optional(),
    joinCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{4,10}$/)
      .optional(),
    maxUserLimit: z.number().int().min(1),
    dailyCreditPerUser: z.number().int().min(0),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Invalid org payload.',
        source: 'app',
      }),
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

  const admin = createSupabaseAdmin();
  const joinCodeInput = parsed.data.joinCode?.trim().toUpperCase();
  const reservedJoinCode = await ensureUniqueJoinCode(admin, joinCodeInput || undefined);
  if (joinCodeInput && !reservedJoinCode) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unable to reserve join code.', source: 'app' }),
      { status: 409, headers: getRateLimitHeaders(limiter) }
    );
  }

  const pricing = computeOrgPricing(parsed.data.maxUserLimit, parsed.data.dailyCreditPerUser);
  const now = new Date().toISOString();
  const orgInsert: {
    name: string;
    category: string | null;
    description: string | null;
    created_by: string;
    join_code?: string;
  } = {
    name: parsed.data.name.trim(),
    category: parsed.data.category?.trim() || null,
    description: parsed.data.description?.trim() || null,
    created_by: userId,
  };
  if (reservedJoinCode) {
    orgInsert.join_code = reservedJoinCode;
  }

  const { data: org, error: orgError } = await admin
    .from('orgs')
    .insert(orgInsert)
    .select('id, join_code')
    .single();

  if (orgError || !org?.id || !org?.join_code) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: orgError?.message || 'Unable to create organization.',
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const rollbackOrg = async () => {
    await admin.from('orgs').delete().eq('id', org.id);
  };

  const { error: membershipError } = await admin
    .from('memberships')
    .insert({ org_id: org.id, user_id: userId, role: 'owner' });
  if (membershipError) {
    await rollbackOrg();
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: membershipError.message,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { error: stateError } = await admin
    .from('org_state')
    .insert({ org_id: org.id, data: {} });
  if (stateError) {
    await rollbackOrg();
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: stateError.message,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { error: planError } = await admin
    .from('org_billing_plans')
    .insert({
      org_id: org.id,
      max_user_limit: parsed.data.maxUserLimit,
      daily_credit_per_user: parsed.data.dailyCreditPerUser,
      static_cost: pricing.staticCost,
      variable_cost: pricing.variableCost,
      multiplier: pricing.multiplier,
      retail_price: pricing.retailPrice,
      currency: 'usd',
    });
  if (planError) {
    await rollbackOrg();
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: planError.message,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { error: subscriptionError } = await admin
    .from('org_subscriptions')
    .insert({
      org_id: org.id,
      payment_provider: 'iap',
      status: 'active',
      current_period_start: now,
      current_period_end: null,
      cancel_at_period_end: false,
    });
  if (subscriptionError) {
    await rollbackOrg();
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: subscriptionError.message,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  console.info('[billing] organization provisioned for future IAP', {
    userId,
    orgId: org.id,
    joinCode: org.join_code,
    maxUserLimit: parsed.data.maxUserLimit,
    dailyCreditPerUser: parsed.data.dailyCreditPerUser,
  });

  return NextResponse.json(
    { ok: true, orgId: org.id, joinCode: org.join_code, paymentProvider: 'iap' },
    { headers: getRateLimitHeaders(limiter) }
  );
}
