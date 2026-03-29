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

type RevenueCatWebhookPayload = {
  api_version?: string | null;
  event?: RevenueCatWebhookEvent | null;
};

export async function POST(request: Request) {
  try {
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

    let body: RevenueCatWebhookPayload | RevenueCatWebhookEvent | null = null;
    try {
      body = (await request.json()) as RevenueCatWebhookPayload | RevenueCatWebhookEvent | null;
    } catch (error) {
      console.error('RevenueCat webhook JSON parse error:', error);
      return acknowledge({ reason: 'invalid_json' });
    }

    const authHeader = request.headers.get('authorization');
    console.log('AUTH HEADER:', authHeader ?? '(missing)');
    console.log(
      'EXPECTED:',
      process.env.REVENUECAT_WEBHOOK_AUTH
        ? `Bearer ${process.env.REVENUECAT_WEBHOOK_AUTH}`
        : '(missing REVENUECAT_WEBHOOK_AUTH)'
    );

    const event =
      body && typeof body === 'object' && 'event' in body
        ? ((body as RevenueCatWebhookPayload).event ?? null)
        : (body as RevenueCatWebhookEvent | null);
    const eventId = String(event?.id ?? '').trim();

    console.log('RevenueCat webhook body keys:', body && typeof body === 'object' ? Object.keys(body) : []);
    console.log('Event ID:', eventId || '(missing)');

    if (!eventId) {
      console.warn('RevenueCat webhook missing event id.');
      return acknowledge({ reason: 'missing_event_id' });
    }

    const admin = createSupabaseAdmin();
    const candidates = event ? collectRevenueCatCustomerCandidates(event) : [];
    console.log('Candidates:', candidates);

    if (candidates.length === 0) {
      const alreadyProcessed = await markWebhookProcessedWithoutMutation(eventId, admin);
      return acknowledge({
        alreadyProcessed,
        reason: 'no_customer_candidates',
      });
    }

    const userId = await resolveLocalUserIdFromRevenueCatCandidates(admin, candidates);
    console.log('User ID:', userId ?? '(not found)');

    let subscriberPayload = null;
    for (const candidate of candidates) {
      try {
        subscriberPayload = await fetchRevenueCatSubscriber(candidate);
      } catch (error) {
        console.warn('Subscriber fetch failed:', candidate, error);
        subscriberPayload = null;
      }
      if (subscriberPayload) {
        break;
      }
    }
    console.log('Subscriber payload exists:', Boolean(subscriberPayload));

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
  } catch (error) {
    console.error('WEBHOOK FATAL ERROR:', error);
    return new Response('OK', { status: 200 });
  }
}
