"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { User as UserType } from "@/lib/mock-data";
import { safeFetchJson } from "@/lib/network";
import { useToast } from "@/hooks/use-toast";
import { LegalDocumentDialog } from "@/components/legal-document-dialog";
import { useOrgAiQuotaStatus } from "@/lib/data-hooks";
import { getSelectedOrgId } from "@/lib/selection";

type ProfileDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  user: UserType | null;
  onSave: (updatedUser: Partial<UserType>) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
  onLogout?: () => Promise<void> | void;
  mode?: 'live' | 'demo';
};

type AdminMember = {
  userId: string;
  email: string;
  name: string;
  role: 'Admin' | 'Officer' | 'Member';
};

type AdminGroup = {
  groupId: string;
  groupName: string;
  members: AdminMember[];
};

type PlanItem = {
  groupId: string;
  action: 'transfer' | 'delete';
  newAdminUserId?: string;
};

export function ProfileDialog({
  isOpen,
  onOpenChange,
  user,
  onSave,
  onDeleted,
  onLogout,
  mode = 'live',
}: ProfileDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [avatar, setAvatar] = useState(user?.avatar || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    user?.avatar || null
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteFinalOpen, setConfirmDeleteFinalOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [legalDialog, setLegalDialog] = useState<"terms" | "privacy" | null>(null);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [deletePlans, setDeletePlans] = useState<Record<string, PlanItem>>({});
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const selectedOrgId = getSelectedOrgId();
  const { status: orgStatus } = useOrgAiQuotaStatus(selectedOrgId);

  useEffect(() => {
    if (isOpen) {
      setName(user?.name || "");
      setEmail(user?.email || "");
      setAvatar(user?.avatar || "");
      setAvatarPreview(user?.avatar || null);
    }
  }, [user, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const fetchBalance = async () => {
      setTokenLoading(true);
      const response = await safeFetchJson<{ ok: true; data: { tokenBalance: number } }>(
        "/api/tokens/wallet",
        { method: "GET" }
      );
      if (!active) return;
      if (response.ok) {
        setTokenBalance(response.data.data.tokenBalance);
      } else {
        setTokenBalance(null);
      }
      setTokenLoading(false);
    };
    void fetchBalance();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const tokensPurchased = Math.max(0, orgStatus?.tokensPurchased ?? 0);
  const tokensUsed = Math.max(0, Math.min(orgStatus?.tokensUsed ?? 0, tokensPurchased));
  const tokensLeft = Math.max(tokensPurchased - tokensUsed, 0);

  const handleBuyMoreTokens = () => {
    if (!selectedOrgId) return;
    onOpenChange(false);
    router.push(`/orgs/${selectedOrgId}/credits`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (user) {
      setIsSaving(true);
      await onSave({
        name,
        avatar: avatarPreview || avatar,
      });
      setIsSaving(false);
    }
    onOpenChange(false);
  };

  const handleDeleteConfirm = async () => {
    setConfirmDeleteFinalOpen(false);
    setConfirmDeleteOpen(false);
    if (mode === 'demo') {
      await onDeleted();
      return;
    }
    setIsDeleting(true);
    const check = await safeFetchJson<{ ok: boolean; adminGroups?: AdminGroup[]; error?: string }>(
      '/api/auth/delete/check',
      { method: 'POST' }
    );
    if (!check.ok || !check.data?.ok) {
      const message =
        !check.ok ? check.error.message : check.data?.error || 'Delete check failed.';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
      setIsDeleting(false);
      return;
    }
    const groups = check.data.adminGroups || [];
    if (groups.length === 0) {
      const deleted = await safeFetchJson<{ ok: boolean; error?: string }>(
        '/api/auth/delete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plans: [] }),
        }
      );
      if (!deleted.ok || !deleted.data?.ok) {
        const message =
          !deleted.ok ? deleted.error.message : deleted.data?.error || 'Delete failed.';
        toast({ title: 'Delete failed', description: message, variant: 'destructive' });
        setIsDeleting(false);
        return;
      }
      setIsDeleting(false);
      await onDeleted();
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
        ...(prev[groupId] ?? { groupId, action: 'transfer' }),
        ...next,
      },
    }));
  };

  const handleLogoutConfirm = async () => {
    setConfirmLogoutOpen(false);
    onOpenChange(false);
    await onLogout?.();
  };

  const handlePlanSubmit = async () => {
    const plans = adminGroups.map((group) => deletePlans[group.groupId]).filter(Boolean) as PlanItem[];
    const allReady = adminGroups.every((group) => {
      const plan = deletePlans[group.groupId];
      if (!plan) return false;
      if (plan.action === 'delete') return true;
      return Boolean(plan.newAdminUserId);
    });
    if (!allReady) {
      toast({
        title: 'Select an action',
        description: 'Choose a transfer target or delete the group for each admin group.',
        variant: 'destructive',
      });
      return;
    }
    setIsDeleting(true);
    const deleted = await safeFetchJson<{ ok: boolean; error?: string }>(
      '/api/auth/delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans }),
      }
    );
    if (!deleted.ok || !deleted.data?.ok) {
      const message =
        !deleted.ok ? deleted.error.message : deleted.data?.error || 'Delete failed.';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
      setIsDeleting(false);
      return;
    }
    setIsDeleting(false);
    setPlanDialogOpen(false);
    await onDeleted();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Update your account details and review legal documents here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2 flex flex-col items-center">
              <Avatar className="h-24 w-24">
                <AvatarImage src={avatarPreview || ""} />
                <AvatarFallback className="text-3xl">
                  {name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Change Picture
              </Button>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} readOnly disabled />
            </div>
            {orgStatus?.role === "owner" && selectedOrgId ? (
              <div className="rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Tokens used / purchased</span>
                  <span className="font-semibold text-slate-900">
                    {tokensUsed.toLocaleString()} / {tokensPurchased.toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {tokensLeft.toLocaleString()} tokens available for this organization.
                </p>
                <p className="text-xs text-muted-foreground">
                  {orgStatus?.estimatedDaysRemaining
                    ? `Estimated ${Math.round(orgStatus.estimatedDaysRemaining)} days remaining at current usage.`
                    : "Estimated days remaining will appear after usage stabilizes."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full rounded-2xl"
                  onClick={handleBuyMoreTokens}
                >
                  Buy more tokens
                </Button>
              </div>
            ) : null}
            <div className="rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Token balance</span>
                {tokenLoading ? (
                  <span className="text-xs">Loading…</span>
                ) : (
                  <span className="font-semibold text-slate-900">
                    {tokenBalance !== null ? tokenBalance.toLocaleString() : "—"} tokens
                  </span>
                )}
              </div>
              <p className="text-xs">
                Your balance updates automatically whenever you buy or receive tokens.
              </p>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <button
                type="button"
                className="flex cursor-pointer items-center justify-between border-b px-4 py-3 text-sm transition-colors active:bg-muted/70"
                onClick={() => setLegalDialog("terms")}
              >
                <span>Terms &amp; Conditions</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                type="button"
                className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm transition-colors active:bg-muted/70"
                onClick={() => setLegalDialog("privacy")}
              >
                <span>Privacy Policy</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              {onLogout ? (
                <Button variant="destructive" onClick={() => setConfirmLogoutOpen(true)}>
                  Log Out
                </Button>
              ) : null}
              <Button
                variant="destructive"
                onClick={() => setConfirmDeleteOpen(true)}
                className="sm:mt-2"
              >
                Delete Account
              </Button>
            </div>
            <div className="flex gap-2 sm:justify-end">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
               <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete your account?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => {
              setConfirmDeleteOpen(false);
              setConfirmDeleteFinalOpen(true);
            }}>
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLogoutOpen} onOpenChange={setConfirmLogoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription>
              You will be signed out of your account and returned to the login screen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmLogoutOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLogoutConfirm}>
              Log Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteFinalOpen} onOpenChange={setConfirmDeleteFinalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm deletion</DialogTitle>
            <DialogDescription>
              This action is permanent. Delete your account?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeleteFinalOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={isDeleting}>
              Yes, delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin ownership required</DialogTitle>
            <DialogDescription>
              You are the admin of one or more groups. Transfer admin to someone else or delete
              the group before deleting your account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {adminGroups.map((group) => {
              const plan = deletePlans[group.groupId];
              return (
                <div key={group.groupId} className="rounded-md border p-3 space-y-3">
                  <div className="font-medium">{group.groupName}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={plan?.action === 'transfer' ? 'secondary' : 'outline'}
                      onClick={() => updatePlan(group.groupId, { action: 'transfer' })}
                    >
                      Transfer admin
                    </Button>
                    <Button
                      type="button"
                      variant={plan?.action === 'delete' ? 'destructive' : 'outline'}
                      onClick={() => updatePlan(group.groupId, { action: 'delete', newAdminUserId: undefined })}
                    >
                      Delete group
                    </Button>
                  </div>
                  {plan?.action === 'transfer' && (
                    <Select
                      value={plan.newAdminUserId || ''}
                      onValueChange={(value) => updatePlan(group.groupId, { newAdminUserId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select new admin" />
                      </SelectTrigger>
                      <SelectContent>
                        {group.members
                          .filter((member) => member.email !== user?.email)
                          .map((member) => (
                            <SelectItem key={member.userId} value={member.userId}>
                              {member.name} ({member.email})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPlanDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePlanSubmit} disabled={isDeleting}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LegalDocumentDialog
        open={legalDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLegalDialog(null);
          }
        }}
        type={legalDialog ?? "terms"}
      />
    </>
  );
}
