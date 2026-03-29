'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';

import { Logo } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { safeFetchJson } from '@/lib/network';
import { notifyOrgSubscriptionChanged } from '@/lib/org-subscription-hooks';
import {
  resolvePaidPlanActionDecision,
  type OrgBillingMode,
  type UserSubscriptionSummary,
} from '@/lib/org-subscription';
import {
  extractActiveProductIdFromCustomerInfo,
  getCurrentRevenueCatCustomerInfo,
  getSubscriptionPurchaseAvailability,
  loadRevenueCatPlanPackages,
  purchaseRevenueCatPlan,
  RevenueCatPurchaseCancelledError,
  type RevenueCatPlanPackage,
} from '@/lib/revenuecat-subscriptions';
import {
  FREE_PLAN_ID,
  ONE_TIME_FREE_TRIAL_TOKENS,
  SUBSCRIPTION_PLANS,
  calculateUsageEstimate,
  getPlanById,
  getPlanRecommendation,
  type PaidPlanId,
  type PlanId,
} from '@/lib/pricing';
import { clearSelectedGroupId, setSelectedOrgId } from '@/lib/selection';

const MAX_ESTIMATED_MEMBERS = 10_000;
const MAX_ESTIMATED_REQUESTS = 200;

type DraftResponse = {
  ok: boolean;
  data?: {
    draft?: {
      id: string;
      name: string;
      selected_plan_id: string;
      creation_mode: OrgBillingMode;
      usage_estimate_members: number;
      usage_estimate_requests_per_member: number;
      usage_estimate_monthly_tokens: number;
      status: string;
    };
    subscription?: UserSubscriptionSummary;
    paidOrg?: { id: string; name: string } | null;
  };
  error?: { message?: string };
};

type FinalizeResponse = {
  ok: boolean;
  data?: {
    orgId?: string | null;
    joinCode?: string | null;
    planId?: string | null;
    subscriptionStatus?: string | null;
  };
  error?: { message?: string };
};

type CompletedOrgState = {
  orgId: string;
  orgName: string;
  joinCode: string;
  planName: string;
};

const getCreationMode = (
  planId: PlanId,
  subscription: UserSubscriptionSummary | null
): OrgBillingMode => {
  const plan = getPlanById(planId);
  if (plan.isFree) {
    return subscription?.activeProductId ? 'keep_current_paid' : 'free';
  }

  if (!subscription?.activeProductId) {
    return 'purchase';
  }

  return 'purchase';
};

const creationModeLabel = (
  mode: OrgBillingMode,
  options?: { isPlanChange?: boolean }
) => {
  switch (mode) {
    case 'purchase':
      return options?.isPlanChange
        ? 'Change your existing monthly subscription and assign it to this organization.'
        : 'Buy a new monthly subscription for this organization.';
    case 'transfer_subscription':
      return 'Transfer your existing subscription to this organization.';
    case 'keep_current_paid':
      return 'Keep your current organization paid and create this one on the free plan.';
    default:
      return 'Create this organization on the free plan.';
  }
};

