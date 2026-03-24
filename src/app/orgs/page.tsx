'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { safeFetchJson } from '@/lib/network';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { clearSelectedGroupId, clearSelectedOrgId, setSelectedOrgId } from '@/lib/selection';
import { Logo } from '@/components/icons';
import { Coins, Sparkles, Users } from 'lucide-react';
import { calculateEstimatedDaysRemaining, getAiAvailability, getTokenHealth } from '@/lib/pricing';
import {
  clearSatisfiedPendingOrgTokenBalance,
  getPendingOrgTokenBalanceTarget,
  registerPendingOrgTokenBalance,
  wasOrgTokenPurchaseProcessed,
} from '@/lib/org-token-optimistic';

type OrgSummary = {
  id: string;
  name: string;
  role: string;
};

type OrgStatus = {
  orgId: string;
  orgName: string;
  role: string;
  memberLimit: number;
  dailyAiLimitPerUser: number;
  activeUsers: number;
  requestsUsedToday: number;
  aiAvailability: 'available' | 'limited' | 'paused';
  estimatedMonthlyTokens: number;
  estimatedDailyTokens: number;
  tokenHealth: 'healthy' | 'low' | 'urgent' | 'depleted';
  tokenBalance?: number;
  estimatedDaysRemaining?: number;
  tokensPurchased: number;
  tokensUsed: number;
};

const roleLabel = (role: string) => (role === 'owner' ? 'Owner' : 'Member');

const availabilityLabel = (availability: OrgStatus['aiAvailability']) => {
  if (availability === 'paused') return 'AI paused';
  if (availability === 'limited') return 'AI limited soon';
  return 'AI available';
};

const healthVariant = (health: OrgStatus['tokenHealth']) => {
  if (health === 'healthy') return 'default' as const;
  if (health === 'depleted') return 'destructive' as const;
  return 'secondary' as const;
};

const applyOrgBalanceSnapshot = (status: OrgStatus, tokenBalance: number): OrgStatus => {
  const estimatedDaysRemaining = calculateEstimatedDaysRemaining(
    tokenBalance,
    status.estimatedMonthlyTokens
  );
  return {
    ...status,
    tokenBalance,
    estimatedDaysRemaining,
    tokenHealth: getTokenHealth(estimatedDaysRemaining),
    aiAvailability: getAiAvailability(tokenBalance, status.estimatedMonthlyTokens),
  };
};

