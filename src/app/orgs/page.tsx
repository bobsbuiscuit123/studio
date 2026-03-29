'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Sparkles, Users } from 'lucide-react';

import { Logo } from '@/components/icons';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { safeFetchJson } from '@/lib/network';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OrgSubscriptionStatus } from '@/lib/org-subscription';
import { clearSelectedGroupId, clearSelectedOrgId, setSelectedOrgId } from '@/lib/selection';

type OrgSummary = {
  id: string;
  name: string;
  role: string;
};

const aiBadgeVariant = (status: OrgSubscriptionStatus | null) => {
  if (!status?.aiAvailable) return 'destructive' as const;
  if (status.effectiveAvailableTokens <= 100) return 'secondary' as const;
  return 'default' as const;
};

const aiBadgeLabel = (status: OrgSubscriptionStatus | null) => {
  if (!status?.aiAvailable) return 'AI unavailable';
  if (status.effectiveAvailableTokens <= 100) return 'AI low';
  return 'AI available';
};

export default function OrgsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [statusByOrg, setStatusByOrg] = useState<Record<string, OrgSubscriptionStatus>>({});
  const [loading, setLoading] = useState(true);
  const [signOutSubmitting, setSignOutSubmitting] = useState(false);

  const loadStatuses = useCallback(async (orgsToLoad: OrgSummary[]) => {
    const statusEntries = await Promise.all(
      orgsToLoad.map(async (org) => {
        const result = await safeFetchJson<{ ok: true; data: OrgSubscriptionStatus }>(
          `/api/orgs/${org.id}/status`,
          { method: 'GET' }
        );
        return result.ok ? ([org.id, result.data.data] as const) : null;
      })
    );

    setStatusByOrg(
      statusEntries.reduce<Record<string, OrgSubscriptionStatus>>((acc, entry) => {
        if (entry) {
          const [orgId, orgStatus] = entry;
          acc[orgId] = orgStatus;
        }
        return acc;
      }, {})
    );
  }, []);

  const load = useCallback(async () => {
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser.user) {
      router.replace('/login');
      return;
    }

    const result = await safeFetchJson<{ ok: true; data: OrgSummary[] }>('/api/orgs', {
      method: 'GET',
    });
    if (!result.ok) {
      toast({ title: 'Error', description: result.error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const orgList = Array.isArray(result.data.data) ? result.data.data : [];
    setOrgs(orgList);
    await loadStatuses(orgList);
    setLoading(false);
  }, [loadStatuses, router, supabase, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleRefresh = () => {
      void load();
    };

    window.addEventListener('org-subscription-changed', handleRefresh);
    window.addEventListener('focus', handleRefresh);
    return () => {
      window.removeEventListener('org-subscription-changed', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
    };
  }, [load]);

  const handleSelectOrg = (orgId: string) => {
    setSelectedOrgId(orgId);
    clearSelectedGroupId();
    router.push('/clubs');
  };

  const handleSwitchAccount = async () => {
    setSignOutSubmitting(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({ title: 'Sign out failed', description: error.message, variant: 'destructive' });
      setSignOutSubmitting(false);
      return;
    }

    clearSelectedOrgId();
    clearSelectedGroupId();
    router.replace('/login');
  };

  return (
    <div className="viewport-page bg-background text-slate-900">
      <div className="viewport-scroll relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-lg">
              <Logo className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">CASPO</p>
              <h1 className="text-3xl font-semibold">Your organizations</h1>
              <p className="text-sm text-slate-600">
                Create organizations, join existing ones, and manage subscription-backed AI access.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={handleSwitchAccount} disabled={signOutSubmitting} className="rounded-2xl">
            {signOutSubmitting ? 'Switching...' : 'Switch account'}
          </Button>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="rounded-[28px] border-0 bg-white/85 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Create organization</CardTitle>
              <CardDescription>
                Enter organization details, estimate usage, then review and confirm the plan assignment.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              New organizations are created only after the final step succeeds.
            </CardContent>
            <CardFooter>
              <Button onClick={() => router.push('/orgs/create')} className="w-full rounded-2xl">
                Start setup
              </Button>
            </CardFooter>
          </Card>

          <Card className="rounded-[28px] border border-slate-200 bg-white/75 shadow-lg backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Join organization</CardTitle>
              <CardDescription>Already invited? Enter a join code to get started.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              Members can collaborate without seeing subscription management controls.
            </CardContent>
            <CardFooter>
              <Button variant="outline" onClick={() => router.push('/orgs/join')} className="w-full rounded-2xl">
                Join with code
              </Button>
            </CardFooter>
          </Card>
        </div>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Your organizations</h2>
            <p className="text-sm text-slate-600">
              Open a workspace, check AI availability, or manage subscription settings if you own it.
            </p>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Card key={idx} className="rounded-[28px] border border-slate-200 bg-white/80 shadow-sm">
                  <CardHeader className="space-y-3">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </CardContent>
                  <CardFooter>
                    <Skeleton className="h-9 w-full" />
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : orgs.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {orgs.map((org) => {
                const status = statusByOrg[org.id] ?? null;
                const isOwner = org.role === 'owner';

                return (
                  <Card key={org.id} className="rounded-[28px] border border-slate-200 bg-white/85 shadow-sm">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">{org.name}</CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge variant="secondary">{isOwner ? 'Owner' : 'Member'}</Badge>
                            <Badge variant={aiBadgeVariant(status)}>{aiBadgeLabel(status)}</Badge>
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Users className="h-4 w-4" />
                          <span>{status?.activeUsers ?? 0}</span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-slate-600">
                      <div className="rounded-[24px] bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span>Plan</span>
                          <span className="font-semibold text-slate-900">{status?.planName ?? 'Free'}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span>Period remaining</span>
                          <span className="font-semibold text-slate-900">
                            {(status?.effectiveAvailableTokens ?? 0).toLocaleString()} tokens
                          </span>
                        </div>
                      </div>

                      {isOwner ? (
                        <div className="rounded-[24px] border border-emerald-100 bg-emerald-50 px-4 py-3">
                          <div className="flex items-center gap-2 font-medium text-emerald-900">
                            <Sparkles className="h-4 w-4" />
                            {status?.tokensUsedThisPeriod ?? 0} used this period
                          </div>
                          <p className="mt-1 text-xs text-emerald-800">
                            {status?.monthlyTokenLimit ?? 0} monthly allowance
                            {status?.bonusTokensThisPeriod
                              ? ` + ${status.bonusTokensThisPeriod} one-time bonus`
                              : ''}
                          </p>
                          {status && status.ownerHasActiveSubscription && !status.isSubscribedOrg ? (
                            <p className="mt-2 text-xs text-emerald-800">
                              Your active subscription is currently assigned to another organization.
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                          {status?.aiAvailable
                            ? 'AI is currently available for this organization.'
                            : 'AI is currently unavailable for this organization.'}
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="flex items-center gap-2">
                      <Button onClick={() => handleSelectOrg(org.id)} className="flex-1 rounded-2xl">
                        Open
                      </Button>
                      {isOwner ? (
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          onClick={() => router.push(`/orgs/${org.id}/credits`)}
                        >
                          <CreditCard className="mr-2 h-4 w-4" />
                          Billing
                        </Button>
                      ) : null}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="rounded-[28px] border border-dashed border-slate-200 bg-white/75 shadow-sm">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-base font-medium text-slate-900">No organizations yet</p>
                  <p className="text-sm text-slate-600">Create a new workspace or join with a code to get started.</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => router.push('/orgs/create')} className="rounded-2xl">
                    Create organization
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/orgs/join')} className="rounded-2xl">
                    Join organization
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
