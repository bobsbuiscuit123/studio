import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

const ensureUniqueJoinCode = async (
  admin: ReturnType<typeof createSupabaseAdmin>,
  preferred?: string
) => {
  if (preferred) {
    const { data } = await admin.from('orgs').select('id').eq('join_code', preferred).maybeSingle();
    if (data?.id) return null;
    return preferred;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const generated = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data } = await admin.from('orgs').select('id').eq('join_code', generated).maybeSingle();
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
  const schema = z
    .object({
      name: z.string().min(3),
      category: z.string().optional(),
      description: z.string().optional(),
      joinCode: z
        .string()
        .trim()
        .regex(/^[A-Z0-9]{4,10}$/)
        .optional(),
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
  const joinCodeInput = parsed.data.joinCode?.trim().toUpperCase();
  const reservedJoinCode = await ensureUniqueJoinCode(admin, joinCodeInput || undefined);
  if (!reservedJoinCode) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unable to reserve join code.', source: 'app' }),
      { status: 409, headers: getRateLimitHeaders(limiter) }
    );
  }

  const { data: rpcResult, error: createError } = await admin.rpc('create_organization_with_trial', {
    p_owner_id: userId,
    p_name: parsed.data.name.trim(),
    p_category: parsed.data.category?.trim() || null,
    p_description: parsed.data.description?.trim() || null,
    p_join_code: reservedJoinCode,
    p_member_cap: memberCap,
    p_daily_ai_limit: dailyAiLimit,
  });

  if (createError) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: createError.message,
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  const created = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
  if (!created?.org_id || !created?.join_code) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Unable to create organization.',
        source: 'network',
      }),
      { status: 500, headers: getRateLimitHeaders(limiter) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      orgId: created.org_id as string,
      joinCode: created.join_code as string,
      tokenBalance: Number(created.token_balance ?? 0),
      trialGranted: Boolean(created.trial_granted),
    },
    { headers: getRateLimitHeaders(limiter) }
  );
}
