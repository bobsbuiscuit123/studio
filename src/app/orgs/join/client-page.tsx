'use client';

import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
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
import { normalizeJoinCode } from '@/lib/join-code';
import { cn } from '@/lib/utils';

const isNativeApp = Capacitor.isNativePlatform();

export default function OrgJoinPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [joinCode, setJoinCode] = useState('');
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const pageTextClass = isNativeApp ? 'text-slate-900' : 'text-foreground';
  const eyebrowTextClass = isNativeApp ? 'text-slate-500' : 'text-muted-foreground';
  const subduedTextClass = isNativeApp ? 'text-slate-600' : 'text-muted-foreground';
  const logoShellClass = isNativeApp
    ? 'bg-emerald-100 text-emerald-700 shadow-lg'
    : 'bg-emerald-100 text-emerald-700 shadow-lg dark:bg-emerald-500/15 dark:text-emerald-300';
  const logoIconClass = isNativeApp
    ? 'h-6 w-6 text-emerald-700'
    : 'h-6 w-6 text-emerald-700 dark:text-emerald-300';
  const joinCardClass = isNativeApp
    ? 'border border-slate-200 bg-white/70 shadow-lg backdrop-blur'
    : 'border border-border/70 bg-card/95 shadow-lg backdrop-blur';
  const noteCardClass = isNativeApp
    ? 'rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600'
    : 'rounded-xl border border-border/60 bg-secondary/35 p-3 text-xs text-muted-foreground';

  const completeJoin = (orgId: string) => {
    setSelectedOrgId(orgId);
    clearSelectedGroupId();
    router.push('/clubs');
  };

  const joinViaRpc = async (value: string) => {
    const normalizedCode = normalizeJoinCode(value);
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
    const normalized = normalizeJoinCode(joinCode);
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
        const shouldRetryViaRpc =
          response.status === 401 ||
          result?.error?.message === 'Unauthorized.';
        if (shouldRetryViaRpc) {
          const fallback = await joinViaRpc(normalized);
          if (fallback.ok) {
            completeJoin(fallback.orgId);
            return;
          }
        }
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
      completeJoin(result.orgId);
    } catch (error) {
      const fallback = await joinViaRpc(normalized);
      if (fallback.ok) {
        completeJoin(fallback.orgId);
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
    <div className={cn('viewport-page bg-background', pageTextClass)}>
      <div className="viewport-scroll relative mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', logoShellClass)}>
              <Logo className={logoIconClass} />
            </div>
            <div>
              <p className={cn('text-xs uppercase tracking-[0.3em]', eyebrowTextClass)}>CASPO</p>
              <h1 className="text-3xl font-semibold">Join organization</h1>
              <p className={cn('text-sm', subduedTextClass)}>Use your invite code to get started.</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => router.push('/orgs')}>
            Back to organizations
          </Button>
        </header>

        <Card className={joinCardClass}>
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
                onChange={(e) => setJoinCode(normalizeJoinCode(e.target.value))}
                placeholder="ABCD"
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className={cn('text-xs', eyebrowTextClass)}>Letters and numbers only.</p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-2">
            <Button onClick={handleJoinOrg} disabled={joinSubmitting || !joinCode.trim()}>
              {joinSubmitting ? 'Joining...' : 'Join organization'}
            </Button>
            <div className={noteCardClass}>
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
