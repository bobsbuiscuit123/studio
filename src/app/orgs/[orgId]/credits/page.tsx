'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { safeFetchJson } from '@/lib/network';
import { useOrgSubscriptionStatus, notifyOrgSubscriptionChanged } from '@/lib/org-subscription-hooks';
import type { Result } from '@/lib/result';
import {
  extractActiveProductIdFromCustomerInfo,
  extractCurrentPeriodEndFromCustomerInfo,
  extractScheduledProductIdFromCustomerInfo,
  getCurrentRevenueCatCustomerInfo,
  getRevenueCatManagementUrl,
  resolveRevenueCatPackageForPlan,
  getSubscriptionPurchaseAvailability,
  loadRevenueCatPlanPackages,
  purchaseRevenueCatPlan,
  RevenueCatPurchaseCancelledError,
  type RevenueCatPlanPackage,
} from '@/lib/revenuecat-subscriptions';
import {
  PAID_PRODUCT_IDS,
  REVENUECAT_ENTITLEMENT_ID,
  getPaidPlanByProductId,
  getPlanById,
  getPlanRecommendation,
  type PaidPlanId,
} from '@/lib/pricing';
import {
  resolvePaidPlanActionDecision,
  type UserSubscriptionSummary,
} from '@/lib/org-subscription';

type ReconcileResponse = {
  ok: boolean;
  data?: UserSubscriptionSummary;
};

