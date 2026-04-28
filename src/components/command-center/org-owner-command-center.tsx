"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CalendarDays, Download, ShieldCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildEngagementReportCsv,
  COMMAND_CENTER_HEATMAP_HOURS,
  type HeatmapCell,
  type OrgDashboardGroupRow,
  type OrgDashboardPayload,
} from "@/lib/command-center-analytics";
import { safeFetchJson } from "@/lib/network";
import { cn } from "@/lib/utils";

type OrgOwnerCommandCenterProps = {
  orgId: string | null;
  isOwner: boolean;
  onOpenGroup: (groupId: string) => void;
};

const formatPercent = (value: number | null | undefined) =>
  typeof value === "number" ? `${value}%` : "--";

const formatDate = (value?: string | null) => {
  if (!value) return "No activity";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No activity";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
};

const saveCsv = (filename: string, csv: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const statusBadgeClass = (status: OrgDashboardGroupRow["status"]) =>
  status === "active"
    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700"
    : status === "inactive"
      ? "border-amber-500/50 bg-amber-500/10 text-amber-700"
      : "border-red-500/50 bg-red-500/10 text-red-700";

const heatmapClass = (count: number, maxCount: number) => {
  if (count === 0 || maxCount === 0) return "bg-muted/40";
  const ratio = count / maxCount;
  if (ratio >= 0.75) return "bg-emerald-700";
  if (ratio >= 0.5) return "bg-emerald-500";
  if (ratio >= 0.25) return "bg-emerald-300";
  return "bg-emerald-100";
};

function EngagementHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const maxCount = Math.max(0, ...cells.map(cell => cell.count));
  const cellByKey = new Map(cells.map(cell => [`${cell.day}-${cell.hour}`, cell]));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[34px_repeat(14,minmax(0,1fr))] gap-1 text-[10px] text-muted-foreground">
        <div />
        {COMMAND_CENTER_HEATMAP_HOURS.map(hour => (
          <div key={hour} className="text-center">
            {hour > 12 ? hour - 12 : hour}
          </div>
        ))}
        {days.map(day => (
          <div key={day} className="contents">
            <div className="flex items-center text-[10px] font-medium">{day}</div>
            {COMMAND_CENTER_HEATMAP_HOURS.map(hour => {
              const cell = cellByKey.get(`${day}-${hour}`);
              return (
                <div
                  key={`${day}-${hour}`}
                  title={`${cell?.label ?? day}: ${cell?.count ?? 0} meetings`}
                  className={cn("h-5 rounded-sm border border-border/30", heatmapClass(cell?.count ?? 0, maxCount))}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Low</span>
        <span>Peak activity</span>
      </div>
    </div>
  );
}

export function OrgOwnerCommandCenter({ orgId, isOwner, onOpenGroup }: OrgOwnerCommandCenterProps) {
  const [dashboard, setDashboard] = useState<OrgDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !isOwner) {
      setDashboard(null);
      setLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      const result = await safeFetchJson<{ ok: true; data: OrgDashboardPayload }>(
        `/api/org-dashboard?orgId=${encodeURIComponent(orgId)}`,
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
  }, [isOwner, orgId]);

  const kpis = useMemo(() => {
    if (!dashboard) return [];
    return [
      {
        label: "Total Active Members",
        value: dashboard.kpis.totalActiveMembers.toLocaleString(),
        icon: Users,
      },
      {
        label: "Weekly Meeting Density",
        value: dashboard.kpis.weeklyMeetingDensity.toLocaleString(),
        icon: CalendarDays,
      },
      {
        label: "Engagement %",
        value: formatPercent(dashboard.kpis.engagementPercent),
        icon: Activity,
      },
      {
        label: "Compliance %",
        value: formatPercent(dashboard.kpis.compliancePercent),
        icon: ShieldCheck,
      },
    ];
  }, [dashboard]);

  if (!isOwner || !orgId) {
    return null;
  }

  if (loading) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </section>
    );
  }

  if (error || !dashboard) {
    return (
      <Card className="rounded-lg border-border/70">
        <CardContent className="p-4 text-sm text-muted-foreground">
          {error ? `Command center unavailable: ${error}` : "Command center unavailable."}
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
            Org Owner Command Center
          </p>
          <h2 className="text-2xl font-semibold text-foreground">{dashboard.org.name}</h2>
        </div>
        <Button
          variant="outline"
          className="h-9 rounded-lg"
          onClick={() =>
            saveCsv(
              `${dashboard.org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-engagement-report.csv`,
              buildEngagementReportCsv(dashboard.exportRows)
            )
          }
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
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

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.75fr]">
        <Card className="rounded-lg border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Groups Management</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group Name</TableHead>
                  <TableHead>Faculty Sponsor</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.groups.length > 0 ? (
                  dashboard.groups.map(group => (
                    <TableRow key={group.groupId}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-semibold text-foreground hover:text-emerald-700"
                          onClick={() => onOpenGroup(group.groupId)}
                        >
                          {group.groupName}
                        </button>
                      </TableCell>
                      <TableCell>
                        {group.sponsor ? (
                          <div>
                            <p className="text-sm font-medium text-foreground">{group.sponsor.name}</p>
                            <p className="text-xs text-muted-foreground">{group.sponsor.email || "No email"}</p>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Missing</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{group.memberCount}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(group.lastActivityDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("rounded-md", statusBadgeClass(group.status))}>
                          {group.statusLabel}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                      No groups found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-lg border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Agentic Audit Log
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.auditLog.length > 0 ? (
                dashboard.auditLog.slice(0, 7).map(alert => (
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
                <p className="text-sm text-muted-foreground">No admin flags detected.</p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Engagement Heatmap</CardTitle>
            </CardHeader>
            <CardContent>
              <EngagementHeatmap cells={dashboard.heatmap} />
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
