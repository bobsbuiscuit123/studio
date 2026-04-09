import { NextResponse } from 'next/server';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { getUserSubscriptionSummary, syncRevenueCatSubscriber } from '@/lib/subscription-sync';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`org-subscription-reconcile:${getRequestIp(request.headers)}`, 15, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
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

  const userLimiter = rateLimit(`org-subscription-reconcile-user:${userId}`, 20, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();
  try {
    const syncResult = await syncRevenueCatSubscriber({
      admin,
      appUserId: userId,
    });
    const subscription = await getUserSubscriptionSummary(admin, userId);
    subscription.scheduledProductId = syncResult.canonicalState?.scheduledProductId ?? null;

    return NextResponse.json({
      ok: true,
      data: subscription,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Unable to reconcile the subscription.';
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message, source: 'network' }),
      { status: /subscription_assignment_conflict/i.test(message) ? 409 : 500 }
    );
  }

}
