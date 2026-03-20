'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { clearSelectedGroupId, setSelectedOrgId } from '@/lib/selection';
import { UpgradePlanDialog } from '@/components/orgs/upgrade-plan-dialog';
import { Logo } from '@/components/icons';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function OrgJoinPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [joinCode, setJoinCode] = useState('');
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const joinViaRpc = async (normalizedCode: string) => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('join_org', { p_join_code: normalizedCode });
    if (error) {
      return { ok: false as const, message: error.message || 'Unable to join organization.' };
    }
    if (!data) {
      return { ok: false as const, message: 'Join succeeded but no organization id was returned.' };
    }
    return { ok: true as const, orgId: String(data) };
  };

  const handleJoinOrg = async () => {
    const normalized = joinCode.trim().toUpperCase();
    if (!normalized) {
      toast({ title: 'Missing code', description: 'Enter a join code.', variant: 'destructive' });
      return;
    }
    if (normalized.length < 3) {
      toast({ title: 'Invalid code', description: 'Join code must be at least 3 characters.', variant: 'destructive' });
      return;
    }
    setJoinSubmitting(true);
    try {
      const response = await fetch('/api/orgs/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinCode: normalized }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const isFull = result?.error?.code === 'ORG_FULL';
        if (isFull) setUpgradeOpen(true);
        toast({
          title: 'Join failed',
          description: isFull
            ? 'Organization is at capacity.'
            : result?.error?.message || 'Unable to join organization.',
          variant: 'destructive',
        });
        return;
      }
      if (!result?.orgId) {
        toast({
          title: 'Join failed',
          description: 'Join succeeded but no organization id was returned.',
          variant: 'destructive',
        });
        return;
      }
      setSelectedOrgId(result.orgId);
      clearSelectedGroupId();
      router.push('/clubs');
    } catch (error) {
      const fallback = await joinViaRpc(normalized);
      if (fallback.ok) {
        setSelectedOrgId(fallback.orgId);
        clearSelectedGroupId();
        router.push('/clubs');
        return;
      }
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: string }).message)
          : 'Unable to reach the server. Please try again.';
      toast({
        title: 'Network error',
        description: fallback.message || message,
        variant: 'destructive',
      });
    } finally {
      setJoinSubmitting(false);
    }
  };

  return (
    <div className="viewport-page bg-emerald-50/70 text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_circle_at_-10%_-20%,rgba(16,185,129,0.25),transparent_60%),radial-gradient(900px_circle_at_110%_10%,rgba(34,197,94,0.24),transparent_55%),radial-gradient(900px_circle_at_40%_120%,rgba(74,222,128,0.2),transparent_60%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/70 via-transparent to-emerald-50/60" />
      </div>

      <div className="viewport-scroll relative mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-lg">
              <Logo className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">CASPO</p>
              <h1 className="text-3xl font-semibold">Join organization</h1>
              <p className="text-sm text-slate-600">Use your invite code to get started.</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => router.push('/orgs')}>
            Back to organizations
          </Button>
        </header>

        <Card className="border border-slate-200 bg-white/70 shadow-lg backdrop-blur">
          <CardHeader>
            <CardTitle className="text-xl">Join with code</CardTitle>
            <CardDescription>Already invited? Enter your code.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="join-code">Join Code</Label>
              <Input
                id="join-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="ABCD"
                maxLength={8}
              />
              <p className="text-xs text-slate-500">Letters and numbers only.</p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-2">
            <Button onClick={handleJoinOrg} disabled={joinSubmitting || !joinCode.trim()}>
              {joinSubmitting ? 'Joining...' : 'Join organization'}
            </Button>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Use your org&apos;s code. If you don&apos;t have it, ask an admin.
            </div>
          </CardFooter>
        </Card>
      </div>

        <UpgradePlanDialog
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          title="Organization at capacity"
          description="This organization is full. Ask the owner to raise the member limit."
          primaryLabel="Got it"
          onPrimary={() => setUpgradeOpen(false)}
      />
    </div>
  );
}
