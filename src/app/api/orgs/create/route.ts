import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { isMissingColumnError, readBalance } from '@/lib/org-balance';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TRIAL_TOKENS = 2500;

const generateJoinCode = () =>
  Array.from({ length: JOIN_CODE_LENGTH }, () =>
    JOIN_CODE_CHARSET[Math.floor(Math.random() * JOIN_CODE_CHARSET.length)]
  ).join('');

const insertOrgWithFallback = async ({
  admin,
  userId,
  name,
  category,
  description,
  joinCode,
  memberCap,
  dailyAiLimit,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  userId: string;
  name: string;
  category: string | null;
  description: string | null;
  joinCode: string;
  memberCap: number;
  dailyAiLimit: number;
}) => {
  const common = {
    name,
    join_code: joinCode,
    category,
    description,
    created_by: userId,
  };

  const modernInsert = await admin
    .from('orgs')
    .insert({
      ...common,
      updated_at: new Date().toISOString(),
      owner_id: userId,
      member_cap: memberCap,
      daily_ai_limit: dailyAiLimit,
    })
    .select('id')
    .maybeSingle();

  if (!modernInsert.error) {
    return { orgId: modernInsert.data?.id ?? null, usedLegacySchema: false, error: null };
  }

  const shouldTryLegacy =
    isMissingColumnError(modernInsert.error, 'owner_id') ||
    isMissingColumnError(modernInsert.error, 'member_cap') ||
    isMissingColumnError(modernInsert.error, 'daily_ai_limit') ||
    isMissingColumnError(modernInsert.error, 'updated_at');

  if (!shouldTryLegacy) {
    return { orgId: null, usedLegacySchema: false, error: modernInsert.error };
  }

  const legacyInsert = await admin
    .from('orgs')
    .insert({
      ...common,
      owner_user_id: userId,
      member_limit: memberCap,
      ai_daily_limit_per_user: dailyAiLimit,
    })
    .select('id')
    .maybeSingle();

  return {
    orgId: legacyInsert.data?.id ?? null,
    usedLegacySchema: !legacyInsert.error,
    error: legacyInsert.error,
  };
};

const reserveRandomJoinCode = async (admin: ReturnType<typeof createSupabaseAdmin>) => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const generated = generateJoinCode();
    const { data } = await admin.from('orgs').select('id').eq('join_code', generated).maybeSingle();
    if (!data?.id) {
      return generated;
    }
  }

  return null;
};

const grantFirstOrgTrialTokens = async ({
  admin,
  userId,
  orgId,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  userId: string;
  orgId: string;
}) => {
  const profileResponse = await admin
    .from('profiles')
    .select('has_used_trial')
    .eq('id', userId)
    .maybeSingle();

  if (profileResponse.error && !isMissingColumnError(profileResponse.error, 'has_used_trial')) {
    return { granted: false, tokenBalance: 0 };
  }

  const alreadyUsedTrial = Boolean(profileResponse.data?.has_used_trial);
  if (alreadyUsedTrial) {
    const orgBalanceResponse = await admin
      .from('orgs')
      .select('token_balance, credit_balance')
      .eq('id', orgId)
      .maybeSingle();
    return { granted: false, tokenBalance: readBalance(orgBalanceResponse.data).balance };
  }

  try {
    await admin.from('profiles').upsert(
      {
        id: userId,
        has_used_trial: true,
        trial_granted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  } catch {
    // Do not block org creation if the profile trial marker cannot be updated.
  }

  const orgResponse = await admin
    .from('orgs')
    .select('token_balance, credit_balance')
    .eq('id', orgId)
    .maybeSingle();

  const currentBalance = readBalance(orgResponse.data).balance;

  let updated = false;
  let nextBalance = currentBalance;

  const tokenUpdate = await admin
    .from('orgs')
    .update({
      token_balance: currentBalance + TRIAL_TOKENS,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orgId);

  if (!tokenUpdate.error) {
    updated = true;
    nextBalance = currentBalance + TRIAL_TOKENS;
  } else {
    const creditUpdate = await admin
      .from('orgs')
      .update({
        credit_balance: currentBalance + TRIAL_TOKENS,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orgId);
    if (!creditUpdate.error) {
      updated = true;
      nextBalance = currentBalance + TRIAL_TOKENS;
    }
  }

  if (updated) {
    try {
      await admin.from('token_transactions').insert({
        user_id: userId,
        organization_id: orgId,
        actor_user_id: userId,
        type: 'trial',
        amount: TRIAL_TOKENS,
        balance_after: nextBalance,
        description: 'First organization trial tokens',
        metadata: { trial_tokens: TRIAL_TOKENS },
      });
    } catch {
      // The balance grant matters more than the activity log.
    }
  }

  return { granted: updated, tokenBalance: nextBalance };
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
const schema = z
    .object({
      name: z.string().min(3),
      category: z.string().optional(),
      description: z.string().optional(),
      memberCap: z.number().int().min(0).optional(),
      dailyAiLimit: z.number().int().min(0).optional(),
      maxUserLimit: z.number().int().min(0).optional(),
      dailyAiLimitPerUser: z.number().int().min(0).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.memberCap == null && value.maxUserLimit == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Missing member cap.',
          path: ['memberCap'],
        });
      }
      if (value.dailyAiLimit == null && value.dailyAiLimitPerUser == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Missing daily AI limit.',
          path: ['dailyAiLimit'],
        });
      }
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

  const memberCap = parsed.data.memberCap ?? parsed.data.maxUserLimit ?? 0;
  const dailyAiLimit = parsed.data.dailyAiLimit ?? parsed.data.dailyAiLimitPerUser ?? 0;

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
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const reservedJoinCode = await reserveRandomJoinCode(admin);
    if (!reservedJoinCode) {
      break;
    }
    const fallback = await insertOrgWithFallback({
      admin,
      userId,
      name: parsed.data.name.trim(),
      category: parsed.data.category?.trim() || null,
      description: parsed.data.description?.trim() || null,
      joinCode: reservedJoinCode,
      memberCap,
      dailyAiLimit,
    });

    if (fallback.error) {
      const duplicateJoinCode =
        fallback.error.code === '23505' || /join_code/i.test(fallback.error.message);
      if (duplicateJoinCode) {
        continue;
      }
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: fallback.error.message,
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    if (!fallback.orgId) {
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: 'Unable to create organization.',
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    const membershipInsert = await admin
      .from('memberships')
      .insert({ user_id: userId, org_id: fallback.orgId, role: 'owner' });

    if (membershipInsert.error) {
      return NextResponse.json(
        err({
          code: 'NETWORK_HTTP_ERROR',
          message: membershipInsert.error.message,
          source: 'network',
        }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    const trialGrant = await grantFirstOrgTrialTokens({
      admin,
      userId,
      orgId: fallback.orgId,
    }).catch(() => ({ granted: false, tokenBalance: 0 }));

    return NextResponse.json(
      {
        ok: true,
        orgId: fallback.orgId,
        joinCode: reservedJoinCode,
        tokenBalance: trialGrant.tokenBalance,
        trialGranted: trialGrant.granted,
        usedLegacySchema: fallback.usedLegacySchema,
      },
      { headers: getRateLimitHeaders(limiter) }
    );
  }

  return NextResponse.json(
    err({
      code: 'NETWORK_HTTP_ERROR',
      message: 'Unable to reserve a unique join code.',
      source: 'network',
    }),
    { status: 500, headers: getRateLimitHeaders(limiter) }
  );
}
