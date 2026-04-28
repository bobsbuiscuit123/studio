"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, Lock } from "lucide-react";

import { OrgOwnerCommandCenter } from "@/components/command-center/org-owner-command-center";
import { Logo } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgSubscriptionStatus } from "@/lib/org-subscription-hooks";
import { getSelectedOrgId, setSelectedGroupId, syncSelectionCookies } from "@/lib/selection";

export default function OrgOwnerDashboardPageClient() {
  const router = useRouter();
  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(null);
  const { status: orgStatus, loading: statusLoading } = useOrgSubscriptionStatus(selectedOrgId);
  const isOrgOwner = orgStatus?.role?.toLowerCase() === "owner";

  useEffect(() => {
    const syncedSelection = syncSelectionCookies();
    const orgId = syncedSelection.orgId ?? getSelectedOrgId();
    setSelectedOrgIdState(orgId);
    if (!orgId) {
      router.replace("/orgs");
    }
  }, [router]);

  const handleOpenGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    syncSelectionCookies();
    router.push("/dashboard");
  };

  return (
    <div className="viewport-page bg-background text-foreground">
      <div className="viewport-scroll relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-4 border-b border-border/70 pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 shadow-sm dark:bg-emerald-500/15 dark:text-emerald-300">
              <Logo className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">
                <BarChart3 className="h-3.5 w-3.5" />
                Org Owner Dashboard
              </p>
              <h1 className="text-2xl font-semibold text-foreground">Organization Command Center</h1>
            </div>
          </div>
          <Button variant="outline" className="rounded-lg" onClick={() => router.push("/clubs")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Groups
          </Button>
        </header>

        {!selectedOrgId || statusLoading ? (
          <section className="space-y-3">
            <Skeleton className="h-8 w-72" />
            <div className="grid gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-lg" />
          </section>
        ) : isOrgOwner ? (
          <OrgOwnerCommandCenter orgId={selectedOrgId} isOwner={isOrgOwner} onOpenGroup={handleOpenGroup} />
        ) : (
          <Alert className="rounded-lg border-border/70 bg-card">
            <Lock className="h-4 w-4" />
            <AlertTitle>Owner access required</AlertTitle>
            <AlertDescription>
              The organization command center is only available to the org owner. You can still open your groups from the group selector.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
