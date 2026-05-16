"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  HeartPulse,
  Loader2,
  PlusCircle,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUserRole, useDonors, useMembers } from "@/lib/data-hooks";
import { useIsHopeLinkOrg } from "@/lib/hopelink-features";
import type { DonorRecord } from "@/lib/mock-data";

const donorStatuses = [
  "Registered",
  "Swab kit pending",
  "Follow-up needed",
  "Kit issue",
  "Opted out",
] as const;

const registryPartners = ["DKMS", "NMDP"] as const;
const ageRanges = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;

type NewDonorForm = {
  name: string;
  email: string;
  phone: string;
  ageRange: string;
  registryPartner: string;
  status: string;
  sourceEvent: string;
  assignedVolunteer: string;
  notes: string;
};

const emptyDonorForm: NewDonorForm = {
  name: "",
  email: "",
  phone: "",
  ageRange: "18-24",
  registryPartner: "DKMS",
  status: "Registered",
  sourceEvent: "Manual entry",
  assignedVolunteer: "",
  notes: "",
};

const normalize = (value?: string | null) => String(value ?? "").trim().toLowerCase();

const getStatusBadgeClass = (status: string) => {
  const normalized = normalize(status);
  if (normalized.includes("opted")) return "bg-muted text-muted-foreground";
  if (normalized.includes("issue")) return "bg-red-100 text-red-800";
  if (normalized.includes("follow")) return "bg-amber-100 text-amber-800";
  if (normalized.includes("pending")) return "bg-sky-100 text-sky-800";
  return "bg-emerald-100 text-emerald-800";
};

const riskForStatus = (status: string) => {
  const normalized = normalize(status);
  if (normalized.includes("opted")) return 86;
  if (normalized.includes("issue")) return 78;
  if (normalized.includes("follow")) return 72;
  if (normalized.includes("pending")) return 58;
  return 24;
};

const isFollowUpStatus = (status: string) => {
  const normalized = normalize(status);
  return (
    normalized.includes("follow") ||
    normalized.includes("pending") ||
    normalized.includes("issue")
  );
};

const formatDate = (value?: string | null) => {
  if (!value) return "None";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "None";
  return date.toLocaleDateString();
};