export default function OrgsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [statusByOrg, setStatusByOrg] = useState<Record<string, OrgStatus>>({});
  const [loading, setLoading] = useState(true);
  const [signOutSubmitting, setSignOutSubmitting] = useState(false);

  const loadOrgStatus = useCallback(async (orgId: string) => {
    const statusResult = await safeFetchJson<{ ok: true; data: OrgStatus }>(`/api/orgs/${orgId}/status`, {
      method: 'GET',
    });
    if (!statusResult.ok) {
      return null;
    }
    const serverStatus = statusResult.data.data;
    const pendingTarget = getPendingOrgTokenBalanceTarget(orgId);
    const serverBalance = Number(serverStatus.tokenBalance ?? 0);
    if (Number.isFinite(pendingTarget) && serverBalance < Number(pendingTarget)) {
      return applyOrgBalanceSnapshot(serverStatus, Number(pendingTarget));
    }
    clearSatisfiedPendingOrgTokenBalance(orgId, serverBalance);
    return serverStatus;
  }, []);

  const reconcileOrgStatus = useCallback(async (orgId: string, targetBalance: number) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const nextStatus = await loadOrgStatus(orgId);
      if (!nextStatus) {
        continue;
      }
      const nextBalance = Number(nextStatus.tokenBalance ?? 0);
      setStatusByOrg(prev => ({ ...prev, [orgId]: nextStatus }));
      if (nextBalance >= targetBalance) {
        clearSatisfiedPendingOrgTokenBalance(orgId, nextBalance);
        return;
      }
    }
  }, [loadOrgStatus]);

  useEffect(() => {
    const load = async () => {
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
      const mapped = Array.isArray(result.data.data) ? result.data.data : [];
      setOrgs(mapped);
      setLoading(false);

      const statusEntries: Record<string, OrgStatus> = {};
      await Promise.all(
        mapped.map(async (org) => {
          const nextStatus = await loadOrgStatus(org.id);
          if (nextStatus) {
            statusEntries[org.id] = nextStatus;
          }
        })
      );
      setStatusByOrg(statusEntries);
    };
    void load();
  }, [loadOrgStatus, router, supabase, toast]);

  useEffect(() => {
    const handleTokenPurchaseComplete = (event?: Event) => {
      const detail =
        event && 'detail' in event
          ? (event as CustomEvent<{
              orgId?: string | null;
              transactionId?: string | null;
              tokenBalance?: number | null;
              tokensGranted?: number | null;
            }>).detail
          : undefined;
      const orgId = String(detail?.orgId ?? '').trim();
      if (!orgId) return;
      const transactionId = String(detail?.transactionId ?? '').trim();
      if (wasOrgTokenPurchaseProcessed(orgId, transactionId)) {
        return;
      }

      let targetBalance = Number(detail?.tokenBalance ?? NaN);
      const purchasedTokens = Number(detail?.tokensGranted ?? NaN);
      const currentStatus = statusByOrg[orgId];
      const knownBalance = Number(currentStatus?.tokenBalance ?? 0);
      const pendingTarget = registerPendingOrgTokenBalance({
        orgId,
        transactionId,
        currentBalance: knownBalance,
        tokenBalance: targetBalance,
        tokensGranted: purchasedTokens,
      });

      setStatusByOrg(prev => {
        const current = prev[orgId];
        if (!current && !Number.isFinite(pendingTarget)) {
          return prev;
        }
        const optimisticBalance = Number.isFinite(targetBalance)
          ? targetBalance
          : Number(pendingTarget);
        if (!Number.isFinite(optimisticBalance)) {
          return prev;
        }
        targetBalance = optimisticBalance;
        return {
          ...prev,
          ...(current
            ? { [orgId]: applyOrgBalanceSnapshot(current, optimisticBalance) }
            : {}),
        };
      });

      if (Number.isFinite(targetBalance)) {
        void reconcileOrgStatus(orgId, targetBalance);
      }
    };

    window.addEventListener('org-token-purchase-complete', handleTokenPurchaseComplete as EventListener);
    return () => {
      window.removeEventListener('org-token-purchase-complete', handleTokenPurchaseComplete as EventListener);
    };
  }, [reconcileOrgStatus, statusByOrg]);

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
              <h1 className="text-3xl font-semibold">Your Organizations</h1>
              <p className="text-sm text-slate-600">Create organizations for free and manage owner tokens as usage grows.</p>
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
              <CardDescription>Set member capacity, estimate monthly AI usage, and launch immediately.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              Organization creation is free. Credits are only consumed as members use AI.
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
              Join instantly and collaborate without seeing billing or token balances.
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
            <p className="text-sm text-slate-600">Open a workspace, check AI availability, or manage tokens if you own it.</p>
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
                const status = statusByOrg[org.id];
                const isOwner = org.role === 'owner';
                return (
                  <Card key={org.id} className="rounded-[28px] border border-slate-200 bg-white/85 shadow-sm">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">{org.name}</CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge variant="secondary">{roleLabel(org.role)}</Badge>
                            {status ? (
                              <Badge variant={healthVariant(status.tokenHealth)}>
                                {availabilityLabel(status.aiAvailability)}
                              </Badge>
                            ) : null}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Users className="h-4 w-4" />
                          <span>
                            {status?.activeUsers ?? 0}/{status?.memberLimit ?? 0}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-slate-600">
                      <div className="rounded-[24px] bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span>Estimated monthly usage</span>
                          <span className="font-semibold text-slate-900">
                            {(status?.estimatedMonthlyTokens ?? 0).toLocaleString()} tokens
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span>Daily AI requests per member</span>
                          <span className="font-semibold text-slate-900">{status?.dailyAiLimitPerUser ?? 0}</span>
                        </div>
                      </div>

                      {isOwner ? (
                        <div className="rounded-[24px] border border-emerald-100 bg-emerald-50 px-4 py-3">
                          <div className="flex items-center gap-2 font-medium text-emerald-900">
                            <Coins className="h-4 w-4" />
                            {(status?.tokenBalance ?? 0).toLocaleString()} tokens remaining
                          </div>
                          <p className="mt-1 text-xs text-emerald-800">
                            {status?.estimatedDaysRemaining ?? 0} estimated days remaining at current usage.
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
                          {status?.aiAvailability === 'paused'
                            ? 'AI temporarily unavailable for this organization right now.'
                            : 'AI availability is managed by the organization owner.'}
                        </div>
                      )}

                      {status?.aiAvailability === 'limited' ? (
                        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                          AI availability may be limited soon.
                        </div>
                      ) : null}
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
                          <Sparkles className="mr-2 h-4 w-4" />
                          Tokens
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
                    Create Organization
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/orgs/join')} className="rounded-2xl">
                    Join Organization
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
