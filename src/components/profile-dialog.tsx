"use client";

import { useEffect, useRef, useState } from "react";
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

type ProfileDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  user: UserType | null;
  onSave: (updatedUser: Partial<UserType>) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
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
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [deletePlans, setDeletePlans] = useState<Record<string, PlanItem>>({});
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(user?.name || "");
      setEmail(user?.email || "");
      setAvatar(user?.avatar || "");
      setAvatarPreview(user?.avatar || null);
    }
  }, [user, isOpen]);

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
            <DialogTitle>Profile Settings</DialogTitle>
            <DialogDescription>
              Update your profile picture, name, and email here.
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
          </div>
          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <Button
              variant="destructive"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete Account
            </Button>
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
    </>
  );
}
