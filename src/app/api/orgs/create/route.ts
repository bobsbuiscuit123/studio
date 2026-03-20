import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { calculateEstimatedMonthlyCredits } from '@/lib/pricing';

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

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const generated = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data } = await admin
      .from('orgs')
      .select('id')
      .eq('join_code', generated)
      .maybeSingle();
    if (!data?.id) {
      return generated;
    }
  }

  return null;
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
    dailyAiLimitPerUser: z.number().int().min(0),
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
  if (!reservedJoinCode) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unable to reserve join code.', source: 'app' }),
      { status: 409, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: walletProfile } = await admin
    .from('profiles')
    .select('credit_balance')
    .eq('id', userId)
    .maybeSingle();
  const walletBalance = Number(walletProfile?.credit_balance ?? 0);

  const orgInsert: {
    name: string;
    category: string | null;
    description: string | null;
    created_by: string;
    owner_user_id: string;
    member_limit: number;
    ai_daily_limit_per_user: number;
    credit_balance: number;
    updated_at: string;
    join_code?: string;
  } = {
    name: parsed.data.name.trim(),
    category: parsed.data.category?.trim() || null,
    description: parsed.data.description?.trim() || null,
    created_by: userId,
    owner_user_id: userId,
    member_limit: parsed.data.maxUserLimit,
    ai_daily_limit_per_user: parsed.data.dailyAiLimitPerUser,
    credit_balance: walletBalance,
    updated_at: new Date().toISOString(),
  };
  orgInsert.join_code = reservedJoinCode;

  const { data: org, error: orgError } = await admin
    .from('orgs')
    .insert(orgInsert)
    .select('id, join_code, credit_balance')
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

  if (walletBalance > 0) {
    const [{ error: walletResetError }, { error: transactionError }] = await Promise.all([
      admin.from('profiles').upsert({ id: userId, credit_balance: 0 }, { onConflict: 'id' }),
      admin.from('credit_transactions').insert({
        organization_id: org.id,
        actor_user_id: userId,
        type: 'adjustment',
        amount: walletBalance,
        description: 'Owner wallet credits applied during organization creation',
        metadata: { source: 'wallet_transfer' },
      }),
    ]);

    if (walletResetError || transactionError) {
      await rollbackOrg();
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: walletResetError?.message || transactionError?.message || 'Unable to create organization.',
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }
  }

  const estimatedMonthlyCredits = calculateEstimatedMonthlyCredits(
    parsed.data.maxUserLimit,
    parsed.data.dailyAiLimitPerUser
  );

  return NextResponse.json(
    {
      ok: true,
      orgId: org.id,
      joinCode: org.join_code,
      estimatedMonthlyCredits,
      creditBalance: Number(org.credit_balance ?? walletBalance),
    },
    { headers: getRateLimitHeaders(limiter) }
  );
}
