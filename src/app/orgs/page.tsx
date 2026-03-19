'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { safeFetchJson } from '@/lib/network';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { clearSelectedGroupId, clearSelectedOrgId, setSelectedOrgId } from '@/lib/selection';
import { UpgradePlanDialog } from '@/components/orgs/upgrade-plan-dialog';
import { Logo } from '@/components/icons';
import { Users } from 'lucide-react';

type OrgSummary = {
  id: string;
  name: string;
  role: string;
};

type OrgStatus = {
  orgId: string;
  role: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  maxUserLimit: number;
  dailyCreditPerUser: number;
  activeUsers: number;
  creditsUsedToday: number;
};

const roleLabel = (role: string) => {
  if (role === 'owner') return 'Owner';
  return 'Member';
};

const statusLabel = (status: string) => {
  if (status === 'active' || status === 'trialing') return 'Active';
  if (status === 'past_due' || status === 'unpaid') return 'Past Due';
  if (status === 'canceled') return 'Canceled';
  return 'Inactive';
};

export default function OrgsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [statusByOrg, setStatusByOrg] = useState<Record<string, OrgStatus>>({});
  const [loading, setLoading] = useState(true);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<{
    orgId?: string;
    isAdmin?: boolean;
    kind?: 'capacity' | 'billing';
  }>({});
  const [signOutSubmitting, setSignOutSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: authUser } = await supabase.auth.getUser();
      if (!authUser.user) {
        router.replace('/login');
        return;
      }
      const { data, error } = await supabase
        .from('memberships')
        .select('org_id, role, orgs (id, name)')
        .eq('user_id', authUser.user.id);
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setLoading(false);
        return;
      }
      const mapped = (data || [])
        .map((row: any) => ({
          id: row.orgs?.id || row.org_id,
          name: row.orgs?.name || 'Organization',
          role: row.role,
        }))
        .filter((org: OrgSummary) => Boolean(org.id));
      setOrgs(mapped);
      setLoading(false);

      const statusEntries: Record<string, OrgStatus> = {};
      await Promise.all(
        mapped.map(async org => {
          const statusResult = await safeFetchJson<{ ok: true; data: OrgStatus }>(
            `/api/orgs/${org.id}/status`,
            { method: 'GET' }
          );
          if (statusResult.ok) {
            statusEntries[org.id] = statusResult.data.data;
          }
        })
      );
      setStatusByOrg(statusEntries);
    };
    load();
  }, [router, supabase, toast]);

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

  const handleUpgrade = () => {
    setUpgradeOpen(false);
    toast({
      title: 'IAP not enabled yet',
      description: 'This organization is configured for in-app purchases later, but self-serve billing is not live yet.',
    });
  };

  return (
    <div className="viewport-page bg-emerald-50/70 text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_circle_at_-10%_-20%,rgba(16,185,129,0.25),transparent_60%),radial-gradient(900px_circle_at_110%_10%,rgba(34,197,94,0.24),transparent_55%),radial-gradient(900px_circle_at_40%_120%,rgba(74,222,128,0.2),transparent_60%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/70 via-transparent to-emerald-50/60" />
      </div>

      <div className="viewport-scroll relative mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-lg">
              <Logo className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">CASPO</p>
              <h1 className="text-3xl font-semibold">Your Organizations</h1>
              <p className="text-sm text-slate-600">Create your workspace now and wire up IAP later.</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleSwitchAccount} disabled={signOutSubmitting}>
            {signOutSubmitting ? 'Switching...' : 'Switch account'}
          </Button>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-transparent bg-white/80 shadow-xl backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Create Organization</CardTitle>
              <CardDescription>Save your plan limits now and enable IAP later.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              Build a plan, choose your limits, and create the organization without an external checkout flow.
            </CardContent>
            <CardFooter>
              <Button onClick={() => router.push('/orgs/create')} className="w-full">
                Start setup
              </Button>
            </CardFooter>
          </Card>

          <Card className="border border-slate-200 bg-white/70 shadow-lg backdrop-blur">
            <CardHeader>
              <CardTitle className="text-xl">Join Organization</CardTitle>
              <CardDescription>Already invited? Enter your code to join.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              Have a join code from the owner? Join and start collaborating right away.
            </CardContent>
            <CardFooter>
              <Button variant="outline" onClick={() => router.push('/orgs/join')} className="w-full">
                Join with code
              </Button>
            </CardFooter>
          </Card>
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Your organizations</h2>
              <p className="text-sm text-slate-600">Open a workspace and pick up where you left off.</p>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Card key={idx} className="border border-slate-200 bg-white/70 shadow-sm">
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
                const isActive = status?.status === 'active' || status?.status === 'trialing';
                const creditsLimit = status?.dailyCreditPerUser ?? 0;
                const creditsUsed = status?.creditsUsedToday ?? 0;
                const creditPct = creditsLimit > 0 ? (creditsUsed / creditsLimit) * 100 : 0;
                return (
                  <Card key={org.id} className="border border-slate-200 bg-white/80 shadow-sm">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg">{org.name}</CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge variant="secondary">{roleLabel(org.role)}</Badge>
                            <Badge variant={isActive ? 'default' : 'destructive'}>
                              {statusLabel(status?.status ?? 'inactive')}
                            </Badge>
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Users className="h-4 w-4" />
                          <span>
                            {status?.activeUsers ?? 0}/{status?.maxUserLimit ?? 0}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-600">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span>Credits today</span>
                          <span>
                            {creditsUsed}/{creditsLimit}
                          </span>
                        </div>
                        <Progress value={creditPct} className="h-2" />
                      </div>
                      {!isActive && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Billing is not active for this organization yet.
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="flex items-center gap-2">
                      <Button onClick={() => handleSelectOrg(org.id)} className="flex-1">
                        Open
                      </Button>
                      {!isActive && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setUpgradeContext({
                              orgId: org.id,
                              isAdmin: org.role === 'owner',
                              kind: 'billing',
                            });
                            setUpgradeOpen(true);
                          }}
                        >
                          Billing status
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="border border-dashed border-slate-200 bg-white/70 shadow-sm">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-base font-medium text-slate-900">No organizations yet</p>
                  <p className="text-sm text-slate-600">
                    Create a new workspace or join with a code to get started.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => router.push('/orgs/create')}>Create Organization</Button>
                  <Button variant="outline" onClick={() => router.push('/orgs/join')}>
                    Join Organization
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      <UpgradePlanDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        title={upgradeContext.kind === 'billing' ? 'Billing issue' : 'Organization at capacity'}
        description={
          upgradeContext.kind === 'billing'
            ? upgradeContext.isAdmin
              ? 'This org is set up for future in-app purchases, but billing tools are not live yet.'
              : 'Billing is not active yet. Ask the owner to finish the future IAP setup when it is available.'
            : upgradeContext.isAdmin
              ? 'This organization has reached its member limit. Increase the plan when your IAP flow is ready.'
              : 'This organization is full. Ask the owner to raise the member limit.'
        }
        primaryLabel={
          upgradeContext.kind === 'billing'
            ? upgradeContext.isAdmin
              ? 'IAP later'
              : 'Got it'
            : upgradeContext.isAdmin
              ? 'Review later'
              : 'Got it'
        }
        onPrimary={upgradeContext.isAdmin ? handleUpgrade : () => setUpgradeOpen(false)}
      />
    </div>
  );
}
