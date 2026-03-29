import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  collectRevenueCatCustomerCandidates,
  deriveCanonicalRevenueCatState,
  fetchRevenueCatSubscriber,
  type CanonicalRevenueCatState,
  type RevenueCatWebhookEvent,
} from '@/lib/revenuecat-server';
import type { UserSubscriptionSummary } from '@/lib/org-subscription';

export type RevenueCatSyncResult = {
  userId: string | null;
  canonicalState: CanonicalRevenueCatState | null;
  subscriberPayloadFound: boolean;
  subscribedOrgId: string | null;
};

const isSubscriptionAssignmentConflict = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = String((error as { code?: unknown }).code ?? '').trim();
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return (
    code === '23505' ||
    message.includes('23505') ||
    message.includes('one_paid_org_per_user') ||
    message.includes('subscription_assignment_conflict') ||
    message.includes('duplicate key value violates unique constraint')
  );
};

const buildSubscriptionConflictError = () =>
  new Error('subscription_assignment_conflict');

async function runSyncUserSubscriptionStateRpc(
  admin: SupabaseClient,
  args: {
    p_user_id: string;
    p_active_product_id: string | null;
    p_subscription_status: string;
    p_period_start: string | null;
    p_period_end: string | null;
    p_will_renew: boolean;
    p_billing_issue_detected_at: string | null;
    p_grace_period_expires_at: string | null;
    p_target_org_id: string | null;
  }
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await admin.rpc('sync_user_subscription_state', args);
    if (!error) {
      return data;
    }

    if (!isSubscriptionAssignmentConflict(error) || attempt === 1) {
      lastError = error;
      break;
    }
  }

  if (isSubscriptionAssignmentConflict(lastError)) {
    throw buildSubscriptionConflictError();
  }

  throw lastError;
}

async function runClaimProcessedWebhookAndSyncSubscriptionRpc(
  admin: SupabaseClient,
  args: {
    p_event_id: string;
    p_user_id: string;
    p_active_product_id: string | null;
    p_subscription_status: string;
    p_period_start: string | null;
    p_period_end: string | null;
    p_will_renew: boolean;
    p_billing_issue_detected_at: string | null;
    p_grace_period_expires_at: string | null;
    p_target_org_id: string | null;
  }
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await admin.rpc(
      'claim_processed_webhook_and_sync_subscription',
      args
    );
    if (!error) {
      return data;
    }

    if (!isSubscriptionAssignmentConflict(error) || attempt === 1) {
      lastError = error;
      break;
    }
  }

  if (isSubscriptionAssignmentConflict(lastError)) {
    throw buildSubscriptionConflictError();
  }

  throw lastError;
}

const mapProfileRowToSummary = (
  row?: Partial<{
    active_subscription_product_id: string | null;
    subscribed_org_id: string | null;
    subscription_status: string | null;
    subscription_current_period_start: string | null;
    subscription_current_period_end: string | null;
    subscription_will_renew: boolean | null;
    has_received_org_creation_bonus: boolean | null;
    org_creation_bonus_granted_at: string | null;
  }> | null
): UserSubscriptionSummary => ({
  activeProductId: (row?.active_subscription_product_id ?? null) as UserSubscriptionSummary['activeProductId'],
  subscribedOrgId: row?.subscribed_org_id ?? null,
  subscriptionStatus: (row?.subscription_status ?? 'free') as UserSubscriptionSummary['subscriptionStatus'],
  currentPeriodStart: row?.subscription_current_period_start ?? null,
  currentPeriodEnd: row?.subscription_current_period_end ?? null,
  willRenew: Boolean(row?.subscription_will_renew),
  hasReceivedOrgCreationBonus: Boolean(row?.has_received_org_creation_bonus),
  bonusGrantedAt: row?.org_creation_bonus_granted_at ?? null,
});

