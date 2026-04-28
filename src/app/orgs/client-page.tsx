'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, CreditCard, Users } from 'lucide-react';

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
import { readLocalViewCacheRecord, writeLocalViewCache } from '@/lib/local-view-cache';
import { safeFetchJson } from '@/lib/network';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OrgSubscriptionStatus } from '@/lib/org-subscription';
import { clearSelectedGroupId, clearSelectedOrgId, setSelectedOrgId } from '@/lib/selection';

type OrgSummary = {
  id: string;
  name: string;
  role: string;
};

const ORGS_CACHE_TTL_MS = 5 * 60_000;
const ORGS_STALE_CACHE_TTL_MS = 24 * 60 * 60_000;
const ORG_STATUS_CACHE_TTL_MS = 2 * 60_000;
const ORG_STATUS_STALE_CACHE_TTL_MS = 30 * 60_000;
const ORGS_REQUEST_TIMEOUT_MS = 8_000;
const ORG_STATUS_REQUEST_TIMEOUT_MS = 6_500;
const BACKGROUND_LOOKUP_RETRY = { retries: 1, baseDelayMs: 500, maxDelayMs: 1_200 };
const ORG_STATUS_REQUEST_RETRY = { retries: 1, baseDelayMs: 400, maxDelayMs: 1_200 };
const ORGS_CACHE_KEY = 'view-cache:orgs:list';
const orgStatusCacheKey = (orgId: string) => `view-cache:orgs:status:${orgId}`;
let orgListCache: OrgSummary[] | null = null;
let orgListLoadedAt = 0;
const orgStatusCache = new Map<string, OrgSubscriptionStatus>();
const orgStatusLoadedAt = new Map<string, number>();

const isFresh = (loadedAt: number, ttlMs: number) => Date.now() - loadedAt < ttlMs;

const readCachedOrgList = (maxAgeMs: number = ORGS_CACHE_TTL_MS) => {
  if (orgListCache && isFresh(orgListLoadedAt, maxAgeMs)) {
    return orgListCache;
  }

  const persisted = readLocalViewCacheRecord<OrgSummary[]>(ORGS_CACHE_KEY);
  if (!persisted || !isFresh(persisted.savedAt, maxAgeMs)) {
    return null;
  }

  orgListCache = persisted.value;
  orgListLoadedAt = persisted.savedAt;
  return persisted.value;
};

