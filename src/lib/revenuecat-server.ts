import { REVENUECAT_ENTITLEMENT_ID, getPaidPlanByProductId, type PaidPlanId } from '@/lib/pricing';

export type RevenueCatWebhookEvent = {
  id?: string | null;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  aliases?: string[] | null;
  type?: string | null;
};

export type RevenueCatSubscriberResponse = {
  subscriber?: {
    entitlements?: Record<
      string,
      {
        product_identifier?: string | null;
        expires_date?: string | null;
        grace_period_expires_date?: string | null;
        billing_issues_detected_at?: string | null;
        purchase_date?: string | null;
      }
    >;
    subscriptions?: Record<
      string,
      {
        expires_date?: string | null;
        purchase_date?: string | null;
        original_purchase_date?: string | null;
        billing_issues_detected_at?: string | null;
        grace_period_expires_date?: string | null;
        unsubscribe_detected_at?: string | null;
        store?: string | null;
      }
    >;
    original_app_user_id?: string | null;
    aliases?: string[] | null;
    management_url?: string | null;
  };
};

export type CanonicalRevenueCatState = {
  activeProductId: PaidPlanId | null;
  subscriptionStatus:
    | 'free'
    | 'active'
    | 'grace_period'
    | 'billing_retry'
    | 'expired'
    | 'cancelled';
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  willRenew: boolean;
  billingIssueDetectedAt: string | null;
  gracePeriodExpiresAt: string | null;
  managementUrl: string | null;
};

type KnownSubscriptionSnapshot = {
  productId: PaidPlanId;
  expiresDate: string | null;
  purchaseDate: string | null;
  originalPurchaseDate: string | null;
  billingIssueDetectedAt: string | null;
  gracePeriodExpiresAt: string | null;
  unsubscribeDetectedAt: string | null;
};

const normalizeDate = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const getRevenueCatSecretApiKey = () => process.env.REVENUECAT_SECRET_API_KEY?.trim() ?? '';

export const validateRevenueCatWebhookAuthorization = (request: Request) => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH?.trim();
  if (!expected) {
    return {
      ok: false as const,
      message: 'Missing REVENUECAT_WEBHOOK_AUTH.',
      status: 500,
    };
  }

  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (authorization !== expected && authorization !== `Bearer ${expected}`) {
    return {
      ok: false as const,
      message: 'Unauthorized RevenueCat webhook.',
      status: 401,
    };
  }

  return { ok: true as const };
};

export const collectRevenueCatCustomerCandidates = (event: RevenueCatWebhookEvent) =>
  Array.from(
    new Set(
      [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );

export const fetchRevenueCatSubscriber = async (
  appUserId: string
): Promise<RevenueCatSubscriberResponse | null> => {
  const secretApiKey = getRevenueCatSecretApiKey();
  if (!secretApiKey) {
    throw new Error('Missing REVENUECAT_SECRET_API_KEY.');
  }

  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretApiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`RevenueCat subscriber lookup failed with status ${response.status}.`);
  }

  return (await response.json()) as RevenueCatSubscriberResponse;
};

export const logRevenueCatSubscriberDiagnostics = (
  lookupUserId: string,
  payload: RevenueCatSubscriberResponse | null,
  context: string
) => {
  console.log('RC_LOOKUP_USER_ID:', lookupUserId);
  console.log(`RC_SUBSCRIBER [${context}]:`, JSON.stringify(payload, null, 2));
  console.log(
    `ENTITLEMENTS [${context}]:`,
    JSON.stringify(payload?.subscriber?.entitlements ?? null, null, 2)
  );
};

