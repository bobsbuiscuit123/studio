'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { computeOrgPricing } from '@/lib/pricing';
import { Logo } from '@/components/icons';
import { clearSelectedGroupId, setSelectedOrgId } from '@/lib/selection';

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
  const [dailyCreditPerUser, setDailyCreditPerUser] = useState(40);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [createdOrg, setCreatedOrg] = useState<{ orgId: string; joinCode: string } | null>(null);

  const pricing = useMemo(
    () => computeOrgPricing(maxUserLimit, dailyCreditPerUser),
    [maxUserLimit, dailyCreditPerUser]
  );

  const normalizedJoinCode = createJoinCode.trim().toUpperCase();
  const checkoutJoinCodePreview = normalizedJoinCode || 'AUTO-GENERATED';

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
    const payload: {
      name: string;
      category: string;
      description: string;
      maxUserLimit: number;
      dailyCreditPerUser: number;
      joinCode?: string;
    } = {
      name: orgName.trim(),
      category: orgCategory.trim(),
      description: orgDescription.trim(),
      maxUserLimit,
      dailyCreditPerUser,
    };
    if (normalizedJoinCode) {
      payload.joinCode = normalizedJoinCode;
    }
    const response = await fetch('/api/orgs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      toast({
        title: 'Create failed',
        description: result?.error?.message || 'Unable to create organization.',
        variant: 'destructive',
      });
      setCreateSubmitting(false);
      return;
    }
    if (!result?.orgId || !result?.joinCode) {
      toast({ title: 'Create failed', description: 'Missing organization details.', variant: 'destructive' });
      setCreateSubmitting(false);
      return;
    }
    setCreatedOrg({ orgId: result.orgId, joinCode: result.joinCode });
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

      <div className="viewport-scroll relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-lg">
              <Logo className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">CASPO</p>
              <h1 className="text-3xl font-semibold">Create organization</h1>
            </div>
          </div>
          <Button variant="outline" onClick={() => router.push('/orgs')}>
            Back to organizations
          </Button>
        </header>

        {createdOrg ? (
          <Card className="border-transparent bg-white/80 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-2xl">Organization Created</CardTitle>
              <CardDescription>Your organization is ready. Share this join code with members so they can join.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <p className="text-sm uppercase tracking-[0.3em] text-emerald-700">Join Code</p>
                <p className="mt-3 text-4xl font-semibold tracking-[0.35em] text-slate-900">{createdOrg.joinCode}</p>
              </div>
              <p className="text-sm text-slate-600">You can now continue into the workspace and finish the rest of your setup there.</p>
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row">
              <Button variant="outline" onClick={handleCopyJoinCode}>
                Copy join code
              </Button>
              <Button className="flex-1" onClick={handleContinue}>
                Continue to workspace
              </Button>
            </CardFooter>
          </Card>
        ) : step === 3 ? (
          <Card className="border-transparent bg-white/80 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-2xl">Checkout</CardTitle>
              <CardDescription>Review your saved plan before purchase.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <p className="text-sm uppercase tracking-[0.3em] text-emerald-700">Join Code Preview</p>
                <p className="mt-3 text-4xl font-semibold tracking-[0.35em] text-slate-900">{checkoutJoinCodePreview}</p>
                <p className="mt-3 text-xs text-slate-500">
                  {normalizedJoinCode ? 'Your custom join code will be used after purchase.' : 'A join code will be generated after purchase.'}
                </p>
              </div>
              <Card className="border border-slate-200 bg-slate-50/80 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Plan summary</CardTitle>
                  <CardDescription>This is your saved starting point for future IAP setup.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Max users</span>
                    <span>{maxUserLimit.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Daily AI credit per user</span>
                    <span>{dailyCreditPerUser}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Static cost</span>
                    <span>${pricing.staticCost.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Variable cost</span>
                    <span>${pricing.variableCost.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Multiplier</span>
                    <span>{pricing.multiplier.toFixed(2)}x</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
                    <span>Total per month</span>
                    <span>${pricing.retailPrice.toFixed(2)}</span>
                  </div>
                </CardContent>
              </Card>
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button className="flex-1" onClick={handleCreateOrg} disabled={createSubmitting}>
                {createSubmitting ? 'Creating organization...' : 'Buy'}
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card className="border-transparent bg-white/80 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Organization setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${step === 1 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>1</div>
                <div className="text-sm font-medium">Organization details</div>
                <div className="h-px flex-1 bg-slate-200" />
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${step === 2 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
                <div className="text-sm font-medium">Plan preferences</div>
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
                      {normalizedJoinCode && !JOIN_CODE_PATTERN.test(normalizedJoinCode) ? (
                        <p className="text-xs text-rose-600">
                          Custom join codes must be 4-10 uppercase letters or numbers.
                        </p>
                      ) : null}
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
                <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Max users (you can change later)</Label>
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
                          className="w-24 text-right"
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
                      <div className="flex items-center justify-between">
                        <Label>Daily AI credit per user</Label>
                        <Input
                          type="number"
                          value={dailyCreditPerUser}
                          min={0}
                          onChange={(e) => setDailyCreditPerUser(Number(e.target.value))}
                          className="w-24 text-right"
                        />
                      </div>
                      <Slider
                        value={[dailyCreditPerUser]}
                        min={0}
                        max={200}
                        step={1}
                        onValueChange={(values) => setDailyCreditPerUser(values[0])}
                      />
                    </div>
                  </div>
                  <Card className="border border-slate-200 bg-slate-50/80 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Monthly estimate</CardTitle>
                      <CardDescription>Saved now so your later IAP pricing has a starting point.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <span>Static cost</span>
                        <span>${pricing.staticCost.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Variable cost</span>
                        <span>${pricing.variableCost.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Multiplier</span>
                        <span>{pricing.multiplier.toFixed(2)}x</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base font-semibold text-slate-900">
                        <span>Total per month</span>
                        <span>${pricing.retailPrice.toFixed(2)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3">
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(step === 1 ? 2 : 1)}>
                  {step === 1 ? 'Next: Plan preferences' : 'Back to details'}
                </Button>
                {step === 2 && (
                  <Button onClick={() => setStep(3)} className="flex-1">
                    Continue to checkout
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
