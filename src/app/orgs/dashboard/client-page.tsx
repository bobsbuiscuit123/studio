"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3 } from "lucide-react";

import { ExecutiveCommandCenter } from "@/components/command-center/executive-command-center";
import { Logo } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { clearSelectedGroupId, setSelectedOrgId } from "@/lib/selection";

export default function ExecutiveDashboardPageClient() {
  const router = useRouter();

  const handleExploreOrg = (orgId: string) => {
    setSelectedOrgId(orgId);
    clearSelectedGroupId();
    router.push("/clubs/dashboard");
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
                Executive Dashboard
              </p>
              <h1 className="text-2xl font-semibold text-foreground">Command Center</h1>
            </div>
          </div>
          <Button variant="outline" className="rounded-lg" onClick={() => router.push("/orgs")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Organizations
          </Button>
        </header>

        <ExecutiveCommandCenter onExploreOrg={handleExploreOrg} />
      </div>
    </div>
  );
}