export const getUserSubscriptionSummary = async (
  admin: SupabaseClient,
  userId: string
): Promise<UserSubscriptionSummary> => {
  const { data, error } = await admin
    .from('profiles')
    .select(
      'active_subscription_product_id, subscribed_org_id, subscription_status, subscription_current_period_start, subscription_current_period_end, subscription_will_renew, has_received_org_creation_bonus, org_creation_bonus_granted_at'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return mapProfileRowToSummary(data);
};

export const resolveLocalUserIdFromRevenueCatCandidates = async (
  admin: SupabaseClient,
  candidates: string[]
) => {
  for (const candidate of candidates) {
    const { data } = await admin
      .from('profiles')
      .select('id')
      .eq('id', candidate)
      .maybeSingle();
    if (data?.id) {
      return data.id;
    }
  }

  return null;
};

type SyncOptions = {
  admin?: SupabaseClient;
  appUserId?: string | null;
  webhookEvent?: RevenueCatWebhookEvent;
  targetOrgId?: string | null;
};

type ClaimAndSyncWebhookOptions = {
  admin?: SupabaseClient;
  eventId: string;
  userId: string;
  canonicalState: CanonicalRevenueCatState;
  targetOrgId?: string | null;
};

export const syncRevenueCatSubscriber = async ({
  admin = createSupabaseAdmin(),
  appUserId = null,
  webhookEvent,
  targetOrgId = null,
}: SyncOptions): Promise<RevenueCatSyncResult> => {
  const candidates = webhookEvent
    ? collectRevenueCatCustomerCandidates(webhookEvent)
    : appUserId
      ? [appUserId]
      : [];

  if (candidates.length === 0) {
    return {
      userId: null,
      canonicalState: null,
      subscriberPayloadFound: false,
      subscribedOrgId: null,
    };
  }

  const userId = await resolveLocalUserIdFromRevenueCatCandidates(admin, candidates);
  if (!userId) {
    return {
      userId: null,
      canonicalState: null,
      subscriberPayloadFound: false,
      subscribedOrgId: null,
    };
  }

  let subscriberPayload = null;
  for (const candidate of candidates) {
    subscriberPayload = await fetchRevenueCatSubscriber(candidate);
    if (subscriberPayload) {
      break;
    }
  }

  const canonicalState = deriveCanonicalRevenueCatState(subscriberPayload);
  const data = await runSyncUserSubscriptionStateRpc(admin, {
    p_user_id: userId,
    p_active_product_id: canonicalState.activeProductId,
    p_subscription_status: canonicalState.subscriptionStatus,
    p_period_start: canonicalState.currentPeriodStart,
    p_period_end: canonicalState.currentPeriodEnd,
    p_will_renew: canonicalState.willRenew,
    p_billing_issue_detected_at: canonicalState.billingIssueDetectedAt,
    p_grace_period_expires_at: canonicalState.gracePeriodExpiresAt,
    p_target_org_id: targetOrgId,
  });

  const syncRow =
    Array.isArray(data) && data.length > 0
      ? (data[0] as { subscribed_org_id?: string | null })
      : ((data ?? {}) as { subscribed_org_id?: string | null });

  return {
    userId,
    canonicalState,
    subscriberPayloadFound: Boolean(subscriberPayload),
    subscribedOrgId: syncRow?.subscribed_org_id ?? null,
  };
};

export const claimProcessedWebhookAndSyncSubscription = async ({
  admin = createSupabaseAdmin(),
  eventId,
  userId,
  canonicalState,
  targetOrgId = null,
}: ClaimAndSyncWebhookOptions) => {
  const data = await runClaimProcessedWebhookAndSyncSubscriptionRpc(admin, {
    p_event_id: eventId,
    p_user_id: userId,
    p_active_product_id: canonicalState.activeProductId,
    p_subscription_status: canonicalState.subscriptionStatus,
    p_period_start: canonicalState.currentPeriodStart,
    p_period_end: canonicalState.currentPeriodEnd,
    p_will_renew: canonicalState.willRenew,
    p_billing_issue_detected_at: canonicalState.billingIssueDetectedAt,
    p_grace_period_expires_at: canonicalState.gracePeriodExpiresAt,
    p_target_org_id: targetOrgId,
  });

  const row =
    Array.isArray(data) && data.length > 0
      ? (data[0] as {
          already_processed?: boolean;
          subscribed_org_id?: string | null;
        })
      : ((data ?? {}) as {
          already_processed?: boolean;
          subscribed_org_id?: string | null;
        });

  return {
    alreadyProcessed: Boolean(row?.already_processed),
    subscribedOrgId: row?.subscribed_org_id ?? null,
  };
};
