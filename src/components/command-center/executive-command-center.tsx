"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Download,
  GraduationCap,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type ExecutiveDashboardPayload,
  type SearchIndexEntry,
} from "@/lib/command-center-analytics";
import { safeFetchJson } from "@/lib/network";

type ExecutiveCommandCenterProps = {
  onExploreOrg: (orgId: string) => void;
};

const formatPercent = (value: number | null | undefined) =>
  typeof value === "number" ? `${value}%` : "--";

const filterSearchEntries = (entries: SearchIndexEntry[], query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return entries.slice(0, 8);
  return entries
    .filter(entry =>
      [entry.label, entry.detail, entry.orgName, entry.groupName ?? "", entry.type]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    )
    .slice(0, 10);
};

export function ExecutiveCommandCenter({ onExploreOrg }: ExecutiveCommandCenterProps) {
  const [dashboard, setDashboard] = useState<ExecutiveDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const result = await safeFetchJson<{ ok: true; data: ExecutiveDashboardPayload }>(
        "/api/executive-dashboard",
        { method: "GET", timeoutMs: 12_000, retry: { retries: 1 } }
      );
      if (!active) return;
      if (!result.ok) {
        setError(result.error.message);
        setLoading(false);
        return;
      }
      setDashboard(result.data.data);
      setError(null);
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const searchResults = useMemo(
    () => filterSearchEntries(dashboard?.searchIndex ?? [], query),
    [dashboard?.searchIndex, query]
  );

  if (loading) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-44 rounded-lg" />
      </section>
    );
  }

  if (error || !dashboard) {
    return (
      <Card className="rounded-lg border-border/70">
        <CardContent className="p-4 text-sm text-muted-foreground">
          {error ? `Executive command center unavailable: ${error}` : "Executive command center unavailable."}
        </CardContent>
      </Card>
    );
  }

  if (dashboard.ownedOrgCount === 0) {
    return (
      <Card className="rounded-lg border-border/70">
        <CardContent className="p-4 text-sm text-muted-foreground">
          This dashboard appears once you own at least one organization.
        </CardContent>
      </Card>
    );
  }

  const kpis = [
    {
      label: "Total Impacted Students",
      value: dashboard.kpis.totalImpactedStudents.toLocaleString(),
      icon: Users,
    },
    {
      label: "District-Wide Compliance",
      value: formatPercent(dashboard.kpis.districtCompliancePercent),
      icon: ShieldCheck,
    },
    {
      label: "Total Resource Hours",
      value: dashboard.kpis.totalResourceHours.toLocaleString(),
      icon: GraduationCap,
    },
    {
      label: "Tasks Automated",
      value: dashboard.kpis.tasksAutomated.toLocaleString(),
      icon: Bot,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
            Executive Command Center
          </p>
          <h2 className="text-2xl font-semibold text-foreground">District operations overview</h2>
        </div>
        <Button variant="outline" className="h-9 rounded-lg" asChild>
          <a href="/api/executive-dashboard?format=pdf" download="caspo-engagement-report.pdf">
            <Download className="mr-2 h-4 w-4" />
            Generate PDF Report
          </a>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {kpis.map(item => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="rounded-lg border-border/70 bg-card/95 shadow-sm">
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                </div>
                <Icon className="h-5 w-5 text-emerald-600" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_0.8fr]">
        <div className="space-y-4">
          <Card className="rounded-lg border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Global Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search any student, teacher, or club..."
                  className="h-9 rounded-lg pl-9"
                />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {searchResults.length > 0 ? (
                  searchResults.map(entry => (
                    <button
                      key={entry.id}
                      type="button"
                      className="rounded-lg border border-border/70 px-3 py-2 text-left transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/5"
                      onClick={() => onExploreOrg(entry.orgId)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{entry.label}</p>
                        <Badge variant="secondary" className="rounded-md text-[10px] uppercase">
                          {entry.type}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{entry.detail}</p>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No matches found.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            {dashboard.campuses.map(campus => (
              <Card key={campus.orgId} className="rounded-lg border-border/70 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{campus.orgName}</CardTitle>
                      <p className="text-xs text-muted-foreground">{campus.totalGroups} groups</p>
                    </div>
                    <Badge variant="outline" className="rounded-md">
                      {formatPercent(campus.engagementPercent)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-16">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={campus.healthSparkline}>
                        <Line type="monotone" dataKey="count" stroke="#059669" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Students</p>
                      <p className="font-semibold text-foreground">{campus.impactedStudents}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Compliance</p>
                      <p className="font-semibold text-foreground">{formatPercent(campus.compliancePercent)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Hours</p>
                      <p className="font-semibold text-foreground">{campus.resourceHours}</p>
                    </div>
                  </div>
                  <Button className="h-9 w-full rounded-lg" onClick={() => onExploreOrg(campus.orgId)}>
                    Explore Organization
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Card className="rounded-lg border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              System Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.systemAlerts.length > 0 ? (
              dashboard.systemAlerts.slice(0, 8).map(alert => (
                <div key={alert.id} className="rounded-lg border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                    <Badge
                      variant={alert.level === "critical" ? "destructive" : "secondary"}
                      className="rounded-md text-[10px] uppercase"
                    >
                      {alert.level}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{alert.detail}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No high-priority system alerts.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
