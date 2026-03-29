import { NextResponse } from 'next/server';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  collectRevenueCatCustomerCandidates,
  deriveCanonicalRevenueCatState,
  fetchRevenueCatSubscriber,
  type RevenueCatWebhookEvent,
  validateRevenueCatWebhookAuthorization,
} from '@/lib/revenuecat-server';
import {
  claimProcessedWebhookAndSyncSubscription,
  resolveLocalUserIdFromRevenueCatCandidates,
} from '@/lib/subscription-sync';

const acknowledge = (payload: Record<string, unknown>) =>
  NextResponse.json({
    ok: true,
    ...payload,
  });

const markWebhookProcessedWithoutMutation = async (
  eventId: string,
  admin = createSupabaseAdmin()
) => {
  const { error } = await admin
    .from('processed_webhooks')
    .insert({ id: eventId });

  if (error && error.code !== '23505') {
    throw error;
  }

  return error?.code === '23505';
};

export async function POST(request: Request) {
  const authorization = validateRevenueCatWebhookAuthorization(request);
  if (!authorization.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: authorization.message,
      },
      { status: authorization.status }
    );
  }

  const event = (await request.json().catch(() => null)) as RevenueCatWebhookEvent | null;
  const eventId = String(event?.id ?? '').trim();
  if (!eventId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Missing RevenueCat webhook event id.',
      },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdmin();
  const candidates = event ? collectRevenueCatCustomerCandidates(event) : [];

  if (candidates.length === 0) {
    const alreadyProcessed = await markWebhookProcessedWithoutMutation(eventId, admin);
    return acknowledge({
      alreadyProcessed,
      reason: 'no_customer_candidates',
    });
  }

  const userId = await resolveLocalUserIdFromRevenueCatCandidates(admin, candidates);

  let subscriberPayload = null;
  for (const candidate of candidates) {
    subscriberPayload = await fetchRevenueCatSubscriber(candidate);
    if (subscriberPayload) {
      break;
    }
  }

  if (!userId) {
    const alreadyProcessed = await markWebhookProcessedWithoutMutation(eventId, admin);
    return acknowledge({
      alreadyProcessed,
      reason: 'local_user_not_found',
    });
  }

  const canonicalState = deriveCanonicalRevenueCatState(subscriberPayload);
  const result = await claimProcessedWebhookAndSyncSubscription({
    admin,
    eventId,
    userId,
    canonicalState,
  });

  return acknowledge({
    alreadyProcessed: result.alreadyProcessed,
    userId,
    subscribedOrgId: result.subscribedOrgId,
  });
}
