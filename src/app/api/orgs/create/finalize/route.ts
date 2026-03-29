import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { OrgBillingMode } from '@/lib/org-subscription';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';
import { getUserSubscriptionSummary, syncRevenueCatSubscriber } from '@/lib/subscription-sync';

const creationModes = [
  'free',
  'purchase',
  'keep_current_paid',
  'transfer_subscription',
] as const;

const bodySchema = z.object({
  draftId: z.string().uuid(),
  creationMode: z.enum(creationModes),
  verifiedProductId: z.string().optional(),
});

const isSubscriptionAssignmentConflict = (message: string) =>
  /subscription_assignment_conflict|one_paid_org_per_user|23505|duplicate key value violates unique constraint/i.test(
    message
  );

const finalizeDraftWithRetry = async (
  admin: ReturnType<typeof createSupabaseAdmin>,
  args: {
    p_draft_id: string;
    p_user_id: string;
    p_creation_mode: OrgBillingMode;
    p_verified_product_id: string | null;
  }
) => {
  let lastError: { message?: string } | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await admin.rpc('finalize_org_creation_from_draft', args);
    if (!error) {
      return { data, error: null };
    }

    lastError = error;
    if (!isSubscriptionAssignmentConflict(error.message || '') || attempt === 1) {
      break;
    }
  }

  return { data: null, error: lastError };
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid organization finalization request.', source: 'app' }),
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

  const admin = createSupabaseAdmin();

  if (parsed.data.creationMode === 'purchase' || parsed.data.creationMode === 'transfer_subscription') {
    try {
      await syncRevenueCatSubscriber({
        admin,
        appUserId: userId,
      });
      const subscription = await getUserSubscriptionSummary(admin, userId);
      if (subscription.activeProductId && subscription.subscribedOrgId) {
        return NextResponse.json(
          err({
            code: 'BILLING_INACTIVE',
            message:
              'You already have a subscription on another organization. Create this organization on the free plan or manage the paid plan from the current paid organization.',
            source: 'app',
          }),
          { status: 409 }
        );
      }

      const isFreshVerifiedPurchase =
        parsed.data.creationMode === 'purchase' &&
        Boolean(parsed.data.verifiedProductId) &&
        subscription.activeProductId === parsed.data.verifiedProductId;

      if (
        subscription.activeProductId &&
        !subscription.subscribedOrgId &&
        !isFreshVerifiedPurchase
      ) {
        return NextResponse.json(
          err({
            code: 'BILLING_INACTIVE',
            message:
              'We found an active subscription that is not yet assigned to an organization. Restore purchases from Settings before creating another paid organization.',
            source: 'app',
          }),
          { status: 409 }
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to reconcile the subscription before organization creation.';
      return NextResponse.json(
        err({
          code: /subscription_assignment_conflict/i.test(message)
            ? 'BILLING_INACTIVE'
            : 'NETWORK_HTTP_ERROR',
          message,
          source: /subscription_assignment_conflict/i.test(message) ? 'app' : 'network',
        }),
        { status: /subscription_assignment_conflict/i.test(message) ? 409 : 500 }
      );
    }
  }

  const { data, error } = await finalizeDraftWithRetry(admin, {
    p_draft_id: parsed.data.draftId,
    p_user_id: userId,
    p_creation_mode: parsed.data.creationMode,
    p_verified_product_id: parsed.data.verifiedProductId ?? null,
  });

  if (error) {
    const message = error.message || 'Unable to finalize organization creation.';
    const status =
      /purchase_not_synced|subscription_assignment_conflict|target_org_not_owned/i.test(message)
        ? 409
        : /draft_not_found/i.test(message)
          ? 404
          : 500;

    return NextResponse.json(
      err({
        code: status === 409 ? 'BILLING_INACTIVE' : 'NETWORK_HTTP_ERROR',
        message,
        source: status >= 500 ? 'network' : 'app',
      }),
      { status }
    );
  }

  const row =
    Array.isArray(data) && data.length > 0
      ? (data[0] as {
          org_id?: string;
          join_code?: string;
          plan_id?: string;
          subscription_status?: string;
        })
      : ((data ?? {}) as {
          org_id?: string;
          join_code?: string;
          plan_id?: string;
          subscription_status?: string;
        });

  return NextResponse.json({
    ok: true,
    data: {
      orgId: row.org_id ?? null,
      joinCode: row.join_code ?? null,
      planId: row.plan_id ?? null,
      subscriptionStatus: row.subscription_status ?? null,
    },
  });
}
