import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscriptionSummary } from '@/lib/subscription-sync';
import { err } from '@/lib/result';
import { getPlanById } from '@/lib/pricing';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const creationModes = [
  'free',
  'purchase',
  'keep_current_paid',
  'transfer_subscription',
] as const;

const draftSchema = z.object({
  draftId: z.string().uuid().nullish(),
  name: z.string().min(3),
  category: z.string().max(120).nullish(),
  description: z.string().max(500).nullish(),
  usageEstimateMembers: z.number().int().min(0).max(100_000).optional(),
  usageEstimateRequestsPerMember: z.number().int().min(0).max(10_000).optional(),
  usageEstimateMonthlyTokens: z.number().int().min(0).max(10_000_000).optional(),
  selectedPlanId: z.string().min(1).nullish(),
  creationMode: z.enum(creationModes).nullish(),
  idempotencyKey: z.string().max(120).nullish(),
}).strict();

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const limiter = rateLimit(`org-create-draft:${ip}`, 15, 60_000);
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
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message || 'Invalid organization draft.',
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

  const userLimiter = rateLimit(`org-create-draft-user:${userId}`, 20, 60_000);
  if (!userLimiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(userLimiter) }
    );
  }

  const admin = createSupabaseAdmin();
  const resolvedPlan = getPlanById(parsed.data.selectedPlanId);
  const draftPayload = {
    owner_id: userId,
    name: parsed.data.name.trim(),
    category: parsed.data.category?.trim() || null,
    description: parsed.data.description?.trim() || null,
    selected_plan_id: resolvedPlan.id,
    creation_mode: parsed.data.creationMode ?? (resolvedPlan.isFree ? 'free' : 'purchase'),
    usage_estimate_members: parsed.data.usageEstimateMembers ?? 0,
    usage_estimate_requests_per_member: parsed.data.usageEstimateRequestsPerMember ?? 0,
    usage_estimate_monthly_tokens: parsed.data.usageEstimateMonthlyTokens ?? 0,
    status: resolvedPlan.isFree ? 'draft' : 'purchase_pending',
    updated_at: new Date().toISOString(),
    ...(parsed.data.idempotencyKey ? { idempotency_key: parsed.data.idempotencyKey } : {}),
  };

  let draftRow:
    | {
        id: string;
        name: string;
        selected_plan_id: string;
        creation_mode: string;
        usage_estimate_members: number;
        usage_estimate_requests_per_member: number;
        usage_estimate_monthly_tokens: number;
        status: string;
      }
    | null = null;

  if (parsed.data.draftId) {
    const { data, error } = await admin
      .from('org_creation_drafts')
      .update(draftPayload)
      .eq('id', parsed.data.draftId)
      .eq('owner_id', userId)
      .select(
        'id, name, selected_plan_id, creation_mode, usage_estimate_members, usage_estimate_requests_per_member, usage_estimate_monthly_tokens, status'
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    draftRow = data;
  }

  if (!draftRow) {
    const { data, error } = await admin
      .from('org_creation_drafts')
      .insert(draftPayload)
      .select(
        'id, name, selected_plan_id, creation_mode, usage_estimate_members, usage_estimate_requests_per_member, usage_estimate_monthly_tokens, status'
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
        { status: 500, headers: getRateLimitHeaders(limiter) }
      );
    }

    draftRow = data;
  }

  const subscription = await getUserSubscriptionSummary(admin, userId);
  const paidOrg =
    subscription.subscribedOrgId
      ? await admin
          .from('orgs')
          .select('id, name')
          .eq('id', subscription.subscribedOrgId)
          .maybeSingle()
      : null;

  return NextResponse.json(
    {
      ok: true,
      data: {
        draft: draftRow,
        subscription,
        paidOrg: paidOrg?.data ?? null,
      },
    },
    { headers: getRateLimitHeaders(limiter) }
  );
}