const getKnownSubscriptionSnapshots = (
  payload: RevenueCatSubscriberResponse | null
): KnownSubscriptionSnapshot[] =>
  Object.entries(payload?.subscriber?.subscriptions ?? {})
    .map(([productId, subscription]) => {
      const resolvedProductId = getPaidPlanByProductId(productId)?.id ?? null;
      if (!resolvedProductId) {
        return null;
      }

      return {
        productId: resolvedProductId,
        expiresDate: normalizeDate(subscription?.expires_date ?? null),
        purchaseDate: normalizeDate(subscription?.purchase_date ?? null),
        originalPurchaseDate: normalizeDate(subscription?.original_purchase_date ?? null),
        billingIssueDetectedAt: normalizeDate(subscription?.billing_issues_detected_at ?? null),
        gracePeriodExpiresAt: normalizeDate(subscription?.grace_period_expires_date ?? null),
        unsubscribeDetectedAt: normalizeDate(subscription?.unsubscribe_detected_at ?? null),
      } satisfies KnownSubscriptionSnapshot;
    })
    .filter((snapshot): snapshot is KnownSubscriptionSnapshot => Boolean(snapshot))
    .sort((left, right) => {
      const leftPriority =
        Date.parse(left.gracePeriodExpiresAt ?? left.expiresDate ?? left.purchaseDate ?? left.originalPurchaseDate ?? '') ||
        0;
      const rightPriority =
        Date.parse(
          right.gracePeriodExpiresAt ?? right.expiresDate ?? right.purchaseDate ?? right.originalPurchaseDate ?? ''
        ) || 0;
      return rightPriority - leftPriority;
    });

export const deriveCanonicalRevenueCatState = (
  payload: RevenueCatSubscriberResponse | null
): CanonicalRevenueCatState => {
  const subscriber = payload?.subscriber;
  const entitlement = subscriber?.entitlements?.[REVENUECAT_ENTITLEMENT_ID];
  const entitlementProductId = getPaidPlanByProductId(entitlement?.product_identifier ?? '')?.id ?? null;
  const knownSubscriptions = getKnownSubscriptionSnapshots(payload);
  const fallbackSubscription = knownSubscriptions[0] ?? null;
  const resolvedProductId = entitlementProductId ?? fallbackSubscription?.productId ?? null;

  if (!resolvedProductId) {
    return {
      activeProductId: null,
      subscriptionStatus: 'free',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      willRenew: false,
      billingIssueDetectedAt: null,
      gracePeriodExpiresAt: null,
      managementUrl: subscriber?.management_url ?? null,
    };
  }

  const subscription = subscriber?.subscriptions?.[resolvedProductId] ?? null;
  const billingIssueDetectedAt = normalizeDate(
    entitlement?.billing_issues_detected_at ?? subscription?.billing_issues_detected_at ?? null
  );
  const gracePeriodExpiresAt = normalizeDate(
    entitlement?.grace_period_expires_date ?? subscription?.grace_period_expires_date ?? null
  );
  const currentPeriodEnd = normalizeDate(entitlement?.expires_date ?? subscription?.expires_date ?? null);
  const currentPeriodStart = normalizeDate(
    entitlement?.purchase_date ?? subscription?.purchase_date ?? subscription?.original_purchase_date ?? null
  );
  const now = Date.now();
  const expiresAtMs = currentPeriodEnd ? Date.parse(currentPeriodEnd) : NaN;
  const unsubscribeDetectedAt = normalizeDate(
    subscription?.unsubscribe_detected_at ?? fallbackSubscription?.unsubscribeDetectedAt ?? null
  );

  let subscriptionStatus: CanonicalRevenueCatState['subscriptionStatus'] = 'active';
  if (currentPeriodEnd && Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
    subscriptionStatus = 'expired';
  } else if (gracePeriodExpiresAt && Date.parse(gracePeriodExpiresAt) > now) {
    subscriptionStatus = 'grace_period';
  } else if (billingIssueDetectedAt) {
    subscriptionStatus = 'billing_retry';
  }

  return {
    activeProductId: resolvedProductId,
    subscriptionStatus,
    currentPeriodStart,
    currentPeriodEnd,
    willRenew: !unsubscribeDetectedAt,
    billingIssueDetectedAt,
    gracePeriodExpiresAt,
    managementUrl: subscriber?.management_url ?? null,
  };
};
