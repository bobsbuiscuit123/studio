import { NextResponse } from 'next/server';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { getUserSubscriptionSummary, syncRevenueCatSubscriber } from '@/lib/subscription-sync';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const admin = createSupabaseAdmin();
  try {
    await syncRevenueCatSubscriber({
      admin,
      appUserId: userId,
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

  const subscription = await getUserSubscriptionSummary(admin, userId);
  return NextResponse.json({
    ok: true,
    data: subscription,
  });
}