export default function OrgCreatePage() {
  const router = useRouter();
  const { toast } = useToast();
  const purchaseAvailability = useMemo(() => getSubscriptionPurchaseAvailability(), []);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [orgName, setOrgName] = useState('');
  const [orgCategory, setOrgCategory] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [estimatedMembers, setEstimatedMembers] = useState(25);
  const [requestsPerMemberPerDay, setRequestsPerMemberPerDay] = useState(2);
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId | null>(null);

  const [subscription, setSubscription] = useState<UserSubscriptionSummary | null>(null);
  const [paidOrg, setPaidOrg] = useState<{ id: string; name: string } | null>(null);
  const [planPackages, setPlanPackages] = useState<Record<string, RevenueCatPlanPackage>>({});

  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [completedOrg, setCompletedOrg] = useState<CompletedOrgState | null>(null);

  const usageEstimate = useMemo(
    () => calculateUsageEstimate(estimatedMembers, requestsPerMemberPerDay),
    [estimatedMembers, requestsPerMemberPerDay]
  );
  const recommendedPlan = useMemo(
    () => getPlanRecommendation(usageEstimate.estimatedMonthlyTokens),
    [usageEstimate.estimatedMonthlyTokens]
  );

  useEffect(() => {
    if (step < 2 || !purchaseAvailability.supported) {
      return;
    }

    let active = true;
    setLoadingPackages(true);
    void loadRevenueCatPlanPackages()
      .then((packages) => {
        if (!active) return;
        setPlanPackages(
          packages.reduce<Record<string, RevenueCatPlanPackage>>((acc, item) => {
            acc[item.id] = item;
            return acc;
          }, {})
        );
      })
      .catch((error) => {
        console.error('Failed to load RevenueCat offerings', error);
      })
      .finally(() => {
        if (active) {
          setLoadingPackages(false);
        }
      });

    return () => {
      active = false;
    };
  }, [purchaseAvailability.supported, step]);

  useEffect(() => {
    if (selectedPlanId) {
      return;
    }

    if (subscription?.activeProductId) {
      setSelectedPlanId(FREE_PLAN_ID);
      return;
    }

    setSelectedPlanId(recommendedPlan.id);
  }, [recommendedPlan.id, selectedPlanId, subscription?.activeProductId]);

  const resolvedPlan = getPlanById(selectedPlanId ?? FREE_PLAN_ID);
  const creationMode = getCreationMode(
    (selectedPlanId ?? FREE_PLAN_ID) as PlanId,
    subscription
  );
  const activeSubscriptionProductId = subscription?.activeProductId ?? null;
  const activeSubscriptionPlan =
    activeSubscriptionProductId ? getPlanById(activeSubscriptionProductId) : null;
  const createPaidActionDecision = resolvePaidPlanActionDecision({
    hasActiveSubscription: Boolean(activeSubscriptionProductId),
    subscribedOrgId: subscription?.subscribedOrgId ?? null,
    currentOrgId: null,
    selectedPlanId: resolvedPlan.isFree ? null : (resolvedPlan.id as PaidPlanId),
    liveActiveProductId: activeSubscriptionProductId,
  });
  const paidPlanBlockedInCreate =
    !resolvedPlan.isFree &&
    (createPaidActionDecision.crossOrgBlocked ||
      createPaidActionDecision.unassignedSubscriptionRequiresReconcile);
  const isChangingExistingSubscription =
    Boolean(activeSubscriptionProductId) &&
    resolvedPlan.id !== FREE_PLAN_ID &&
    resolvedPlan.id !== activeSubscriptionProductId;

  useEffect(() => {
    if (!paidPlanBlockedInCreate) {
      return;
    }

    setSelectedPlanId(FREE_PLAN_ID);
  }, [paidPlanBlockedInCreate]);

  const saveDraft = async (nextPlanId?: PlanId) => {
    setSavingDraft(true);
    const planIdToPersist = nextPlanId ?? selectedPlanId ?? FREE_PLAN_ID;
    const response = await safeFetchJson<DraftResponse>('/api/orgs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(draftId ? { draftId } : {}),
        name: orgName.trim(),
        category: orgCategory.trim(),
        description: orgDescription.trim(),
        usageEstimateMembers: estimatedMembers,
        usageEstimateRequestsPerMember: requestsPerMemberPerDay,
        usageEstimateMonthlyTokens: usageEstimate.estimatedMonthlyTokens,
        selectedPlanId: planIdToPersist,
        creationMode: getCreationMode(planIdToPersist, subscription),
        idempotencyKey,
      }),
      idempotencyKey,
    });
    setSavingDraft(false);
    return response;
  };

  const handleDetailsNext = async () => {
    if (!orgName.trim()) {
      toast({
        title: 'Missing name',
        description: 'Enter an organization name.',
        variant: 'destructive',
      });
      return;
    }

    const response = await saveDraft();
    if (!response.ok || !response.data.data?.draft?.id) {
      toast({
        title: 'Unable to save draft',
        description: response.ok
          ? 'Organization setup could not be saved.'
          : response.error.message,
        variant: 'destructive',
      });
      return;
    }

    setDraftId(response.data.data.draft.id);
    setSubscription(response.data.data.subscription ?? null);
    setPaidOrg(response.data.data.paidOrg ?? null);
    setStep(2);
  };

  const handleReviewNext = async () => {
    if (paidPlanBlockedInCreate) {
      toast({
        title: 'Paid plan unavailable',
        description: createPaidActionDecision.crossOrgBlocked
          ? 'You already have a subscription on another organization. Create this organization on Free or manage the paid plan from the current paid organization.'
          : 'We found an active subscription that is not yet assigned to an organization. Restore purchases from Settings before creating another paid organization.',
        variant: 'destructive',
      });
      return;
    }

    const response = await saveDraft((selectedPlanId ?? FREE_PLAN_ID) as PlanId);
    if (!response.ok) {
      toast({
        title: 'Unable to continue',
        description: response.error.message,
        variant: 'destructive',
      });
      return;
    }

    setSubscription(response.data.data?.subscription ?? subscription);
    setPaidOrg(response.data.data?.paidOrg ?? paidOrg);
    setStep(3);
  };

  const handlePlanSelect = (planId: PlanId) => {
    if (
      planId !== FREE_PLAN_ID &&
      (createPaidActionDecision.crossOrgBlocked ||
        createPaidActionDecision.unassignedSubscriptionRequiresReconcile)
    ) {
      toast({
        title: 'Paid plan unavailable',
        description: createPaidActionDecision.crossOrgBlocked
          ? 'This account already has a subscription on another organization. Paid plan changes are only allowed on that organization.'
          : 'Restore purchases from Settings before choosing a paid plan for a new organization.',
        variant: 'destructive',
      });
      return;
    }

    setSelectedPlanId(planId);
  };

  const finalizeDraft = async (verifiedProductId?: string) => {
    const response = await safeFetchJson<FinalizeResponse>('/api/orgs/create/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId,
        creationMode,
        verifiedProductId,
      }),
      idempotencyKey,
    });

    if (!response.ok || !response.data.data?.orgId || !response.data.data.joinCode) {
      throw new Error(
        response.ok
          ? response.data.error?.message || 'Unable to create organization.'
          : response.error.message
      );
    }

    notifyOrgSubscriptionChanged();
    const finalizedPlanName = getPlanById(response.data.data.planId ?? resolvedPlan.id).name;
    setCompletedOrg({
      orgId: response.data.data.orgId,
      orgName: orgName.trim(),
      joinCode: response.data.data.joinCode,
      planName: finalizedPlanName,
    });
  };

  const handleFinalize = async () => {
    if (!draftId) {
      toast({
        title: 'Missing draft',
        description: 'Save your organization details first.',
        variant: 'destructive',
      });
      return;
    }

    setFinalizing(true);
    try {
      if (paidPlanBlockedInCreate) {
        throw new Error(
          createPaidActionDecision.crossOrgBlocked
            ? 'You already have a subscription on another organization. Create this organization on the free plan or manage the paid plan from the current paid organization.'
            : 'We found an active subscription that is not yet assigned to an organization. Restore purchases from Settings before creating another paid organization.'
        );
      }

      let liveActiveProductId = subscription?.activeProductId ?? null;
      if (purchaseAvailability.supported) {
        try {
          const customerInfo = await getCurrentRevenueCatCustomerInfo();
          const resolvedLiveProductId =
            extractActiveProductIdFromCustomerInfo(customerInfo) ?? liveActiveProductId;
          console.log('RC_PLAN_PREFLIGHT [org-create]:', {
            selectedPlanId: resolvedPlan.id,
            backendActiveProductId: subscription?.activeProductId ?? null,
            liveActiveProductId: resolvedLiveProductId,
            activeSubscriptions: customerInfo.activeSubscriptions,
            subscriptionKeys: Object.keys(customerInfo.subscriptionsByProductIdentifier ?? {}),
          });
          liveActiveProductId = resolvedLiveProductId;
        } catch (error) {
          console.warn('Unable to load live RevenueCat customer info before finalizing org', error);
        }
      }

      if (creationMode !== 'free' && creationMode !== 'keep_current_paid') {
        if (liveActiveProductId === resolvedPlan.id) {
          await finalizeDraft(liveActiveProductId);
          return;
        }
      }

      if (creationMode === 'purchase') {
        if (!purchaseAvailability.supported) {
          throw new Error(purchaseAvailability.reason || 'Purchases are unavailable on this device.');
        }

        const packageForPlan = planPackages[resolvedPlan.id]?.revenueCatPackage ?? null;
        if (!packageForPlan) {
          throw new Error('The selected subscription plan is not available from RevenueCat.');
        }

        const outcome = await purchaseRevenueCatPlan(packageForPlan);
        await finalizeDraft(outcome.productId);
      } else if (creationMode === 'transfer_subscription') {
        if (!liveActiveProductId) {
          throw new Error('No active subscription is available to transfer.');
        }
        await finalizeDraft(liveActiveProductId);
      } else {
        await finalizeDraft(undefined);
      }
    } catch (error) {
      if (error instanceof RevenueCatPurchaseCancelledError) {
        toast({
          title: 'Purchase cancelled',
          description: 'The subscription purchase was cancelled before completion.',
        });
      } else {
        toast({
          title: 'Unable to finish setup',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setFinalizing(false);
    }
  };

  const finishSetup = () => {
    if (!completedOrg) {
      return;
    }

    setSelectedOrgId(completedOrg.orgId);
    clearSelectedGroupId();
    router.push('/clubs');
  };

  const buttonLabel =
    creationMode === 'purchase'
      ? 'Buy and Create Organization'
      : creationMode === 'transfer_subscription'
        ? 'Transfer and Create Organization'
        : 'Create Organization';

  return (
    <div className="viewport-page bg-background text-slate-900">
      <div className="viewport-scroll relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-lg">
              <Logo className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">CASPO</p>
              <h1 className="text-3xl font-semibold">Create organization</h1>
              <p className="text-sm text-slate-600">
                Organization creation now finishes after review and subscription confirmation.
              </p>
            </div>
          </div>
          <Button variant="outline" className="rounded-2xl" onClick={() => router.push('/orgs')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to organizations
          </Button>
        </header>

        <Card className="rounded-[28px] border-0 bg-white/90 shadow-xl backdrop-blur">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              {[1, 2, 3].map((value) => (
                <div key={value} className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full font-semibold ${
                      step >= value ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {step > value ? <Check className="h-4 w-4" /> : value}
                  </div>
                  {value < 3 ? <div className="h-px w-10 bg-slate-200 sm:w-20" /> : null}
                </div>
              ))}
            </div>
            <div>
              <CardTitle className="text-xl">
                {step === 1
                  ? 'Step 1: Organization details'
                  : step === 2
                    ? 'Step 2: Estimate usage and choose a plan'
                    : 'Step 3: Review and confirm'}
              </CardTitle>
              <CardDescription>
                {step === 1
                  ? 'Enter organization details. This does not create the organization yet.'
                  : step === 2
                    ? 'Estimate monthly AI usage and choose how this organization should be billed.'
                    : 'Review the organization details, usage estimate, and billing action before continuing.'}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {step === 1 ? (
              <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="org-name">Organization name</Label>
                    <Input
                      id="org-name"
                      value={orgName}
                      onChange={(event) => setOrgName(event.target.value)}
                      placeholder="e.g. Central High Activities"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-category">Category</Label>
                    <Input
                      id="org-category"
                      value={orgCategory}
                      onChange={(event) => setOrgCategory(event.target.value)}
                      placeholder="School, nonprofit, community, team"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-description">Description</Label>
                    <Textarea
                      id="org-description"
                      value={orgDescription}
                      onChange={(event) => setOrgDescription(event.target.value)}
                      placeholder="Tell members what this organization is about."
                      rows={4}
                    />
                  </div>
                </div>

                <Card className="rounded-[28px] border border-slate-200 bg-slate-50/90 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">What happens next</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-600">
                    <p>1. Save these organization details as a draft.</p>
                    <p>2. Estimate monthly AI usage and choose a subscription plan.</p>
                    <p>3. Review the setup, then buy or transfer the subscription if needed.</p>
                    <p>4. The organization is created only after the final confirmation succeeds.</p>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-6">
                {activeSubscriptionProductId ? (
                  <Alert className="rounded-[24px] border-emerald-200 bg-emerald-50 text-emerald-950">
                    <Sparkles className="h-4 w-4" />
                    <AlertTitle>Paid plans are unavailable for this new organization</AlertTitle>
                    <AlertDescription>
                      {createPaidActionDecision.crossOrgBlocked
                        ? paidOrg?.name
                          ? `Your ${activeSubscriptionPlan?.name ?? 'paid'} subscription is currently linked to ${paidOrg.name}. Paid plan changes are only allowed from that organization's billing screen.`
                          : 'Your account already has an active subscription linked to another organization. Paid plan changes are only allowed from that organization.'
                        : 'We found an active subscription that is not yet assigned to an organization. Restore purchases from Settings before creating another paid organization.'}{' '}
                      You can still create this organization on the free plan.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {!purchaseAvailability.supported ? (
                  <Alert className="rounded-[24px] border-amber-200 bg-amber-50 text-amber-950">
                    <AlertTitle>Paid plans require the iOS app</AlertTitle>
                    <AlertDescription>
                      {purchaseAvailability.reason ??
                        'Apple subscriptions can only be purchased from the iOS app build.'}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label>Expected active members</Label>
                        <span className="text-sm font-semibold text-slate-900">
                          {estimatedMembers.toLocaleString()}
                        </span>
                      </div>
                      <Slider
                        value={[estimatedMembers]}
                        min={1}
                        max={MAX_ESTIMATED_MEMBERS}
                        step={1}
                        onValueChange={(values) => setEstimatedMembers(values[0])}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label>Average AI requests per member per day</Label>
                        <span className="text-sm font-semibold text-slate-900">
                          {requestsPerMemberPerDay}
                        </span>
                      </div>
                      <Slider
                        value={[requestsPerMemberPerDay]}
                        min={0}
                        max={MAX_ESTIMATED_REQUESTS}
                        step={1}
                        onValueChange={(values) => setRequestsPerMemberPerDay(values[0])}
                      />
                    </div>

                    <Card className="rounded-[24px] border border-slate-200 bg-slate-50/80 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Usage estimate</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm text-slate-600">
                        <div className="flex items-center justify-between">
                          <span>Estimated daily usage</span>
                          <span className="font-semibold text-slate-900">
                            {usageEstimate.estimatedDailyTokens.toLocaleString()} tokens
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Estimated monthly usage</span>
                          <span className="font-semibold text-slate-900">
                            {usageEstimate.estimatedMonthlyTokens.toLocaleString()} tokens
                          </span>
                        </div>
                        <p className="pt-2 text-xs text-slate-500">
                          Recommended plan: {recommendedPlan.name}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold">Plans</h2>
                      {loadingPackages ? (
                        <span className="text-xs text-slate-500">Loading live prices...</span>
                      ) : null}
                    </div>
                    {SUBSCRIPTION_PLANS.map((plan) => {
                      const isSelected = resolvedPlan.id === plan.id;
                      const resolvedPrice =
                        planPackages[plan.id]?.resolvedPriceLabel ?? plan.priceLabel;

                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => handlePlanSelect(plan.id)}
                          disabled={
                            plan.id !== FREE_PLAN_ID &&
                            (createPaidActionDecision.crossOrgBlocked ||
                              createPaidActionDecision.unassignedSubscriptionRequiresReconcile)
                          }
                          className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          } ${
                            plan.id !== FREE_PLAN_ID &&
                            (createPaidActionDecision.crossOrgBlocked ||
                              createPaidActionDecision.unassignedSubscriptionRequiresReconcile)
                              ? 'cursor-not-allowed opacity-60'
                              : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-slate-900">{plan.name}</p>
                                {plan.id === recommendedPlan.id && !plan.isFree ? (
                                  <Badge variant="secondary">Recommended</Badge>
                                ) : null}
                                {activeSubscriptionProductId === plan.id ? (
                                  <Badge variant="secondary">Current subscription</Badge>
                                ) : null}
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
                          {plan.isFree ? (
                            <p className="mt-3 text-xs text-emerald-700">
                              Includes a one-time {ONE_TIME_FREE_TRIAL_TOKENS} token trial for your first organization.
                            </p>
                          ) : null}
                          {plan.id !== FREE_PLAN_ID &&
                          (createPaidActionDecision.crossOrgBlocked ||
                            createPaidActionDecision.unassignedSubscriptionRequiresReconcile) ? (
                            <p className="mt-3 text-xs text-slate-500">
                              Paid plans are unavailable while another organization already owns this account's subscription.
                            </p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                <Card className="rounded-[24px] border border-slate-200 bg-slate-50/80 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Organization details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Name</span>
                      <span className="font-semibold text-slate-900">{orgName || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Category</span>
                      <span className="font-semibold text-slate-900">{orgCategory || '—'}</span>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Description</p>
                      <p className="rounded-2xl bg-white px-4 py-3 text-slate-700">
                        {orgDescription || 'No description provided.'}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border border-slate-200 bg-slate-50/80 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Usage and plan review</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Estimated active members</span>
                      <span className="font-semibold text-slate-900">{estimatedMembers.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Estimated requests per member/day</span>
                      <span className="font-semibold text-slate-900">{requestsPerMemberPerDay}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Estimated monthly usage</span>
                      <span className="font-semibold text-slate-900">
                        {usageEstimate.estimatedMonthlyTokens.toLocaleString()} tokens
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Selected plan</span>
                      <span className="font-semibold text-slate-900">{resolvedPlan.name}</span>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Final action</p>
                      <p className="mt-1 font-medium text-slate-900">
                        {paidPlanBlockedInCreate
                          ? 'Paid plans cannot be used for this new organization while another organization already owns the account subscription.'
                          : creationModeLabel(creationMode, {
                              isPlanChange: isChangingExistingSubscription,
                            })}
                      </p>
                    </div>
                    {resolvedPlan.isFree ? (
                      <p className="rounded-2xl bg-white px-4 py-3 text-xs text-slate-600">
                        {subscription?.hasReceivedOrgCreationBonus
                          ? 'No AI usage is included on the free plan for this account.'
                          : `Your first free organization gets a one-time ${ONE_TIME_FREE_TRIAL_TOKENS} token trial for the first period only.`}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </CardContent>

          <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              {step > 1 ? (
                <Button
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setStep(step === 3 ? 2 : 1)}
                  disabled={savingDraft || finalizing}
                >
                  Back
                </Button>
              ) : null}
            </div>

            {step === 1 ? (
              <Button className="rounded-2xl" onClick={() => void handleDetailsNext()} disabled={savingDraft}>
                {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Next
              </Button>
            ) : null}

            {step === 2 ? (
              <Button className="rounded-2xl" onClick={() => void handleReviewNext()} disabled={savingDraft}>
                {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Continue to review
              </Button>
            ) : null}

            {step === 3 ? (
              <Button
                className="rounded-2xl bg-emerald-600 hover:bg-emerald-700"
                onClick={() => void handleFinalize()}
                disabled={
                  finalizing ||
                  savingDraft ||
                  (creationMode === 'purchase' && !purchaseAvailability.supported)
                }
              >
                {finalizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {buttonLabel}
              </Button>
            ) : null}
          </CardFooter>
        </Card>
      </div>

      <Dialog open={Boolean(completedOrg)} onOpenChange={(open) => !open && setCompletedOrg(null)}>
        <DialogContent className="rounded-[28px]">
          <DialogHeader>
            <DialogTitle>Organization created</DialogTitle>
            <DialogDescription>
              Share this join code with members so they can join {completedOrg?.orgName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
              <p className="text-xs uppercase tracking-[0.25em] text-emerald-700">Join code</p>
              <p className="mt-2 text-3xl font-semibold tracking-[0.35em] text-emerald-950">
                {completedOrg?.joinCode}
              </p>
            </div>
            <p className="text-sm text-slate-600">
              {completedOrg?.planName} is now assigned to this organization. Members can join with the code above.
            </p>
          </div>
          <DialogFooter>
            <Button className="w-full rounded-2xl" onClick={finishSetup}>
              Open organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
