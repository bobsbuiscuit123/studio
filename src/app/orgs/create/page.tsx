'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { calculateEstimatedDaysRemaining, calculateTokenUsageEstimate } from '@/lib/pricing';
import { Logo } from '@/components/icons';
import { clearSelectedGroupId, clearSelectedOrgId, setSelectedOrgId } from '@/lib/selection';
import { safeFetchJson } from '@/lib/network';
import { TokenPackageDialog } from '@/components/orgs/token-package-dialog';
import type { AppleTokenPurchaseOutcome } from '@/lib/token-purchases';

const MAX_USER_LIMIT_MAX = 10_000;

type CreateOrgResponse = {
  ok: boolean;
  orgId?: string;
  joinCode?: string;
  tokenBalance?: number;
  trialGranted?: boolean;
  error?: { message?: string };
};

type CreatedOrgState = {
  orgId: string;
  orgName: string;
  joinCode: string;
  tokenBalance: number;
  trialGranted: boolean;
};

export default function OrgCreatePage() {
  const router = useRouter();
  const { toast } = useToast();
  const cleanupStartedRef = useRef(false);

  const [orgName, setOrgName] = useState('');
  const [orgCategory, setOrgCategory] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [maxUserLimit, setMaxUserLimit] = useState(25);
  const [dailyAiLimitPerUser, setDailyAiLimitPerUser] = useState(2);
  const [step, setStep] = useState<1 | 2>(1);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [setupSubmitting, setSetupSubmitting] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(false);
  const [createdOrg, setCreatedOrg] = useState<CreatedOrgState | null>(null);

  const estimate = useMemo(
    () => calculateTokenUsageEstimate(maxUserLimit, dailyAiLimitPerUser),
    [maxUserLimit, dailyAiLimitPerUser]
  );
  const estimatedDaysRemaining = calculateEstimatedDaysRemaining(
    createdOrg?.tokenBalance ?? 0,
    estimate.estimatedMonthlyTokens
  );

  const validateForm = () => {
    if (!orgName.trim()) {
      toast({ title: 'Missing name', description: 'Enter an organization name.', variant: 'destructive' });
      return false;
    }
    return true;
  };

  const cleanupPendingOrg = useCallback(async (options?: { keepalive?: boolean }) => {
    if (!createdOrg?.orgId || setupCompleted || cleanupStartedRef.current) {
      return;
    }

    cleanupStartedRef.current = true;
    clearSelectedGroupId();
    clearSelectedOrgId();

    try {
      await fetch(`/api/orgs/${createdOrg.orgId}/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: options?.keepalive ?? false,
      });
    } catch {
      // Best-effort cleanup only.
    }
  }, [createdOrg?.orgId, setupCompleted]);

  useEffect(() => {
    if (!createdOrg?.orgId || setupCompleted || step !== 2 || typeof window === 'undefined') {
      return;
    }

    const currentUrl = window.location.href;
    window.history.pushState({ orgSetupPending: true }, '', currentUrl);

    const handleBeforeUnload = () => {
      void cleanupPendingOrg({ keepalive: true });
    };

    const handlePopState = () => {
      void cleanupPendingOrg({ keepalive: true });
      router.replace('/orgs');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [cleanupPendingOrg, createdOrg?.orgId, router, setupCompleted, step]);

  const submitCreateOrg = async () => {
    if (!validateForm()) return;

    setCreateSubmitting(true);
    const response = await safeFetchJson<CreateOrgResponse>('/api/orgs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: orgName.trim(),
        category: orgCategory.trim(),
        description: orgDescription.trim(),
        memberCap: maxUserLimit,
        dailyAiLimit: dailyAiLimitPerUser,
      }),
    });

    if (!response.ok || !response.data?.orgId || !response.data?.joinCode) {
      toast({
        title: 'Create failed',
        description: response.ok
          ? response.data?.error?.message || 'Unable to create organization.'
          : response.error.message,
        variant: 'destructive',
      });
      setCreateSubmitting(false);
      return;
    }

    const nextCreatedOrg = {
      orgId: response.data.orgId,
      orgName: orgName.trim(),
      joinCode: response.data.joinCode,
      tokenBalance: Number(response.data.tokenBalance ?? 0),
      trialGranted: Boolean(response.data.trialGranted),
    };

    setCreatedOrg(nextCreatedOrg);
    setSelectedOrgId(nextCreatedOrg.orgId);
    clearSelectedGroupId();
    setStep(2);
    setCreateSubmitting(false);
  };

  const handleExitSetup = async () => {
    await cleanupPendingOrg();
    router.push('/orgs');
  };

  const handleSetupComplete = async () => {
    if (!createdOrg?.orgId) return;

    setSetupSubmitting(true);
    const response = await safeFetchJson<{ ok: true }>(`/api/orgs/${createdOrg.orgId}/update`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberLimit: maxUserLimit,
        dailyAiLimitPerUser,
      }),
    });

    if (!response.ok) {
      toast({
        title: 'Setup failed',
        description: response.error.message || 'Unable to save organization settings.',
        variant: 'destructive',
      });
      setSetupSubmitting(false);
      return;
    }

    setSetupCompleted(true);
    cleanupStartedRef.current = true;
    toast({
      title: 'Organization ready',
      description: `${createdOrg.orgName} has been created and configured.`,
    });
    router.push('/clubs');
  };

  const handleTokenPurchaseComplete = async (result: AppleTokenPurchaseOutcome) => {
    if (result.tokenBalance == null) return;
    setCreatedOrg((current) =>
      current
        ? {
            ...current,
            tokenBalance: Number(result.tokenBalance ?? current.tokenBalance),
          }
        : current
    );
  };

  return (
    <div className="viewport-page bg-emerald-50/70 text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_circle_at_-10%_-20%,rgba(16,185,129,0.25),transparent_60%),radial-gradient(900px_circle_at_110%_10%,rgba(34,197,94,0.24),transparent_55%),radial-gradient(900px_circle_at_40%_120%,rgba(74,222,128,0.2),transparent_60%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/70 via-transparent to-emerald-50/60" />
      </div>

      <div className="viewport-scroll relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-lg">
              <Logo className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">CASPO</p>
              <h1 className="text-3xl font-semibold">Create organization</h1>
              <p className="text-sm text-slate-600">
                Create the organization first for free, then finish the required setup.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="rounded-2xl"
            onClick={() => void (createdOrg && !setupCompleted ? handleExitSetup() : router.push('/orgs'))}
          >
            {createdOrg && !setupCompleted ? 'Cancel setup' : 'Back to organizations'}
          </Button>
        </header>

        <Card className="rounded-[28px] border-0 bg-white/85 shadow-xl backdrop-blur">
          <CardHeader>
            <CardTitle className="text-xl">Organization setup</CardTitle>
            <CardDescription>
              {step === 1
                ? 'Create the organization for free first.'
                : `Finish the required setup for ${createdOrg?.orgName ?? 'your organization'}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${step === 1 ? 'bg-slate-900 text-white' : 'bg-emerald-600 text-white'}`}>1</div>
              <div className="text-sm font-medium">Organization details</div>
              <div className="h-px flex-1 bg-slate-200" />
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${step === 2 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
              <div className="text-sm font-medium">Required configuration</div>
            </div>

            {step === 1 ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input
                    id="org-name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g., Central High Activities"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-category">Category</Label>
                  <Input
                    id="org-category"
                    value={orgCategory}
                    onChange={(e) => setOrgCategory(e.target.value)}
                    placeholder="School, Community, Nonprofit"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-description">Description</Label>
                  <Input
                    id="org-description"
                    value={orgDescription}
                    onChange={(e) => setOrgDescription(e.target.value)}
                    placeholder="Tell members what this organization is about."
                  />
                </div>
                <div className="rounded-[24px] bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  Creating the organization is free. Right after creation, you will be required to set member and AI limits.
                </div>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                  <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                    <div className="flex items-center justify-between gap-3">
                      <span>Organization created</span>
                      <span className="font-semibold">{createdOrg?.orgName}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span>Join code</span>
                      <span className="font-semibold tracking-[0.25em] text-slate-900">{createdOrg?.joinCode}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Member cap</Label>
                      <Input
                        type="number"
                        value={maxUserLimit}
                        min={0}
                        max={MAX_USER_LIMIT_MAX}
                        onChange={(e) => {
                          const nextValue = Number(e.target.value);
                          if (!Number.isFinite(nextValue)) return;
                          setMaxUserLimit(Math.min(MAX_USER_LIMIT_MAX, Math.max(0, nextValue)));
                        }}
                        className="w-28 text-right"
                      />
                    </div>
                    <Slider
                      value={[maxUserLimit]}
                      min={0}
                      max={MAX_USER_LIMIT_MAX}
                      step={1}
                      onValueChange={(values) => setMaxUserLimit(values[0])}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Daily AI requests per member</Label>
                      <Input
                        type="number"
                        value={dailyAiLimitPerUser}
                        min={0}
                        max={200}
                        onChange={(e) => setDailyAiLimitPerUser(Math.max(0, Number(e.target.value) || 0))}
                        className="w-28 text-right"
                      />
                    </div>
                    <Slider
                      value={[dailyAiLimitPerUser]}
                      min={0}
                      max={200}
                      step={1}
                      onValueChange={(values) => setDailyAiLimitPerUser(values[0])}
                    />
                  </div>
                </div>

                <Card className="rounded-[28px] border border-slate-200 bg-slate-50/90 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Estimated token usage</CardTitle>
                    <CardDescription>
                      Set the limits for {createdOrg?.orgName ?? 'this organization'} and optionally add tokens right now.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Estimated monthly usage</span>
                      <span className="font-semibold text-slate-900">
                        {estimate.estimatedMonthlyTokens.toLocaleString()} tokens
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Estimated daily usage</span>
                      <span className="font-semibold text-slate-900">
                        {estimate.estimatedDailyTokens.toLocaleString()} tokens/day
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Current organization balance</span>
                      <span className="font-semibold text-slate-900">
                        {(createdOrg?.tokenBalance ?? 0).toLocaleString()} tokens
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Estimated days remaining</span>
                      <span className="font-semibold text-slate-900">{estimatedDaysRemaining} days</span>
                    </div>
                    {createdOrg?.trialGranted ? (
                      <div className="rounded-[24px] bg-white px-4 py-3 text-xs text-emerald-700">
                        Your first organization courtesy tokens have already been added.
                      </div>
                    ) : (
                      <div className="rounded-[24px] bg-white px-4 py-3 text-xs text-slate-500">
                        You can buy tokens for this organization now or come back later from the org billing page.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row">
            {step === 1 ? (
              <Button className="flex-1 rounded-2xl" onClick={() => void submitCreateOrg()} disabled={createSubmitting}>
                {createSubmitting ? 'Creating organization...' : 'Create Organization'}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="rounded-2xl"
                  onClick={() => setTokenDialogOpen(true)}
                >
                  <Coins className="mr-2 h-4 w-4" />
                  Buy tokens for {createdOrg?.orgName ?? 'this organization'}
                </Button>
                <Button
                  className="flex-1 rounded-2xl"
                  onClick={() => void handleSetupComplete()}
                  disabled={setupSubmitting}
                >
                  {setupSubmitting ? 'Saving setup...' : 'Save setup and continue'}
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      </div>

      <TokenPackageDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        title={`Buy tokens for ${createdOrg?.orgName ?? 'this organization'}`}
        description="Buy tokens for this organization now, then complete the required setup to continue."
        onPurchaseComplete={handleTokenPurchaseComplete}
        orgId={createdOrg?.orgId ?? null}
      />
    </div>
  );
}
