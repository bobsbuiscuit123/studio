import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getUserSubscriptionSummary } from '@/lib/subscription-sync';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  draftId: z.string().uuid(),
}).strict();

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`org-create-checkout:${getRequestIp(request.headers)}`, 15, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Missing draft id.', source: 'app' }),
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

  const userLimiter = rateLimit(`org-create-checkout-user:${userId}`, 20, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();
  const [{ data: draft, error: draftError }, subscription] = await Promise.all([
    admin
      .from('org_creation_drafts')
      .select(
        'id, name, category, description, selected_plan_id, creation_mode, usage_estimate_members, usage_estimate_requests_per_member, usage_estimate_monthly_tokens, status, finalized_org_id'
      )
      .eq('id', parsed.data.draftId)
      .eq('owner_id', userId)
      .maybeSingle(),
    getUserSubscriptionSummary(admin, userId),
  ]);

  if (draftError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: draftError.message, source: 'network' }),
      { status: 500 }
    );
  }

  if (!draft) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Organization draft not found.', source: 'app' }),
      { status: 404 }
    );
  }

  const paidOrg =
    subscription.subscribedOrgId
      ? await admin
          .from('orgs')
          .select('id, name')
          .eq('id', subscription.subscribedOrgId)
          .maybeSingle()
      : null;

  return NextResponse.json({
    ok: true,
    data: {
      draft,
      subscription,
      paidOrg: paidOrg?.data ?? null,
    },
  });
}
