import { NextResponse } from 'next/server';

import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { rateLimit } from '@/lib/rate-limit';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  collectRevenueCatCustomerCandidates,
  deriveCanonicalRevenueCatState,
  fetchRevenueCatSubscriber,
  type CanonicalRevenueCatState,
  type RevenueCatWebhookEvent,
  validateRevenueCatWebhookAuthorization,
} from '@/lib/revenuecat-server';
import {
  claimProcessedWebhookAndSyncSubscription,
  getUserSubscriptionSummary,
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toCanonicalPaidStatus = (
  status?: string | null
): CanonicalRevenueCatState['subscriptionStatus'] =>
  status === 'grace_period' || status === 'billing_retry' || status === 'expired' || status === 'cancelled'
    ? status
    : 'active';

export async function POST(request: Request) {
  try {
    const ipLimiter = rateLimit(`revenuecat-webhook:${getRequestIp(request.headers)}`, 240, 60_000);
    if (!ipLimiter.allowed) {
      return rateLimitExceededResponse(ipLimiter, 'Too many webhook requests. Please slow down.');
    }

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

    const event =
      body && typeof body === 'object' && 'event' in body
        ? ((body as RevenueCatWebhookPayload).event ?? null)
        : (body as RevenueCatWebhookEvent | null);
    const eventId = String(event?.id ?? '').trim();

    if (!eventId) {
      console.warn('RevenueCat webhook missing event id.');
      return acknowledge({ reason: 'missing_event_id' });
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

    const previousSubscription = userId ? await getUserSubscriptionSummary(admin, userId) : null;
    let subscriberPayload = null;
    let canonicalState = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      subscriberPayload = null;

      for (const candidate of candidates) {
        try {
          subscriberPayload = await fetchRevenueCatSubscriber(candidate);
        } catch (error) {
          console.warn('RevenueCat subscriber fetch failed during webhook processing.', error);
          subscriberPayload = null;
        }
        if (subscriberPayload) {
          break;
        }
      }

      canonicalState = deriveCanonicalRevenueCatState(subscriberPayload);

      const shouldRetryEmptyPaidState =
        canonicalState.activeProductId === null &&
        canonicalState.subscriptionStatus === 'free' &&
        Boolean(previousSubscription?.activeProductId) &&
        attempt < 2;

      if (!shouldRetryEmptyPaidState) {
        break;
      }

      await sleep(400 * (attempt + 1));
    }

    if (!userId) {
      const alreadyProcessed = await markWebhookProcessedWithoutMutation(eventId, admin);
      return acknowledge({
        alreadyProcessed,
        reason: 'local_user_not_found',
      });
    }

    const stabilizedCanonicalState =
      canonicalState &&
      canonicalState.activeProductId === null &&
      canonicalState.subscriptionStatus === 'free' &&
      previousSubscription?.activeProductId &&
      previousSubscription.currentPeriodEnd &&
      Date.parse(previousSubscription.currentPeriodEnd) > Date.now()
        ? {
            activeProductId: previousSubscription.activeProductId,
            scheduledProductId: canonicalState.scheduledProductId,
            subscriptionStatus: toCanonicalPaidStatus(previousSubscription.subscriptionStatus),
            currentPeriodStart: previousSubscription.currentPeriodStart,
            currentPeriodEnd: previousSubscription.currentPeriodEnd,
            willRenew: previousSubscription.willRenew,
            billingIssueDetectedAt: null,
            gracePeriodExpiresAt: null,
            managementUrl: canonicalState.managementUrl,
          }
        : canonicalState;

    if (
      canonicalState &&
      stabilizedCanonicalState &&
      canonicalState.activeProductId !== stabilizedCanonicalState.activeProductId
    ) {
      console.warn('RevenueCat webhook preserved a previous paid state after an empty subscriber response.');
    }

    const result = await claimProcessedWebhookAndSyncSubscription({
      admin,
      eventId,
      userId,
      canonicalState: stabilizedCanonicalState ?? {
        activeProductId: null,
        scheduledProductId: null,
        subscriptionStatus: 'free',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        willRenew: false,
        billingIssueDetectedAt: null,
        gracePeriodExpiresAt: null,
        managementUrl: null,
      },
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
