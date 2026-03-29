import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import {
  buildEffectiveAvailability,
  getPlanName,
  isPaidSubscriptionStatus,
  resolvePlanId,
  type OrgSubscriptionStatus,
} from '@/lib/org-subscription';

export const dynamic = 'force-dynamic';

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const parsed = z.string().uuid().safeParse(orgId);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid org id.', source: 'app' }),
      { status: 400, headers: noStoreHeaders }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401, headers: noStoreHeaders }
    );
  }

  const admin = createSupabaseAdmin();
  const [{ data: membership, error: membershipError }, refreshResponse] = await Promise.all([
    admin
      .from('memberships')
      .select('role')
      .eq('org_id', parsed.data)
      .eq('user_id', userId)
      .maybeSingle(),
    admin.rpc('refresh_org_subscription_period', {
      p_org_id: parsed.data,
    }),
  ]);

  if (membershipError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: membershipError.message, source: 'network' }),
      { status: 500, headers: noStoreHeaders }
    );
  }

  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Not a member.', source: 'app' }),
      { status: 403, headers: noStoreHeaders }
    );
  }

  if (refreshResponse.error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: refreshResponse.error.message, source: 'network' }),
      { status: 500, headers: noStoreHeaders }
    );
  }

  const [orgResponse, membershipCountResponse] = await Promise.all([
    admin
      .from('orgs')
      .select(
        'id, name, join_code, owner_id, subscription_product_id, subscription_status, monthly_token_limit, tokens_used_this_period, current_period_start, current_period_end, bonus_tokens_this_period, usage_estimate_members, usage_estimate_requests_per_member, usage_estimate_monthly_tokens, created_at, updated_at'
      )
      .eq('id', parsed.data)
      .maybeSingle(),
    admin
      .from('memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', parsed.data),
  ]);

  if (orgResponse.error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: orgResponse.error.message, source: 'network' }),
      { status: 500, headers: noStoreHeaders }
    );
  }

  const org = orgResponse.data;
  if (!org) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization not found.', source: 'app' }),
      { status: 404, headers: noStoreHeaders }
    );
  }

  const ownerProfileResponse = await admin
    .from('profiles')
    .select('subscribed_org_id, active_subscription_product_id, subscription_status')
    .eq('id', org.owner_id)
    .maybeSingle();

  if (ownerProfileResponse.error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: ownerProfileResponse.error.message, source: 'network' }),
      { status: 500, headers: noStoreHeaders }
    );
  }

  const refreshed =
    Array.isArray(refreshResponse.data) && refreshResponse.data.length > 0
      ? (refreshResponse.data[0] as {
          subscription_product_id?: string | null;
          subscription_status?: string | null;
          monthly_token_limit?: number | null;
          bonus_tokens_this_period?: number | null;
          tokens_used_this_period?: number | null;
          effective_available_tokens?: number | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
        })
      : ((refreshResponse.data ?? {}) as {
          subscription_product_id?: string | null;
          subscription_status?: string | null;
          monthly_token_limit?: number | null;
          bonus_tokens_this_period?: number | null;
          tokens_used_this_period?: number | null;
          effective_available_tokens?: number | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
        });

  const isOwner = String(org.owner_id ?? '') === userId || membership.role === 'owner';
  const subscriptionProductId = (org.subscription_product_id ??
    refreshed.subscription_product_id ??
    null) as OrgSubscriptionStatus['subscriptionProductId'];
  const planId = resolvePlanId(subscriptionProductId);
  const monthlyTokenLimit = Number(
    refreshed.monthly_token_limit ?? org.monthly_token_limit ?? 0
  );
  const bonusTokensThisPeriod = Number(
    refreshed.bonus_tokens_this_period ?? org.bonus_tokens_this_period ?? 0
  );
  const tokensUsedThisPeriod = Number(
    refreshed.tokens_used_this_period ?? org.tokens_used_this_period ?? 0
  );
  const effectiveAvailableTokens = buildEffectiveAvailability({
    monthlyTokenLimit,
    bonusTokensThisPeriod,
    tokensUsedThisPeriod,
  });
  const payload: OrgSubscriptionStatus = {
    orgId: org.id,
    orgName: org.name ?? 'Organization',
    role: isOwner ? 'owner' : membership.role,
    joinCode: isOwner ? org.join_code ?? null : null,
    activeUsers: membershipCountResponse.count ?? 0,
    createdAt: org.created_at ?? null,
    updatedAt: org.updated_at ?? null,
    planId,
    planName: getPlanName(planId),
    subscriptionStatus: (subscriptionProductId
      ? org.subscription_status ?? refreshed.subscription_status ?? 'active'
      : 'free') as OrgSubscriptionStatus['subscriptionStatus'],
    subscriptionProductId,
    scheduledProductId: null,
    monthlyTokenLimit,
    bonusTokensThisPeriod,
    tokensUsedThisPeriod,
    effectiveAvailableTokens,
    currentPeriodStart: refreshed.current_period_start ?? org.current_period_start ?? null,
    currentPeriodEnd: refreshed.current_period_end ?? org.current_period_end ?? null,
    aiAvailable: effectiveAvailableTokens > 0,
    canManageBilling: isOwner,
    isSubscribedOrg: ownerProfileResponse.data?.subscribed_org_id === org.id,
    ownerHasActiveSubscription:
      Boolean(ownerProfileResponse.data?.active_subscription_product_id) &&
      isPaidSubscriptionStatus(ownerProfileResponse.data?.subscription_status),
    subscribedOrgId: isOwner ? ownerProfileResponse.data?.subscribed_org_id ?? null : null,
    usageEstimateMembers: Number(org.usage_estimate_members ?? 0),
    usageEstimateRequestsPerMember: Number(
      org.usage_estimate_requests_per_member ?? 0
    ),
    usageEstimateMonthlyTokens: Number(org.usage_estimate_monthly_tokens ?? 0),
    managementUrl: null,
  };

  return NextResponse.json(
    {
      ok: true,
      data: payload,
    },
    { headers: noStoreHeaders }
  );
}