const readCachedOrgStatus = (orgId: string, maxAgeMs: number = ORG_STATUS_CACHE_TTL_MS) => {
  const cachedStatus = orgStatusCache.get(orgId);
  const loadedAt = orgStatusLoadedAt.get(orgId) ?? 0;
  if (cachedStatus && isFresh(loadedAt, maxAgeMs)) {
    return cachedStatus;
  }

  const persisted = readLocalViewCacheRecord<OrgSubscriptionStatus>(orgStatusCacheKey(orgId));
  if (!persisted || !isFresh(persisted.savedAt, maxAgeMs)) {
    return null;
  }

  orgStatusCache.set(orgId, persisted.value);
  orgStatusLoadedAt.set(orgId, persisted.savedAt);
  return persisted.value;
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
  const [orgs, setOrgs] = useState<OrgSummary[]>(() => readCachedOrgList(ORGS_STALE_CACHE_TTL_MS) ?? []);
  const [statusByOrg, setStatusByOrg] = useState<Record<string, OrgSubscriptionStatus>>(() => {
    const initialOrgs = readCachedOrgList(ORGS_STALE_CACHE_TTL_MS) ?? [];
    return initialOrgs.reduce<Record<string, OrgSubscriptionStatus>>((acc, org) => {
      const cachedStatus = readCachedOrgStatus(org.id, ORG_STATUS_STALE_CACHE_TTL_MS);
      if (cachedStatus) {
        acc[org.id] = cachedStatus;
      }
      return acc;
    }, {});
  });
  const [loading, setLoading] = useState(() => {
    const initialOrgs = readCachedOrgList(ORGS_STALE_CACHE_TTL_MS);
    return !initialOrgs;
  });
  const [signOutSubmitting, setSignOutSubmitting] = useState(false);

  const loadStatuses = useCallback(async (orgsToLoad: OrgSummary[]) => {
    const freshStatusIds = new Set<string>();
    const cachedStatuses = orgsToLoad.reduce<Record<string, OrgSubscriptionStatus>>((acc, org) => {
      const freshStatus = readCachedOrgStatus(org.id, ORG_STATUS_CACHE_TTL_MS);
      if (freshStatus) {
        freshStatusIds.add(org.id);
        acc[org.id] = freshStatus;
        return acc;
      }

      const staleStatus = readCachedOrgStatus(org.id, ORG_STATUS_STALE_CACHE_TTL_MS);
      if (staleStatus) {
        acc[org.id] = staleStatus;
      }
      return acc;
    }, {});

    if (Object.keys(cachedStatuses).length > 0) {
      setStatusByOrg(prev => ({ ...prev, ...cachedStatuses }));
    }

    const orgsNeedingStatus = orgsToLoad.filter(org => !freshStatusIds.has(org.id));
    if (orgsNeedingStatus.length === 0) {
      return;
    }

    const statusEntries = await Promise.all(
      orgsNeedingStatus.map(async (org) => {
        const result = await safeFetchJson<{ ok: true; data: OrgSubscriptionStatus }>(
          `/api/orgs/${org.id}/status`,
          {
            method: 'GET',
            timeoutMs: ORG_STATUS_REQUEST_TIMEOUT_MS,
            retry: ORG_STATUS_REQUEST_RETRY,
          }
        );
        return result.ok ? ([org.id, result.data.data] as const) : null;
      })
    );

    setStatusByOrg(
      statusEntries.reduce<Record<string, OrgSubscriptionStatus>>((acc, entry) => {
        if (entry) {
          const [orgId, orgStatus] = entry;
          orgStatusCache.set(orgId, orgStatus);
          orgStatusLoadedAt.set(orgId, Date.now());
          writeLocalViewCache(orgStatusCacheKey(orgId), orgStatus);
          acc[orgId] = orgStatus;
        }
        return acc;
      }, { ...cachedStatuses })
    );
  }, []);

  const load = useCallback(async () => {
    const freshOrgList = readCachedOrgList(ORGS_CACHE_TTL_MS);
    const fallbackOrgList = freshOrgList ?? readCachedOrgList(ORGS_STALE_CACHE_TTL_MS);

    if (fallbackOrgList) {
      setOrgs(fallbackOrgList);
      setLoading(false);
      void loadStatuses(fallbackOrgList);
      if (freshOrgList) {
        return;
      }
    }

    if (!fallbackOrgList) {
      setLoading(true);
    }

    const result = await safeFetchJson<{ ok: true; data: OrgSummary[] }>('/api/orgs', {
      method: 'GET',
      timeoutMs: ORGS_REQUEST_TIMEOUT_MS,
      retry: fallbackOrgList ? BACKGROUND_LOOKUP_RETRY : { retries: 0 },
    });
    if (!result.ok) {
      if (/unauthorized/i.test(result.error.message)) {
        router.replace('/login');
        return;
      }
      if (fallbackOrgList) {
        return;
      }
      toast({ title: 'Error', description: result.error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const orgList = Array.isArray(result.data.data) ? result.data.data : [];
    orgListCache = orgList;
    orgListLoadedAt = Date.now();
    writeLocalViewCache(ORGS_CACHE_KEY, orgList);
    setOrgs(orgList);
    setLoading(false);
    if (orgList.length === 0) {
      setStatusByOrg({});
      return;
    }
    void loadStatuses(orgList);
  }, [loadStatuses, router, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleRefresh = () => {
      void load();
    };

    window.addEventListener('org-subscription-changed', handleRefresh);
    return () => {
      window.removeEventListener('org-subscription-changed', handleRefresh);
    };
  }, [load]);

  const handleSelectOrg = (orgId: string) => {
    setSelectedOrgId(orgId);
    clearSelectedGroupId();
    router.push('/clubs');
  };

  const hasOwnedOrg = orgs.some(org => org.role === 'owner');

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
    <div className="viewport-page bg-background text-foreground">
      <div className="viewport-scroll relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-lg dark:bg-emerald-500/15 dark:text-emerald-300">
              <Logo className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">CASPO</p>
              <h1 className="text-3xl font-semibold text-foreground">Your organizations</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasOwnedOrg ? (
              <Button onClick={() => router.push('/orgs/dashboard')} className="rounded-2xl">
                <BarChart3 className="mr-2 h-4 w-4" />
                Executive Dashboard
              </Button>
            ) : null}
            <Button variant="outline" onClick={handleSwitchAccount} disabled={signOutSubmitting} className="rounded-2xl">
              {signOutSubmitting ? 'Switching...' : 'Switch account'}
            </Button>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="rounded-[28px] border border-border/70 bg-card/95 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Create organization</CardTitle>
              <CardDescription>Set up a new organization.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={() => router.push('/orgs/create')} className="w-full rounded-2xl">
                Start setup
              </Button>
            </CardFooter>
          </Card>

          <Card className="rounded-[28px] border border-border/70 bg-card/90 shadow-lg backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Join organization</CardTitle>
              <CardDescription>Already invited? Enter a join code to get started.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" onClick={() => router.push('/orgs/join')} className="w-full rounded-2xl">
                Join with code
              </Button>
            </CardFooter>
          </Card>
        </div>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Your organizations</h2>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Card key={idx} className="rounded-[28px] border border-border/70 bg-card/90 shadow-sm">
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
                  <Card key={org.id} className="rounded-[28px] border border-border/70 bg-card/95 shadow-sm">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">{org.name}</CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge variant="secondary">{isOwner ? 'Owner' : 'Member'}</Badge>
                            <Badge variant={aiBadgeVariant(status)}>{aiBadgeLabel(status)}</Badge>
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Users className="h-4 w-4" />
                          <span>{status?.activeUsers ?? 0}</span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-muted-foreground">
                      <div className="rounded-[24px] border border-border/60 bg-secondary/35 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span>Plan</span>
                          <span className="font-semibold text-foreground">{status?.planName ?? 'Free'}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span>Monthly allowance</span>
                          <span className="font-semibold text-foreground">
                            {(status?.monthlyTokenLimit ?? 0).toLocaleString()} tokens
                          </span>
                        </div>
                      </div>
                      {isOwner && status && status.ownerHasActiveSubscription && !status.isSubscribedOrg ? (
                        <p className="text-xs text-muted-foreground">
                          This account's paid subscription is assigned to another organization.
                        </p>
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
            <Card className="rounded-[28px] border border-dashed border-border/70 bg-card/90 shadow-sm">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-base font-medium text-foreground">No organizations yet</p>
                  <p className="text-sm text-muted-foreground">Create a new workspace or join with a code to get started.</p>
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