type TransferResponse = {
  ok: true;
  data?: {
    subscribedOrgId: string | null;
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getPaidPlanTierIndex = (planId: PaidPlanId | null) =>
  planId ? PAID_PRODUCT_IDS.indexOf(planId) : -1;

type PersistedScheduledPlanChange = {
  currentPlanId: PaidPlanId;
  scheduledPlanId: PaidPlanId;
  effectiveDate: string;
};

const getScheduledPlanStorageKey = (orgId: string) => `caspo:scheduled-plan-change:${orgId}`;

const readPersistedScheduledPlanChange = (
  orgId: string
): PersistedScheduledPlanChange | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(getScheduledPlanStorageKey(orgId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedScheduledPlanChange;
    if (
      parsed &&
      getPaidPlanByProductId(parsed.currentPlanId)?.id === parsed.currentPlanId &&
      getPaidPlanByProductId(parsed.scheduledPlanId)?.id === parsed.scheduledPlanId &&
      formatSubscriptionDate(parsed.effectiveDate)
    ) {
      return parsed;
    }
  } catch (error) {
    console.warn('Unable to parse persisted scheduled plan change', error);
  }

  window.localStorage.removeItem(getScheduledPlanStorageKey(orgId));
  return null;
};

const writePersistedScheduledPlanChange = (
  orgId: string,
  value: PersistedScheduledPlanChange
) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(getScheduledPlanStorageKey(orgId), JSON.stringify(value));
};

const clearPersistedScheduledPlanChange = (orgId: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(getScheduledPlanStorageKey(orgId));
};

const formatSubscriptionDate = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function OrgCreditsPage() {
  const params = useParams<{ orgId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const orgId = typeof params.orgId === 'string' ? params.orgId : null;
  const purchaseAvailability = useMemo(() => getSubscriptionPurchaseAvailability(), []);
  const { status, loading, refresh } = useOrgSubscriptionStatus(orgId);

  const [userSubscription, setUserSubscription] = useState<UserSubscriptionSummary | null>(null);
  const [liveCustomerActiveProductId, setLiveCustomerActiveProductId] = useState<PaidPlanId | null>(
    null
  );
  const [liveCustomerScheduledProductId, setLiveCustomerScheduledProductId] = useState<PaidPlanId | null>(
    null
  );
  const [liveCustomerCurrentPeriodEnd, setLiveCustomerCurrentPeriodEnd] = useState<string | null>(
    null
  );
  const [persistedScheduledChange, setPersistedScheduledChange] =
    useState<PersistedScheduledPlanChange | null>(null);
  const [planPackages, setPlanPackages] = useState<Record<string, RevenueCatPlanPackage>>({});
  const [selectedPlanId, setSelectedPlanId] = useState<PaidPlanId | null>(null);
  const [hasUserSelectedPlan, setHasUserSelectedPlan] = useState(false);
  const [managementUrl, setManagementUrl] = useState<string | null>(null);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const recommendedPlan = useMemo(
    () => getPlanRecommendation(status?.usageEstimateMonthlyTokens ?? 0),
    [status?.usageEstimateMonthlyTokens]
  );
  const backendActiveProductId =
    userSubscription?.activeProductId ?? status?.subscriptionProductId ?? null;
  const activeProductId = backendActiveProductId ?? liveCustomerActiveProductId ?? null;
  const ownerHasKnownActiveSubscription =
    Boolean(activeProductId) || Boolean(status?.ownerHasActiveSubscription);

  useEffect(() => {
    if (!orgId || !status?.canManageBilling) {
      return;
    }

    let active = true;
    const loadContext = async () => {
      const [reconcileResult, packageList, rcManagementUrl, liveRevenueCatCustomerInfo] =
        await Promise.all([
          safeFetchJson<ReconcileResponse>('/api/orgs/subscription/reconcile', {
            method: 'POST',
          }),
          purchaseAvailability.supported
            ? loadRevenueCatPlanPackages().catch(() => [])
            : Promise.resolve([]),
          purchaseAvailability.supported
            ? getRevenueCatManagementUrl().catch(() => null)
            : Promise.resolve(null),
          purchaseAvailability.supported
            ? getCurrentRevenueCatCustomerInfo().catch((error) => {
                console.warn('Failed to load live RevenueCat customer info for billing page', error);
                return null;
              })
            : Promise.resolve(null),
        ]);

      if (!active) return;

      if (reconcileResult.ok) {
        setUserSubscription(reconcileResult.data.data ?? null);
      }

      setLiveCustomerActiveProductId(
        liveRevenueCatCustomerInfo ? extractActiveProductIdFromCustomerInfo(liveRevenueCatCustomerInfo) : null
      );
      setLiveCustomerScheduledProductId(
        liveRevenueCatCustomerInfo
          ? extractScheduledProductIdFromCustomerInfo(liveRevenueCatCustomerInfo)
          : null
      );
      setLiveCustomerCurrentPeriodEnd(
        liveRevenueCatCustomerInfo
          ? extractCurrentPeriodEndFromCustomerInfo(liveRevenueCatCustomerInfo)
          : null
      );
      setPlanPackages(
        packageList.reduce<Record<string, RevenueCatPlanPackage>>((acc, item) => {
          acc[item.id] = item;
          return acc;
        }, {})
      );
      setManagementUrl(rcManagementUrl);
      setLoadingPackages(false);
    };

    setLoadingPackages(true);
    void loadContext();
    return () => {
      active = false;
    };
  }, [orgId, purchaseAvailability.supported, status?.canManageBilling]);

  useEffect(() => {
    if (!orgId) {
      setPersistedScheduledChange(null);
      return;
    }

    setPersistedScheduledChange(readPersistedScheduledPlanChange(orgId));
  }, [orgId]);

  useEffect(() => {
    if (hasUserSelectedPlan) {
      return;
    }

    if (activeProductId) {
      setSelectedPlanId(activeProductId);
      return;
    }

    if (ownerHasKnownActiveSubscription) {
      setSelectedPlanId(null);
      return;
    }

    setSelectedPlanId(recommendedPlan.id as PaidPlanId);
  }, [activeProductId, hasUserSelectedPlan, ownerHasKnownActiveSubscription, recommendedPlan.id]);

  useEffect(() => {
    setHasUserSelectedPlan(false);
    setSelectedPlanId(null);
  }, [orgId]);

  const selectedPlan = selectedPlanId ? getPlanById(selectedPlanId) : recommendedPlan;
  const userSubscribedOrg = userSubscription?.subscribedOrgId ?? status?.subscribedOrgId ?? null;
  const hasActiveSubscription =
    Boolean(userSubscription?.activeProductId) ||
    Boolean(status?.ownerHasActiveSubscription) ||
    Boolean(activeProductId);
  const scheduledProductId =
    userSubscription?.scheduledProductId ??
    liveCustomerScheduledProductId ??
    (persistedScheduledChange?.currentPlanId === activeProductId
      ? persistedScheduledChange?.scheduledPlanId
      : null) ??
    status?.scheduledProductId ??
    null;
  const scheduledEffectiveDate =
    userSubscription?.currentPeriodEnd ??
    liveCustomerCurrentPeriodEnd ??
    (persistedScheduledChange?.currentPlanId === activeProductId
      ? persistedScheduledChange?.effectiveDate
      : null) ??
    status?.currentPeriodEnd ??
    null;
  const formattedScheduledEffectiveDate = formatSubscriptionDate(scheduledEffectiveDate);
  const isScheduledDowngrade = Boolean(
    activeProductId &&
      scheduledProductId &&
      scheduledProductId !== activeProductId &&
      getPaidPlanTierIndex(scheduledProductId) >= 0 &&
      getPaidPlanTierIndex(activeProductId) >= 0 &&
      getPaidPlanTierIndex(scheduledProductId) < getPaidPlanTierIndex(activeProductId)
  );
  const scheduledPlanName = scheduledProductId ? getPlanById(scheduledProductId).name : null;
  const currentDisplayedPlanName = activeProductId
    ? getPlanById(activeProductId).name
    : status?.planName ?? 'Free';

  useEffect(() => {
    if (!orgId) {
      return;
    }

    if (!persistedScheduledChange) {
      clearPersistedScheduledPlanChange(orgId);
      return;
    }

    const effectiveAt = Date.parse(persistedScheduledChange.effectiveDate);
    const shouldClear =
      !activeProductId ||
      activeProductId === persistedScheduledChange.scheduledPlanId ||
      (Number.isFinite(effectiveAt) && effectiveAt <= Date.now() && activeProductId !== persistedScheduledChange.currentPlanId);

    if (shouldClear) {
      clearPersistedScheduledPlanChange(orgId);
      setPersistedScheduledChange(null);
    }
  }, [activeProductId, orgId, persistedScheduledChange]);

  if (!orgId) {
    return null;
  }

  if (!loading && status?.role !== 'owner') {
    return (
      <div className="viewport-page bg-background">
        <div className="viewport-scroll mx-auto flex w-full max-w-3xl items-center justify-center px-4 py-8">
          <Card className="w-full rounded-[28px]">
            <CardHeader>
              <CardTitle>Billing unavailable</CardTitle>
              <CardDescription>
                Only the organization owner can manage subscription settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push('/orgs')} className="rounded-2xl">
                Back to organizations
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const purchaseDecision = resolvePaidPlanActionDecision({
    hasActiveSubscription,
    subscribedOrgId: userSubscribedOrg,
    currentOrgId: orgId,
    selectedPlanId,
    liveActiveProductId: activeProductId,
  });

  const actionLabel = (() => {
    if (!selectedPlanId) return 'Select a plan';
    if (purchaseDecision.crossOrgBlocked) {
      return 'Subscription on another organization';
    }
    if (purchaseDecision.unassignedSubscriptionRequiresReconcile) {
      return 'Restore purchases first';
    }
    if (purchaseDecision.sameOrgSamePlan) {
      return 'Current plan active';
    }
    if (purchaseDecision.sameOrgUpgradeAllowed) {
      return 'Change plan';
    }
    return 'Activate subscription on this organization';
  })();

  const reconcileSubscription = async () => {
    const response = await safeFetchJson<ReconcileResponse>('/api/orgs/subscription/reconcile', {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    const nextSubscription = response.data.data ?? null;
    setUserSubscription(nextSubscription);
    return nextSubscription;
  };

  const showPlanChangeSubmittedToast = (options: {
    selectedPlanName: string;
    activeProductId: PaidPlanId | null;
    scheduledProductId: PaidPlanId | null;
    effectiveDate: string | null;
    hasActiveEntitlement: boolean;
  }) => {
    const currentPlanName = options.activeProductId ? getPlanById(options.activeProductId).name : null;
    const formattedEffectiveDate = formatSubscriptionDate(options.effectiveDate);
    const isDowngrade =
      Boolean(
        options.activeProductId &&
          options.scheduledProductId &&
          options.activeProductId !== options.scheduledProductId &&
          getPaidPlanTierIndex(options.scheduledProductId) < getPaidPlanTierIndex(options.activeProductId)
      );

    toast({
      title: isDowngrade ? 'Plan change scheduled' : 'Plan change submitted',
      description:
        isDowngrade && formattedEffectiveDate && currentPlanName
          ? `You are currently on ${currentPlanName}. Your plan will change to ${options.selectedPlanName} on ${formattedEffectiveDate}.`
          : options.activeProductId && options.activeProductId !== selectedPlanId
            ? `${currentPlanName} remains active for now. Apple will apply ${options.selectedPlanName} according to its subscription rules.`
          : options.hasActiveEntitlement
            ? `${options.selectedPlanName} was purchased and is still syncing to the backend. Check again shortly.`
            : `${options.selectedPlanName} was submitted to Apple. The updated subscription state may take a moment to appear in the app.`,
    });
  };

  const maybePersistScheduledDowngrade = (options: {
    currentPlanId: PaidPlanId | null;
    scheduledPlanId: PaidPlanId | null;
    effectiveDate: string | null;
  }) => {
    if (
      !orgId ||
      !options.currentPlanId ||
      !options.scheduledPlanId ||
      !options.effectiveDate ||
      getPaidPlanTierIndex(options.scheduledPlanId) >= getPaidPlanTierIndex(options.currentPlanId)
    ) {
      return;
    }

    const value: PersistedScheduledPlanChange = {
      currentPlanId: options.currentPlanId,
      scheduledPlanId: options.scheduledPlanId,
      effectiveDate: options.effectiveDate,
    };

    writePersistedScheduledPlanChange(orgId, value);
    setPersistedScheduledChange(value);
  };

  const syncCurrentOrg = async (expectedPlanId?: PaidPlanId | null) => {
    let lastSubscribedOrgId: string | null = null;
    let lastStatus = status;
    let lastSubscription = userSubscription;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const transferResult: Result<TransferResponse> = await safeFetchJson<TransferResponse>(
        '/api/orgs/subscription/transfer',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetOrgId: orgId }),
        }
      );

      if (!transferResult.ok) {
        throw new Error(transferResult.error.message);
      }

      lastSubscribedOrgId = transferResult.data.data?.subscribedOrgId ?? null;
      notifyOrgSubscriptionChanged();
      lastStatus = await refresh({ force: true });
      lastSubscription = await reconcileSubscription();

      const observedPlanId =
        lastStatus?.subscriptionProductId ?? lastSubscription?.activeProductId ?? null;
      const orgIsLinked =
        lastSubscribedOrgId === orgId || Boolean(lastStatus?.isSubscribedOrg);

      if (orgIsLinked && (!expectedPlanId || observedPlanId === expectedPlanId)) {
        return {
          subscribedOrgId: lastSubscribedOrgId,
          status: lastStatus,
          subscription: lastSubscription,
        };
      }

      if (attempt < 3) {
        await sleep(500 * (attempt + 1));
      }
    }

    return {
      subscribedOrgId: lastSubscribedOrgId,
      status: lastStatus,
      subscription: lastSubscription,
    };
  };

  const handleApplyPlan = async () => {
    if (!selectedPlanId) {
      return;
    }

    let purchaseAttempted = false;
    setSubmitting(true);
    try {
      let liveActiveProductId = activeProductId;
      let purchaseSucceeded = false;
      let postPurchaseActiveProductId: PaidPlanId | null = null;
      let postPurchaseHasActiveEntitlement = false;
      let postPurchaseEffectiveDate: string | null = null;
      if (purchaseAvailability.supported) {
        try {
          const customerInfo = await getCurrentRevenueCatCustomerInfo();
          const resolvedLiveProductId =
            extractActiveProductIdFromCustomerInfo(customerInfo) ?? liveActiveProductId;
          console.log('RC_PLAN_PREFLIGHT [billing]:', {
            selectedPlanId,
            backendActiveProductId,
            liveActiveProductId: resolvedLiveProductId,
            activeSubscriptions: customerInfo.activeSubscriptions,
            subscriptionKeys: Object.keys(customerInfo.subscriptionsByProductIdentifier ?? {}),
          });
          liveActiveProductId = resolvedLiveProductId;
        } catch (error) {
          console.warn('Unable to load live RevenueCat customer info before applying plan', error);
        }
      }

      const effectiveHasActiveSubscription = hasActiveSubscription || Boolean(liveActiveProductId);
      const decision = resolvePaidPlanActionDecision({
        hasActiveSubscription: effectiveHasActiveSubscription,
        subscribedOrgId: userSubscribedOrg,
        currentOrgId: orgId,
        selectedPlanId,
        liveActiveProductId,
      });

      console.log('ORG_PAID_ACTION_DECISION [billing]', {
        userSubscribedOrg: decision.userSubscribedOrg,
        currentOrg: decision.currentOrgId,
        hasActiveSubscription: decision.hasActiveSubscription,
        selectedPlanId: decision.selectedPlanId,
        liveActiveProductId: decision.liveActiveProductId,
      });

      if (decision.crossOrgBlocked) {
        throw new Error(
          'You already have a subscription on another organization. Paid plan changes are only allowed on that organization.'
        );
      }

      if (decision.unassignedSubscriptionRequiresReconcile) {
        throw new Error(
          'We found an active subscription that is not yet assigned to an organization. Restore purchases from Settings before changing plans.'
        );
      }

      if (decision.sameOrgSamePlan) {
        await syncCurrentOrg(selectedPlanId);
        toast({
          title: 'Current plan active',
          description: `${selectedPlan.name} is already assigned to ${status?.orgName ?? 'this organization'}.`,
        });
        return;
      }

      const needsPurchase = decision.sameOrgUpgradeAllowed || decision.newPurchaseAllowed;

      if (needsPurchase) {
        if (!purchaseAvailability.supported) {
          throw new Error(purchaseAvailability.reason || 'Purchases are unavailable on this device.');
        }
        const { selectedPackage, availableProductIds } = await resolveRevenueCatPackageForPlan(
          selectedPlanId
        );
        console.log('SELECTED PLAN:', selectedPlanId);
        console.log('PACKAGE IDENTIFIER:', selectedPackage?.product?.identifier ?? null);
        console.log('AVAILABLE PACKAGES:', availableProductIds);
        if (!selectedPackage) {
          throw new Error('The selected subscription plan is not available from RevenueCat.');
        }
        const selectedPackageProductId =
          getPaidPlanByProductId(selectedPackage.product.identifier)?.id ?? null;
        if (selectedPackageProductId === liveActiveProductId) {
          console.warn('Attempted to repurchase same product — blocking', {
            selectedPlanId,
            selectedPackageProductId,
            liveActiveProductId,
          });
          await syncCurrentOrg(selectedPlanId);
          toast({
            title: 'Current plan active',
            description: `${selectedPlan.name} is already the active subscription for ${status?.orgName ?? 'this organization'}.`,
          });
          return;
        }
        purchaseAttempted = true;
        const outcome = await purchaseRevenueCatPlan(selectedPackage);
        purchaseSucceeded = true;

        const refreshedCustomerInfo = await getCurrentRevenueCatCustomerInfo().catch((error) => {
          console.warn('Unable to refresh RevenueCat customer info after purchase', error);
          return outcome.customerInfo;
        });

        const activeEntitlement =
          (refreshedCustomerInfo.entitlements.active?.[REVENUECAT_ENTITLEMENT_ID] ??
            refreshedCustomerInfo.entitlements.all?.[REVENUECAT_ENTITLEMENT_ID] ??
            null) as { expirationDate?: string | null } | null;

        postPurchaseActiveProductId = extractActiveProductIdFromCustomerInfo(refreshedCustomerInfo);
        postPurchaseHasActiveEntitlement = Boolean(activeEntitlement);
        postPurchaseEffectiveDate = activeEntitlement?.expirationDate ?? null;
        maybePersistScheduledDowngrade({
          currentPlanId: postPurchaseActiveProductId,
          scheduledPlanId: selectedPlanId,
          effectiveDate: postPurchaseEffectiveDate,
        });
      }

      let syncResult;
      try {
        syncResult = await syncCurrentOrg(selectedPlanId);
      } catch (error) {
        if (purchaseSucceeded) {
          showPlanChangeSubmittedToast({
            selectedPlanName: selectedPlan.name,
            activeProductId: postPurchaseActiveProductId,
            scheduledProductId: selectedPlanId,
            effectiveDate: postPurchaseEffectiveDate,
            hasActiveEntitlement: postPurchaseHasActiveEntitlement,
          });
          return;
        }

        throw error;
      }

      const observedPlanId =
        syncResult.status?.subscriptionProductId ?? syncResult.subscription?.activeProductId ?? null;
      const orgIsLinked =
        syncResult.subscribedOrgId === orgId || Boolean(syncResult.status?.isSubscribedOrg);

      if (!orgIsLinked) {
        if (purchaseSucceeded) {
          showPlanChangeSubmittedToast({
            selectedPlanName: selectedPlan.name,
            activeProductId: postPurchaseActiveProductId ?? observedPlanId,
            scheduledProductId: selectedPlanId,
            effectiveDate:
              postPurchaseEffectiveDate ??
              syncResult.subscription?.currentPeriodEnd ??
              syncResult.status?.currentPeriodEnd ??
              null,
            hasActiveEntitlement: postPurchaseHasActiveEntitlement,
          });
          maybePersistScheduledDowngrade({
            currentPlanId: postPurchaseActiveProductId ?? observedPlanId,
            scheduledPlanId: selectedPlanId,
            effectiveDate:
              postPurchaseEffectiveDate ??
              syncResult.subscription?.currentPeriodEnd ??
              syncResult.status?.currentPeriodEnd ??
              null,
          });
          return;
        }

        throw new Error('The subscription is active, but it is not yet linked to this organization.');
      }

      if (observedPlanId !== selectedPlanId) {
        showPlanChangeSubmittedToast({
          selectedPlanName: selectedPlan.name,
          activeProductId: observedPlanId ?? postPurchaseActiveProductId,
          scheduledProductId: selectedPlanId,
          effectiveDate:
            postPurchaseEffectiveDate ??
            syncResult.subscription?.currentPeriodEnd ??
            syncResult.status?.currentPeriodEnd ??
            null,
          hasActiveEntitlement: postPurchaseHasActiveEntitlement,
        });
        maybePersistScheduledDowngrade({
          currentPlanId: observedPlanId ?? postPurchaseActiveProductId,
          scheduledPlanId: selectedPlanId,
          effectiveDate:
            postPurchaseEffectiveDate ??
            syncResult.subscription?.currentPeriodEnd ??
            syncResult.status?.currentPeriodEnd ??
            null,
        });
        return;
      }

      toast({
        title: 'Subscription updated',
        description: `${selectedPlan.name} is now linked to ${status?.orgName ?? 'this organization'}.`,
      });
    } catch (error) {
      if (error instanceof RevenueCatPurchaseCancelledError) {
        toast({
          title: 'Purchase cancelled',
          description: 'The subscription purchase was cancelled before completion.',
        });
      } else {
        toast({
          title: purchaseAttempted ? 'Purchase could not be completed' : 'Plan change unavailable',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenManagement = () => {
    if (!managementUrl) {
      toast({
        title: 'Manage in Apple Settings',
        description:
          'Open Apple ID subscription settings on your device to cancel or manage renewal.',
      });
      return;
    }

    window.open(managementUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="viewport-page bg-background text-slate-900">
      <div className="viewport-scroll mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-3 rounded-2xl px-0 text-slate-600" onClick={() => router.push('/orgs')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to organizations
            </Button>
            <h1 className="text-3xl font-semibold">{status?.orgName ?? 'Organization billing'}</h1>
            <p className="text-sm text-slate-600">
              Manage the subscription assigned to this organization and review current-period usage.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-2xl" onClick={handleOpenManagement}>
              Manage in Apple
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>

        {status?.ownerHasActiveSubscription && !status?.isSubscribedOrg ? (
          <Alert className="rounded-[24px] border-amber-200 bg-amber-50 text-amber-950">
            <AlertTitle>Subscription assigned elsewhere</AlertTitle>
            <AlertDescription>
              Your account already has an active subscription linked to another organization. Paid plan changes are only allowed on that organization.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Current plan</CardDescription>
              <CardTitle className="text-3xl">
                {currentDisplayedPlanName}
                {isScheduledDowngrade && scheduledPlanName && formattedScheduledEffectiveDate ? (
                  <span className="mt-2 block text-sm font-medium text-slate-600">
                    (changes to {scheduledPlanName} on {formattedScheduledEffectiveDate})
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              {isScheduledDowngrade && scheduledPlanName && formattedScheduledEffectiveDate
                ? `You are currently on ${currentDisplayedPlanName}. Your plan will change to ${scheduledPlanName} on ${formattedScheduledEffectiveDate}.`
                : status?.subscriptionStatus === 'free'
                  ? 'No paid subscription assigned'
                  : status?.subscriptionStatus}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Monthly allowance</CardDescription>
              <CardTitle className="text-3xl">
                {Number(status?.monthlyTokenLimit ?? 0).toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">Tokens per billing period</CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Used this period</CardDescription>
              <CardTitle className="text-3xl">
                {Number(status?.tokensUsedThisPeriod ?? 0).toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">Consumed in the current period</CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Remaining</CardDescription>
              <CardTitle className="text-3xl">
                {Number(status?.effectiveAvailableTokens ?? 0).toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              {status?.bonusTokensThisPeriod
                ? `${status.bonusTokensThisPeriod} bonus token(s) included this period`
                : 'Available before the next reset'}
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Current period</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-[24px] bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Period start</span>
                <span className="font-semibold text-slate-900">
                  {status?.currentPeriodStart
                    ? new Date(status.currentPeriodStart).toLocaleDateString()
                    : '—'}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span>Period end</span>
                <span className="font-semibold text-slate-900">
                  {status?.currentPeriodEnd
                    ? new Date(status.currentPeriodEnd).toLocaleDateString()
                    : '—'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Change your plan here</CardTitle>
            {loadingPackages ? <CardDescription>Loading live App Store pricing...</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {PAID_PRODUCT_IDS.map((planId, index) => {
              const plan = getPlanById(planId);
              const resolvedPrice = planPackages[plan.id]?.resolvedPriceLabel ?? plan.priceLabel;
              const isSelected = selectedPlanId === plan.id;
              const isCurrent = activeProductId === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  data-plan-id={planId}
                  onClick={() => {
                    console.log('CLICKED PLAN:', {
                      index,
                      planId,
                      renderedName: plan.name,
                      renderedDescription: plan.description,
                    });
                    setHasUserSelectedPlan(true);
                    setSelectedPlanId(planId);
                  }}
                  className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                    isSelected
                      ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{plan.name}</p>
                        {plan.id === recommendedPlan.id ? <Badge variant="secondary">Recommended</Badge> : null}
                        {isCurrent ? <Badge variant="secondary">Current subscription</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">{resolvedPrice}</p>
                      <p className="text-xs text-slate-500">
                        {plan.monthlyTokenLimit.toLocaleString()} tokens/month
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Apply to this organization</CardTitle>
          </CardHeader>
          <CardContent>
            {!purchaseAvailability.supported ? (
              <p className="mb-3 text-sm text-slate-600">
                {purchaseAvailability.reason ?? 'Paid subscriptions require the iOS app.'}
              </p>
            ) : null}
            <Button
              className="rounded-2xl bg-emerald-600 hover:bg-emerald-700"
              onClick={() => void handleApplyPlan()}
              disabled={
                submitting ||
                !selectedPlanId ||
                purchaseDecision.crossOrgBlocked ||
                purchaseDecision.unassignedSubscriptionRequiresReconcile ||
                purchaseDecision.sameOrgSamePlan ||
                (!purchaseAvailability.supported && (!activeProductId || activeProductId !== selectedPlanId))
              }
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {actionLabel}
            </Button>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
