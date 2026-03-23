'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import {
  TRIAL_TOKENS,
  calculateEstimatedDaysRemaining,
  calculateTokenUsageEstimate,
} from '@/lib/pricing';
import { Logo } from '@/components/icons';
import { clearSelectedGroupId, setSelectedOrgId } from '@/lib/selection';
import { safeFetchJson } from '@/lib/network';

const MAX_USER_LIMIT_MAX = 10_000;

type TokenWalletResponse = {
  ok: boolean;
  data?: {
    tokenBalance: number;
    hasUsedTrial: boolean;
  };
};

type CreateOrgResponse = {
  ok: boolean;
  orgId?: string;
  joinCode?: string;
  tokenBalance?: number;
  trialGranted?: boolean;
  error?: { message?: string };
};

export default function OrgCreatePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [orgName, setOrgName] = useState('');
  const [orgCategory, setOrgCategory] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [maxUserLimit, setMaxUserLimit] = useState(25);
  const [dailyAiLimitPerUser, setDailyAiLimitPerUser] = useState(2);
  const [step, setStep] = useState<1 | 2>(1);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [hasUsedTrial, setHasUsedTrial] = useState(false);
  const [trialPreviewAccepted, setTrialPreviewAccepted] = useState(false);
  const [trialDialogOpen, setTrialDialogOpen] = useState(false);
  const [trialDialogAlreadyShown, setTrialDialogAlreadyShown] = useState(false);
  const [createdOrg, setCreatedOrg] = useState<{
    orgId: string;
    joinCode: string;
    tokenBalance: number;
    trialGranted: boolean;
  } | null>(null);

  const estimate = useMemo(
    () => calculateTokenUsageEstimate(maxUserLimit, dailyAiLimitPerUser),
    [maxUserLimit, dailyAiLimitPerUser]
  );
  const previewTokenBalance =
    !hasUsedTrial && trialPreviewAccepted ? tokenBalance + TRIAL_TOKENS : tokenBalance;
  const estimatedDaysRemaining = calculateEstimatedDaysRemaining(
    previewTokenBalance,
    estimate.estimatedMonthlyTokens
  );

  const loadWallet = useCallback(async () => {
    const response = await safeFetchJson<TokenWalletResponse>('/api/tokens/wallet', { method: 'GET' });
    if (!response.ok) {
      return;
    }
    setTokenBalance(Number(response.data.data?.tokenBalance ?? 0));
    setHasUsedTrial(Boolean(response.data.data?.hasUsedTrial));
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedShown = window.localStorage.getItem('orgTrialDialogShown') === 'true';
    const storedAccepted = window.localStorage.getItem('orgTrialDialogAccepted') === 'true';
    setTrialDialogAlreadyShown(storedShown);
    if (storedAccepted) {
      setTrialPreviewAccepted(true);
    }
  }, []);

  useEffect(() => {
    if (
      step === 2 &&
      !hasUsedTrial &&
      !trialPreviewAccepted &&
      !trialDialogAlreadyShown
    ) {
      setTrialDialogOpen(true);
      setTrialDialogAlreadyShown(true);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('orgTrialDialogShown', 'true');
      }
    }
  }, [hasUsedTrial, step, trialPreviewAccepted, trialDialogAlreadyShown]);

  const validateForm = () => {
    if (!orgName.trim()) {
      toast({ title: 'Missing name', description: 'Enter an organization name.', variant: 'destructive' });
      return false;
    }
    return true;
  };

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

    const nextTokenBalance = Number(response.data.tokenBalance ?? tokenBalance);
    const trialGranted = Boolean(response.data.trialGranted);
    setCreatedOrg({
      orgId: response.data.orgId,
      joinCode: response.data.joinCode,
      tokenBalance: nextTokenBalance,
      trialGranted,
    });
    setTokenBalance(nextTokenBalance);
    setHasUsedTrial((current) => current || trialGranted);
    setTrialDialogOpen(false);
    setCreateSubmitting(false);
  };

  const handleCreateClick = async () => {
    if (!validateForm()) return;
    if (!hasUsedTrial && !trialPreviewAccepted) {
      setTrialDialogOpen(true);
      return;
    }
    await submitCreateOrg();
  };

  const handleContinue = () => {
    if (!createdOrg) return;
    setSelectedOrgId(createdOrg.orgId);
    clearSelectedGroupId();
    router.push('/clubs');
  };

  const handleCopyJoinCode = async () => {
    if (!createdOrg?.joinCode) return;
    await navigator.clipboard.writeText(createdOrg.joinCode);
    toast({ title: 'Copied', description: 'Organization join code copied.' });
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
                Organization setup is free. Tokens are only used when members make AI requests.
              </p>
            </div>
          </div>
          <Button variant="outline" className="rounded-2xl" onClick={() => router.push('/orgs')}>
            Back to organizations
          </Button>
        </header>

        {createdOrg ? (
          <Card className="rounded-[28px] border-0 bg-white/85 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-2xl">Organization created</CardTitle>
              <CardDescription>Your organization is ready. Share the join code and manage tokens any time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5 text-center">
                <p className="text-sm uppercase tracking-[0.3em] text-emerald-700">Join Code</p>
                <p className="mt-3 text-4xl font-semibold tracking-[0.35em] text-slate-900">{createdOrg.joinCode}</p>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-3">
                  <span>Current owner balance</span>
                  <span className="font-semibold text-slate-900">
                    {createdOrg.tokenBalance.toLocaleString()} tokens
                  </span>
                </div>
                {createdOrg.trialGranted ? (
                  <p className="mt-3 text-xs text-emerald-700">
                    Your first organization trial added {TRIAL_TOKENS.toLocaleString()} free AI tokens.
                  </p>
                ) : null}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row">
              <Button variant="outline" className="rounded-2xl" onClick={handleCopyJoinCode}>
                Copy join code
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl"
                onClick={() => router.push(`/orgs/${createdOrg.orgId}/credits`)}
              >
                View token billing
              </Button>
              <Button className="flex-1 rounded-2xl" onClick={handleContinue}>
                Continue to workspace
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card className="rounded-[28px] border-0 bg-white/85 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Organization setup</CardTitle>
              <CardDescription>Configure member capacity and estimate AI token usage.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${step === 1 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>1</div>
                <div className="text-sm font-medium">Organization details</div>
                <div className="h-px flex-1 bg-slate-200" />
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${step === 2 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
                <div className="text-sm font-medium">AI configuration</div>
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
                </div>
              ) : (
                <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-6">
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
                        Based on your current settings, here’s the estimated AI token usage for this organization.
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
                        <span>Your current balance</span>
                        <span className="font-semibold text-slate-900">{previewTokenBalance.toLocaleString()} tokens</span>
                      </div>
                      {previewTokenBalance > 0 ? (
                        <div className="flex items-center justify-between">
                          <span>Estimated days remaining</span>
                          <span className="font-semibold text-slate-900">{estimatedDaysRemaining} days</span>
                        </div>
                      ) : null}
                      <div className="rounded-[24px] bg-white px-4 py-3 text-xs text-slate-500">
                        {trialPreviewAccepted && !hasUsedTrial
                          ? `Your ${TRIAL_TOKENS.toLocaleString()} courtesy tokens are previewed here and will be added only after you create your first organization.`
                          : 'Tokens are only used as members make AI requests. Creating the organization is free.'}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row">
              {step === 1 ? (
                <Button variant="outline" className="rounded-2xl" onClick={() => setStep(2)}>
                  Next: AI configuration
                </Button>
              ) : (
                <Button variant="outline" className="rounded-2xl" onClick={() => setStep(1)}>
                  Back to details
                </Button>
              )}
              {step === 2 ? (
                <>
                  <Button variant="outline" className="rounded-2xl" disabled>
                    <Coins className="mr-2 h-4 w-4" />
                    Buy Tokens after setup
                  </Button>
                  <p className="text-xs text-slate-500">
                    Token purchases are made per organization. Finish creating your organization first, then visit its billing page to add tokens.
                  </p>
                  <Button className="flex-1 rounded-2xl" onClick={() => void handleCreateClick()} disabled={createSubmitting}>
                    {createSubmitting ? 'Creating organization...' : 'Create Organization'}
                  </Button>
                </>
              ) : null}
            </CardFooter>
          </Card>
        )}
      </div>

      <Dialog open={trialDialogOpen} onOpenChange={setTrialDialogOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Courtesy tokens from CASPO</DialogTitle>
            <DialogDescription>
              If you create your first organization, CASPO will gift you {TRIAL_TOKENS.toLocaleString()} free AI tokens.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
              <span>Estimated monthly usage</span>
              <span className="font-semibold text-slate-900">
                {estimate.estimatedMonthlyTokens.toLocaleString()} tokens
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
              <span>Your free tokens</span>
              <span className="font-semibold text-slate-900">{TRIAL_TOKENS.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
              <span>These tokens will last approximately</span>
              <span className="font-semibold text-slate-900">{estimate.daysCovered} days</span>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
              Courtesy of CASPO, you can preview a balance of {(
                tokenBalance + TRIAL_TOKENS
              ).toLocaleString()} tokens before checkout.
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
              The tokens are not officially added to your account until you actually create your first organization.
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="rounded-2xl"
              onClick={() => setTrialDialogOpen(false)}
            >
              Maybe later
            </Button>
            <Button
              className="rounded-2xl"
              onClick={() => {
                setTrialPreviewAccepted(true);
                setTrialDialogOpen(false);
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem('orgTrialDialogAccepted', 'true');
                }
              }}
            >
              Accept gift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
