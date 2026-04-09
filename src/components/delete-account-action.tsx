"use client";

import { useState, type ComponentProps } from "react";

import { useToast } from "@/hooks/use-toast";
import { safeFetchJson } from "@/lib/network";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AdminMember = {
  userId: string;
  email: string;
  name: string;
  role: "Admin" | "Officer" | "Member";
};

type AdminGroup = {
  groupId: string;
  groupName: string;
  members: AdminMember[];
};

type PlanItem = {
  groupId: string;
  action: "transfer" | "delete";
  newAdminUserId?: string;
};

type DeleteAccountActionProps = {
  onDeleted: () => Promise<void> | void;
  mode?: "live" | "demo";
  userEmail?: string | null;
  label?: string;
  className?: string;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
};

export function DeleteAccountAction({
  onDeleted,
  mode = "live",
  userEmail,
  label = "Delete Account",
  className,
  disabled = false,
  variant = "destructive",
}: DeleteAccountActionProps) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [deletePlans, setDeletePlans] = useState<Record<string, PlanItem>>({});
  const [isDeleting, setIsDeleting] = useState(false);

  const closeAll = () => {
    setConfirmOpen(false);
    setPlanDialogOpen(false);
  };

  const submitDelete = async (plans: PlanItem[]) => {
    const deleted = await safeFetchJson<{ ok: boolean; error?: string }>("/api/auth/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plans }),
    });
    if (!deleted.ok || !deleted.data?.ok) {
      const message =
        !deleted.ok ? deleted.error.message : deleted.data?.error || "Delete failed.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
      return false;
    }

    closeAll();
    await onDeleted();
    return true;
  };

  const startDeleteFlow = async () => {
    setConfirmOpen(false);

    if (mode === "demo") {
      await onDeleted();
      return;
    }

    setIsDeleting(true);
    const check = await safeFetchJson<{ ok: boolean; adminGroups?: AdminGroup[]; error?: string }>(
      "/api/auth/delete/check",
      { method: "POST" }
    );
    if (!check.ok || !check.data?.ok) {
      const message = !check.ok ? check.error.message : check.data?.error || "Delete check failed.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
      setIsDeleting(false);
      return;
    }

    const groups = check.data.adminGroups || [];
    if (groups.length === 0) {
      await submitDelete([]);
      setIsDeleting(false);
      return;
    }

    setAdminGroups(groups);
    setDeletePlans({});
    setPlanDialogOpen(true);
    setIsDeleting(false);
  };

  const updatePlan = (groupId: string, next: Partial<PlanItem>) => {
    setDeletePlans((prev) => ({
      ...prev,
      [groupId]: {
        ...(prev[groupId] ?? { groupId, action: "transfer" }),
        ...next,
      },
    }));
  };

  const handlePlanSubmit = async () => {
    const plans = adminGroups.map((group) => deletePlans[group.groupId]).filter(Boolean) as PlanItem[];
    const allReady = adminGroups.every((group) => {
      const plan = deletePlans[group.groupId];
      if (!plan) return false;
      if (plan.action === "delete") return true;
      return Boolean(plan.newAdminUserId);
    });

    if (!allReady) {
      toast({
        title: "Select an action",
        description: "Choose a transfer target or delete the group for each admin group.",
        variant: "destructive",
      });
      return;
    }

    setIsDeleting(true);
    await submitDelete(plans);
    setIsDeleting(false);
  };

  return (
    <>
      <Button
        variant={variant}
        className={className}
        onClick={() => setConfirmOpen(true)}
        disabled={disabled || isDeleting}
      >
        {isDeleting ? "Deleting..." : label}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
            <DialogDescription>
              This action is permanent. Your account and its data will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void startDeleteFlow()} disabled={isDeleting}>
              Yes, delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={planDialogOpen}
        onOpenChange={(open) => {
          if (!isDeleting) {
            setPlanDialogOpen(open);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin ownership required</DialogTitle>
            <DialogDescription>
              You are the only admin for one or more groups. Transfer admin to someone else or
              delete the group before deleting your account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {adminGroups.map((group) => {
              const plan = deletePlans[group.groupId];
              return (
                <div key={group.groupId} className="space-y-3 rounded-md border p-3">
                  <div className="font-medium">{group.groupName}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={plan?.action === "transfer" ? "secondary" : "outline"}
                      onClick={() => updatePlan(group.groupId, { action: "transfer" })}
                    >
                      Transfer admin
                    </Button>
                    <Button
                      type="button"
                      variant={plan?.action === "delete" ? "destructive" : "outline"}
                      onClick={() =>
                        updatePlan(group.groupId, { action: "delete", newAdminUserId: undefined })
                      }
                    >
                      Delete group
                    </Button>
                  </div>
                  {plan?.action === "transfer" ? (
                    <Select
                      value={plan.newAdminUserId || ""}
                      onValueChange={(value) => updatePlan(group.groupId, { newAdminUserId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select new admin" />
                      </SelectTrigger>
                      <SelectContent>
                        {group.members
                          .filter((member) => member.email !== userEmail)
                          .map((member) => (
                            <SelectItem key={member.userId} value={member.userId}>
                              {member.name} ({member.email})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPlanDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handlePlanSubmit()} disabled={isDeleting}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
