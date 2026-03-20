'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { calculateCreditUsageEstimate, calculateEstimatedDaysRemaining } from '@/lib/pricing';
import { Logo } from '@/components/icons';
import { clearSelectedGroupId, setSelectedOrgId } from '@/lib/selection';
import { CreditPackDialog } from '@/components/orgs/credit-pack-dialog';
import { safeFetchJson } from '@/lib/network';

const JOIN_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;
const MAX_USER_LIMIT_MAX = 10_000;

export default function OrgCreatePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [orgName, setOrgName] = useState('');
  const [orgCategory, setOrgCategory] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [createJoinCode, setCreateJoinCode] = useState('');
  const [maxUserLimit, setMaxUserLimit] = useState(25);
  const [dailyAiLimitPerUser, setDailyAiLimitPerUser] = useState(40);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [createdOrg, setCreatedOrg] = useState<{ orgId: string; joinCode: string; creditBalance: number } | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);

  const estimate = useMemo(
    () => calculateCreditUsageEstimate(maxUserLimit, dailyAiLimitPerUser),
    [maxUserLimit, dailyAiLimitPerUser]
  );

  const normalizedJoinCode = createJoinCode.trim().toUpperCase();
  const estimatedDaysRemaining = calculateEstimatedDaysRemaining(
    walletBalance,
    estimate.estimatedMonthlyCredits
  );
  const lowBalance = estimate.estimatedMonthlyCredits > walletBalance;

  useEffect(() => {
    const loadWallet = async () => {
      const response = await safeFetchJson<{
        ok: boolean;
        data?: { creditBalance: number };
      }>('/api/credits/wallet', { method: 'GET' });
      if (response.ok) {
        setWalletBalance(Number(response.data.data?.creditBalance ?? 0));
      }
    };
    void loadWallet();
  }, []);

  const handleCreateOrg = async () => {
    if (!orgName.trim()) {
      toast({ title: 'Missing name', description: 'Enter an organization name.', variant: 'destructive' });
      return;
    }
    if (normalizedJoinCode && !JOIN_CODE_PATTERN.test(normalizedJoinCode)) {
      toast({
        title: 'Invalid join code',
        description: 'Custom join codes must be 4-10 uppercase letters or numbers.',
        variant: 'destructive',
      });
      return;
    }
    setCreateSubmitting(true);
    const response = await safeFetchJson<{
      ok: boolean;
      orgId?: string;
      joinCode?: string;
      creditBalance?: number;
      error?: { message?: string };
    }>('/api/orgs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: orgName.trim(),
        category: orgCategory.trim(),
        description: orgDescription.trim(),
        maxUserLimit,
        dailyAiLimitPerUser,
        ...(normalizedJoinCode ? { joinCode: normalizedJoinCode } : {}),
      }),
    });
    if (!response.ok || !response.data?.orgId || !response.data?.joinCode) {
      toast({
        title: 'Create failed',
        description: response.ok ? response.data?.error?.message || 'Unable to create organization.' : response.error.message,
        variant: 'destructive',
      });
      setCreateSubmitting(false);
      return;
    }
    setCreatedOrg({
      orgId: response.data.orgId,
      joinCode: response.data.joinCode,
      creditBalance: Number(response.data.creditBalance ?? 0),
    });
    setWalletBalance(0);
    setCreateSubmitting(false);
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
              <p className="text-sm text-slate-600">Organization setup is free. Credits are only used as members use AI.</p>
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
              <CardDescription>Your organization is ready. Share the join code and add credits any time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5 text-center">
                <p className="text-sm uppercase tracking-[0.3em] text-emerald-700">Join Code</p>
                <p className="mt-3 text-4xl font-semibold tracking-[0.35em] text-slate-900">{createdOrg.joinCode}</p>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
                  <span>Starting credit balance</span>
                  <span className="font-semibold text-slate-900">{createdOrg.creditBalance.toLocaleString()} credits</span>
                </div>
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
                Manage credits
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
              <CardDescription>Configure your member capacity and estimated AI usage.</CardDescription>
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
                  <div className="grid gap-4 md:grid-cols-2">
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
                      <Label htmlFor="org-join-code">Custom Join Code (optional)</Label>
                      <Input
                        id="org-join-code"
                        value={createJoinCode}
                        onChange={(e) => setCreateJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        placeholder="ABC123"
                        maxLength={10}
                      />
                      <p className="text-xs text-slate-500">Leave blank to auto-generate a join code.</p>
                    </div>
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
                        <Label>Max users</Label>
                        <Input
                          type="number"
                          value={maxUserLimit}
                          min={1}
                          max={MAX_USER_LIMIT_MAX}
                          onChange={(e) => {
                            const nextValue = Number(e.target.value);
                            if (!Number.isFinite(nextValue)) return;
                            setMaxUserLimit(Math.min(MAX_USER_LIMIT_MAX, Math.max(1, nextValue)));
                          }}
                          className="w-28 text-right"
                        />
                      </div>
                      <Slider
                        value={[maxUserLimit]}
                        min={1}
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
                      <CardTitle className="text-base">Estimated credit usage</CardTitle>
                      <CardDescription>
                        Based on your current settings, here’s the estimated monthly AI credit usage for your organization.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <span>Estimated monthly usage</span>
                        <span className="font-semibold text-slate-900">
                          {estimate.estimatedMonthlyCredits.toLocaleString()} credits
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Estimated daily usage</span>
                        <span className="font-semibold text-slate-900">
                          {estimate.estimatedDailyCredits.toLocaleString()} credits/day
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Current owner balance</span>
                        <span className="font-semibold text-slate-900">{walletBalance.toLocaleString()} credits</span>
                      </div>
                      {walletBalance > 0 ? (
                        <div className="flex items-center justify-between">
                          <span>Estimated days remaining</span>
                          <span className="font-semibold text-slate-900">{estimatedDaysRemaining} days</span>
                        </div>
                      ) : null}
                      <div className="rounded-[24px] bg-white px-4 py-3 text-xs text-slate-500">
                        Organizations are free to create. Credits are only used as members use AI.
                      </div>
                      {lowBalance ? (
                        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              <p className="font-medium">Your current balance may not fully support this configuration.</p>
                              <p className="mt-1 text-amber-800">
                                You can create the organization now and add credits anytime.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}
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
                  <Button
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => setCreditDialogOpen(true)}
                  >
                    <Coins className="mr-2 h-4 w-4" />
                    Add credits
                  </Button>
                  <Button className="flex-1 rounded-2xl" onClick={handleCreateOrg} disabled={createSubmitting}>
                    {createSubmitting ? 'Creating organization...' : 'Create organization'}
                  </Button>
                </>
              ) : null}
            </CardFooter>
          </Card>
        )}
      </div>

      <CreditPackDialog
        open={creditDialogOpen}
        onOpenChange={setCreditDialogOpen}
        title="Add credits before launch"
        description="Credits you add now will be applied to this organization when it is created."
        onPurchased={(nextBalance) => setWalletBalance(nextBalance)}
      />
    </div>
  );
}
