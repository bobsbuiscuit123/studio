'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Coins, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrgAiQuotaStatus } from '@/lib/data-hooks';
import { TokenPackageDialog } from '@/components/orgs/token-package-dialog';

const healthLabel = {
  healthy: 'Healthy',
  low: 'Low',
  urgent: 'Urgent',
  depleted: 'Depleted',
} as const;

const healthVariant = {
  healthy: 'default',
  low: 'secondary',
  urgent: 'secondary',
  depleted: 'destructive',
} as const;

export default function OrgCreditsPage() {
  const params = useParams<{ orgId: string }>();
  const router = useRouter();
  const orgId = typeof params.orgId === 'string' ? params.orgId : null;
  const { status, loading } = useOrgAiQuotaStatus(orgId);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);

  const recentActivity = useMemo(() => status?.recentTokenActivity ?? [], [status?.recentTokenActivity]);

  if (!orgId) {
    return null;
  }

  if (!loading && status?.role !== 'owner') {
    return (
      <div className="viewport-page bg-background">
        <div className="viewport-scroll mx-auto flex min-h-[100dvh] max-w-3xl items-center justify-center px-4 py-8">
          <Card className="w-full rounded-[28px]">
            <CardHeader>
              <CardTitle>Token billing unavailable</CardTitle>
              <CardDescription>Only the organization owner can view token balance and billing activity.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={() => router.push('/orgs')} className="rounded-2xl">
                Back to organizations
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="viewport-page bg-background text-slate-900">
      <div className="viewport-scroll mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Button variant="ghost" className="mb-3 rounded-2xl px-0 text-slate-600" onClick={() => router.push('/orgs')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to organizations
            </Button>
            <h1 className="text-3xl font-semibold">{status?.orgName ?? 'Organization token billing'}</h1>
            <p className="text-sm text-slate-600">Manage owner tokens, projected usage, and recent activity.</p>
          </div>
          <Button className="rounded-2xl" onClick={() => setTokenDialogOpen(true)}>
            <Sparkles className="mr-2 h-4 w-4" />
            Buy Tokens
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Current token balance</CardDescription>
              <CardTitle className="text-3xl">{Number(status?.tokenBalance ?? 0).toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">Tokens remaining</CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Estimated monthly usage</CardDescription>
              <CardTitle className="text-3xl">{Number(status?.estimatedMonthlyTokens ?? 0).toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">Tokens per month</CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Estimated daily usage</CardDescription>
              <CardTitle className="text-3xl">{Number(status?.estimatedDailyTokens ?? 0).toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">Tokens per day</CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Estimated days remaining</CardDescription>
              <CardTitle className="text-3xl">{Number(status?.estimatedDaysRemaining ?? 0)}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">At current usage</CardContent>
          </Card>
        </div>

        <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Token health</CardTitle>
              <CardDescription>
                {status?.tokenHealth === 'depleted'
                  ? 'AI is paused for members until more tokens are added.'
                  : status?.tokenHealth === 'urgent'
                    ? 'Your organization may run out of AI tokens soon.'
                    : status?.tokenHealth === 'low'
                      ? 'Your organization tokens are running low.'
                      : 'Your organization has a healthy token runway.'}
              </CardDescription>
            </div>
            <Badge variant={healthVariant[status?.tokenHealth ?? 'healthy']}>
              {healthLabel[status?.tokenHealth ?? 'healthy']}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Daily AI requests per member</span>
                <span className="font-semibold text-slate-900">{status?.dailyAiLimitPerUser ?? 0}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span>Members using this org</span>
                <span className="font-semibold text-slate-900">{status?.activeUsers ?? 0}</span>
              </div>
            </div>
            <div className="rounded-[24px] border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
              <div className="flex items-center gap-2 font-medium">
                <Coins className="h-4 w-4" />
                {Number(status?.tokenBalance ?? 0).toLocaleString()} tokens remaining
              </div>
              <p className="mt-2 text-xs text-emerald-800">
                At current usage, you have about {Number(status?.estimatedDaysRemaining ?? 0)} day(s) remaining.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Recent token activity</CardTitle>
            <CardDescription>Trial grants and AI usage across this organization.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivity.length > 0 ? (
              recentActivity.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-[24px] border border-slate-200 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{item.description}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className={`shrink-0 font-semibold ${item.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {item.amount >= 0 ? '+' : ''}
                    {Number(item.amount).toLocaleString()} tokens
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                No token activity yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TokenPackageDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        title="Buy tokens"
        description="Choose a token package, then confirm your purchase with Apple on the next step."
        orgId={orgId}
      />
    </div>
  );
}