export default function DonorsPage() {
  const isHopeLinkOrg = useIsHopeLinkOrg();
  const { data: donors, updateData: setDonors, loading } = useDonors();
  const { data: members } = useMembers();
  const { canEditContent } = useCurrentUserRole();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NewDonorForm>(emptyDonorForm);

  const safeDonors = useMemo(() => (Array.isArray(donors) ? donors : []), [donors]);
  const memberOptions = useMemo(
    () => members.filter(member => member.email).slice(0, 80),
    [members]
  );

  const donorStats = useMemo(() => {
    const total = safeDonors.length;
    const registered = safeDonors.filter(donor => normalize(donor.status) === "registered").length;
    const needsFollowUp = safeDonors.filter(donor => isFollowUpStatus(donor.status)).length;
    const highRisk = safeDonors.filter(donor => Number(donor.riskScore ?? 0) >= 70).length;
    const dkms = safeDonors.filter(donor => normalize(donor.registryPartner) === "dkms").length;
    const nmdp = safeDonors.filter(donor => normalize(donor.registryPartner) === "nmdp").length;
    return {
      total,
      registered,
      needsFollowUp,
      highRisk,
      dkms,
      nmdp,
      registrationRate: total ? Math.round((registered / total) * 100) : 0,
    };
  }, [safeDonors]);

  const filteredDonors = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return safeDonors;
    return safeDonors.filter(donor =>
      [
        donor.name,
        donor.email,
        donor.phone,
        donor.registryPartner,
        donor.status,
        donor.sourceEvent,
        donor.assignedVolunteer,
      ]
        .map(normalize)
        .some(value => value.includes(needle))
    );
  }, [query, safeDonors]);

  const followUpQueue = useMemo(
    () =>
      safeDonors
        .filter(donor => isFollowUpStatus(donor.status) || Number(donor.riskScore ?? 0) >= 70)
        .sort((left, right) => Number(right.riskScore ?? 0) - Number(left.riskScore ?? 0))
        .slice(0, 8),
    [safeDonors]
  );

  const updateDonor = (donorId: string, patch: Partial<DonorRecord>) => {
    setDonors(current =>
      current.map(donor =>
        donor.id === donorId
          ? {
              ...donor,
              ...patch,
              riskScore:
                patch.status && patch.riskScore === undefined
                  ? riskForStatus(patch.status)
                  : patch.riskScore ?? donor.riskScore,
            }
          : donor
      )
    );
  };

  const handleAddDonor = () => {
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name || !email || !email.includes("@")) {
      toast({
        title: "Donor details needed",
        description: "Add a donor name and valid email before saving.",
        variant: "destructive",
      });
      return;
    }

    const newDonor: DonorRecord = {
      id: `donor-${Date.now()}`,
      name,
      email,
      phone: form.phone.trim(),
      ageRange: form.ageRange,
      registryPartner: form.registryPartner,
      status: form.status,
      sourceEvent: form.sourceEvent.trim() || "Manual entry",
      dateAdded: new Date().toISOString(),
      lastContactedAt: null,
      nextFollowUpAt: isFollowUpStatus(form.status)
        ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
        : null,
      assignedVolunteer: form.assignedVolunteer,
      riskScore: riskForStatus(form.status),
      notes: form.notes.trim(),
    };

    setDonors(current => [newDonor, ...current]);
    setForm(emptyDonorForm);
    setDialogOpen(false);
    toast({ title: "Donor added", description: "HopeLink donor tracking has been updated." });
  };

  if (!isHopeLinkOrg) {
    return (
      <div className="tab-page-shell">
        <div className="tab-page-content">
          <Card>
            <CardHeader>
              <CardTitle>HopeLink donors</CardTitle>
              <CardDescription>
                This donor registry workspace only appears for the seeded HopeLink organization.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="tab-page-shell">
        <div className="tab-page-content">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="tab-page-shell">
      <div className="tab-page-content space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Donor Tracking</h1>
            <p className="text-sm text-muted-foreground">
              Track DKMS/NMDP donor signups, follow-ups, and swab-kit status for HopeLink.
            </p>
          </div>
          {canEditContent ? (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add donor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add donor</DialogTitle>
                  <DialogDescription>
                    Add someone who joined or started the stem cell donor registry process.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="donor-name">Name</Label>
                    <Input id="donor-name" value={form.name} onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="donor-email">Email</Label>
                    <Input id="donor-email" type="email" value={form.email} onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="donor-phone">Phone</Label>
                    <Input id="donor-phone" value={form.phone} onChange={event => setForm(prev => ({ ...prev, phone: event.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Age range</Label>
                    <Select value={form.ageRange} onValueChange={value => setForm(prev => ({ ...prev, ageRange: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ageRanges.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Registry partner</Label>
                    <Select value={form.registryPartner} onValueChange={value => setForm(prev => ({ ...prev, registryPartner: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {registryPartners.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={value => setForm(prev => ({ ...prev, status: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {donorStatuses.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source-event">Source</Label>
                    <Input id="source-event" value={form.sourceEvent} onChange={event => setForm(prev => ({ ...prev, sourceEvent: event.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Assigned volunteer</Label>
                    <Select value={form.assignedVolunteer || "unassigned"} onValueChange={value => setForm(prev => ({ ...prev, assignedVolunteer: value === "unassigned" ? "" : value }))}>
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {memberOptions.map(member => (
                          <SelectItem key={member.email} value={member.email}>{member.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="donor-notes">Notes</Label>
                    <Textarea id="donor-notes" value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button type="button" onClick={handleAddDonor}>Save donor</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Tracked donors" value={donorStats.total} description="Donors in this group." />
          <MetricCard title="Registered" value={`${donorStats.registrationRate}%`} description={`${donorStats.registered} marked registered.`} />
          <MetricCard title="Follow-ups" value={donorStats.needsFollowUp} description="Pending, issue, or reminder needed." />
          <MetricCard title="High risk" value={donorStats.highRisk} description="Donors with churn risk >= 70." />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Donor List</CardTitle>
              <CardDescription>
                DKMS: {donorStats.dkms} · NMDP: {donorStats.nmdp}
              </CardDescription>
              <div className="relative pt-2">
                <Search className="absolute left-3 top-5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search donors, status, partner, or volunteer"
                  className="pl-9"
                />
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Donor</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Follow-up</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDonors.length > 0 ? (
                    filteredDonors.map(donor => (
                      <TableRow key={donor.id}>
                        <TableCell>
                          <div className="font-medium">{donor.name}</div>
                          <div className="text-xs text-muted-foreground">{donor.email}</div>
                        </TableCell>
                        <TableCell>{donor.registryPartner}</TableCell>
                        <TableCell>
                          {canEditContent ? (
                            <Select value={donor.status} onValueChange={value => updateDonor(donor.id, { status: value })}>
                              <SelectTrigger className="h-8 min-w-[150px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {donorStatuses.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge className={getStatusBadgeClass(donor.status)}>{donor.status}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={Number(donor.riskScore ?? 0) >= 70 ? "font-semibold text-red-600" : "font-medium"}>
                            {donor.riskScore ?? 0}
                          </span>
                        </TableCell>
                        <TableCell>{formatDate(donor.nextFollowUpAt)}</TableCell>
                        <TableCell className="text-right">
                          {canEditContent ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                updateDonor(donor.id, {
                                  lastContactedAt: new Date().toISOString(),
                                  status: donor.status === "Follow-up needed" ? "Registered" : donor.status,
                                  nextFollowUpAt: null,
                                  riskScore: donor.status === "Follow-up needed" ? 28 : donor.riskScore,
                                })
                              }
                            >
                              Mark contacted
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">View</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No donors match that search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Follow-up Queue
              </CardTitle>
              <CardDescription>Highest-risk donors to contact next.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {followUpQueue.length > 0 ? (
                followUpQueue.map(donor => (
                  <div key={donor.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{donor.name}</div>
                        <div className="text-xs text-muted-foreground">{donor.sourceEvent}</div>
                      </div>
                      <Badge className={getStatusBadgeClass(donor.status)}>{donor.status}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span>Risk {donor.riskScore ?? 0}</span>
                      <span className="text-muted-foreground">Next: {formatDate(donor.nextFollowUpAt)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No high-risk donors right now.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string | number;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <HeartPulse className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
