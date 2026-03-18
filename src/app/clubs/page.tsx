"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy, LogIn, Pencil, PlusCircle, Trash2, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearSelectedGroupId, clearSelectedOrgId, getSelectedOrgId, setSelectedGroupId } from "@/lib/selection";
import { safeFetchJson } from "@/lib/network";
import { faker } from "@faker-js/faker";
import { useCurrentUser, useOrgAiQuotaStatus } from "@/lib/data-hooks";
import { Logo } from "@/components/icons";
import { ProfileDialog } from "@/components/profile-dialog";
import { OrgAiQuotaBadge } from "@/components/org-ai-quota-badge";
import { findPolicyViolation, policyErrorMessage } from "@/lib/content-policy";

type Group = {
  id: string;
  name: string;
  description?: string | null;
  join_code?: string | null;
  logo?: string | null;
  role?: string | null;
};

export default function ClubsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();
  const { user, saveUser, clearUser } = useCurrentUser();
  const [groups, setGroups] = useState<Group[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupLogo, setGroupLogo] = useState<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createdGroupPrompt, setCreatedGroupPrompt] = useState<{ groupId: string; joinCode: string } | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupDescription, setEditGroupDescription] = useState("");
  const [editGroupLogo, setEditGroupLogo] = useState<string | null>(null);
  const createGroupLogoInputRef = useRef<HTMLInputElement | null>(null);
  const editGroupLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [isDeleteOrgOpen, setIsDeleteOrgOpen] = useState(false);
  const [deleteOrgSubmitting, setDeleteOrgSubmitting] = useState(false);

  const selectedOrgId = getSelectedOrgId();
  const { status: orgStatus, refresh: refreshOrgStatus } = useOrgAiQuotaStatus(selectedOrgId);

  const formatDate = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(new Date(value))
      : "Unknown";

  const handleScheduleOrgDeletion = async () => {
    if (!selectedOrgId) return;
    setDeleteOrgSubmitting(true);
    const response = await safeFetchJson<{ ok: boolean; data?: { serviceEndsAt: string } }>(
      `/api/orgs/${selectedOrgId}/cancel`,
      {
        method: "POST",
      }
    );
    if (!response.ok || !response.data?.ok || !response.data.data?.serviceEndsAt) {
      toast({
        title: "Delete failed",
        description: response.ok ? "Unable to schedule organization deletion." : response.error.message,
        variant: "destructive",
      });
      setDeleteOrgSubmitting(false);
      return;
    }
    await refreshOrgStatus({ silent: true });
    setDeleteOrgSubmitting(false);
    setIsDeleteOrgOpen(false);
    toast({
      title: "Deletion scheduled",
      description: `Organization access will end after ${formatDate(response.data.data.serviceEndsAt)}.`,
    });
  };

  useEffect(() => {
    if (!selectedOrgId) {
      router.replace("/orgs");
      return;
    }
    const load = async () => {
      const { data: authUser } = await supabase.auth.getUser();
      if (!authUser.user) {
        router.replace("/login");
        return;
      }
      const { data: orgMembership, error: orgMembershipError } = await supabase
        .from("memberships")
        .select("org_id")
        .eq("org_id", selectedOrgId)
        .eq("user_id", authUser.user.id)
        .maybeSingle();
      if (orgMembershipError) {
        toast({
          title: "Organization lookup failed",
          description: orgMembershipError.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      if (!orgMembership) {
        clearSelectedGroupId();
        clearSelectedOrgId();
        toast({
          title: "Organization missing",
          description: "Select or create an organization first.",
          variant: "destructive",
        });
        router.replace("/orgs");
        return;
      }
      const { data: groupRows, error: groupError } = await supabase
        .from("groups")
        .select("id,name,description,join_code")
        .eq("org_id", selectedOrgId)
        .order("created_at", { ascending: true });
      if (groupError) {
        toast({ title: "Error", description: groupError.message, variant: "destructive" });
      } else {
        const groupIds = (groupRows || []).map((group) => group.id);
        const logoByGroupId = new Map<string, string>();
        if (groupIds.length > 0) {
          const { data: groupStateRows, error: groupStateError } = await supabase
            .from("group_state")
            .select("group_id,data")
            .eq("org_id", selectedOrgId)
            .in("group_id", groupIds);
          if (groupStateError) {
            toast({ title: "Group icon lookup failed", description: groupStateError.message, variant: "destructive" });
          } else {
            (groupStateRows || []).forEach((row) => {
              const logo = (row.data as { logo?: string } | null)?.logo;
              if (typeof logo === "string" && logo.trim()) {
                logoByGroupId.set(row.group_id, logo);
              }
            });
          }
        }
        setGroups(
          (groupRows || []).map((group) => ({
            ...group,
            logo: logoByGroupId.get(group.id) || null,
          }))
        );
      }
      const { data: membershipRows, error: membershipError } = await supabase
        .from("group_memberships")
        .select("group_id,role")
        .eq("org_id", selectedOrgId)
        .eq("user_id", authUser.user.id);
      if (membershipError) {
        toast({
          title: "Group membership lookup failed",
          description: membershipError.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      const ids = new Set<string>((membershipRows || []).map((row) => row.group_id));
      setMemberGroupIds(ids);
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          role: (membershipRows || []).find((row) => row.group_id === group.id)?.role ?? null,
        }))
      );
      setLoading(false);
    };
    load();
  }, [router, selectedOrgId, supabase, toast]);

  const handleJoinClub = async () => {
    if (!selectedOrgId) return;
    if (!joinCode.trim()) {
      toast({ title: "Missing code", description: "Enter a group join code.", variant: "destructive" });
      return;
    }
    const response = await safeFetchJson<{ ok: boolean; groupId?: string; error?: { message?: string } }>(
      "/api/groups/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: selectedOrgId, joinCode: joinCode.trim().toUpperCase() }),
      }
    );
    if (!response.ok || !response.data?.ok || !response.data.groupId) {
      const message =
        !response.ok
          ? response.error.message
          : response.data?.error?.message || "Failed to join group.";
      toast({ title: "Join failed", description: message, variant: "destructive" });
      return;
    }
    setSelectedGroupId(response.data.groupId);
    router.push("/dashboard");
  };

  const handleCreateClub = async () => {
    if (!selectedOrgId) return;
    if (!groupName.trim()) {
      toast({ title: "Missing name", description: "Enter a group name.", variant: "destructive" });
      return;
    }
    if (findPolicyViolation(groupName) || findPolicyViolation(groupDescription)) {
      toast({ title: "Content blocked", description: policyErrorMessage, variant: "destructive" });
      return;
    }
    const joinCode = faker.string.alphanumeric(4).toUpperCase();
    const response = await safeFetchJson<{ ok: boolean; groupId?: string; joinCode?: string; error?: { message?: string } }>(
      "/api/groups/create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: selectedOrgId,
          name: groupName.trim(),
          description: groupDescription.trim(),
          joinCode,
          logo: groupLogo || "",
        }),
      }
    );
    if (!response.ok || !response.data?.ok || !response.data.groupId) {
      const message =
        !response.ok
          ? response.error.message
          : response.data?.error?.message || "Failed to create group.";
      toast({ title: "Create failed", description: message, variant: "destructive" });
      return;
    }
    setIsCreateDialogOpen(false);
    setGroupName("");
    setGroupDescription("");
    setGroupLogo(null);
    if (response.data.joinCode) {
      setCreatedGroupPrompt({
        groupId: response.data.groupId,
        joinCode: response.data.joinCode,
      });
      return;
    }
    setSelectedGroupId(response.data.groupId);
    router.push("/dashboard");
  };

  const handleEnterClub = (groupId: string) => {
    setSelectedGroupId(groupId);
    router.push("/dashboard");
  };

  const canShowCreate = true;
  const createDisabled = false;

  const handleBackToOrgs = () => {
    clearSelectedGroupId();
    router.push("/orgs");
  };

  const handleSaveProfile = async (updatedUser: Partial<{ name: string; avatar?: string }>) => {
    if (!user) return;
    await saveUser((currentUser) => ({ ...(currentUser ?? user), ...updatedUser }));
  };

  const handleCopyCreatedGroupJoinCode = async () => {
    if (!createdGroupPrompt?.joinCode) return;
    await navigator.clipboard.writeText(createdGroupPrompt.joinCode);
    toast({ title: "Copied", description: "Join code copied to clipboard." });
  };

  const handleOpenEditGroup = (group: Group) => {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditGroupDescription(group.description || "");
    setEditGroupLogo(group.logo || null);
  };

  const handleEditGroupLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setEditGroupLogo(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateGroupLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setGroupLogo(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveGroupEdits = async () => {
    if (!selectedOrgId || !editingGroup) return;
    if (!editGroupName.trim()) {
      toast({ title: "Missing name", description: "Enter a group name.", variant: "destructive" });
      return;
    }
    if (findPolicyViolation(editGroupName) || findPolicyViolation(editGroupDescription)) {
      toast({ title: "Content blocked", description: policyErrorMessage, variant: "destructive" });
      return;
    }
    const response = await safeFetchJson<{
      ok: boolean;
      data?: { groupId: string; name: string; description: string; logo: string };
      error?: { message?: string };
    }>("/api/groups/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: selectedOrgId,
        groupId: editingGroup.id,
        name: editGroupName.trim(),
        description: editGroupDescription.trim(),
        logo: editGroupLogo || "",
      }),
    });
    if (!response.ok || !response.data?.ok || !response.data.data) {
      const message =
        !response.ok
          ? response.error.message
          : response.data?.error?.message || "Failed to update group.";
      toast({ title: "Update failed", description: message, variant: "destructive" });
      return;
    }
    setGroups((prev) =>
      prev.map((group) =>
        group.id === editingGroup.id
          ? {
              ...group,
              name: response.data!.data!.name,
              description: response.data!.data!.description,
              logo: response.data!.data!.logo || null,
            }
          : group
      )
    );
    setEditingGroup(null);
    toast({ title: "Group updated", description: "Your group details were saved." });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearUser();
    clearSelectedGroupId();
    router.replace("/login");
  };

  const handleDeleted = async () => {
    await supabase.auth.signOut();
    clearUser();
    clearSelectedGroupId();
    router.replace("/login");
  };

  const displayedGroups = groups.filter((group) => memberGroupIds.has(group.id));
  const groupsWithLogos = displayedGroups.map((group) => ({
    ...group,
    logo: group.logo || `https://placehold.co/100x100.png?text=${group.name.charAt(0)}`,
  }));

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <div className="flex justify-center items-center gap-4 mb-4">
          <Logo className="h-12 w-12 text-primary" />
          <h1 className="text-5xl font-bold">CASPO</h1>
        </div>
        <p className="text-muted-foreground text-lg">Your all-in-one club management platform.</p>
      </div>

      <div className="w-full max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold">Your Groups</h2>
            <OrgAiQuotaBadge orgId={selectedOrgId} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleBackToOrgs}>
              Switch Organizations
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">
                  <UserPlus className="mr-2" /> Join Group
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Join a Group</DialogTitle>
                  <DialogDescription>
                    Enter the 4-character join code provided by the group admin.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="group-join-code">Join Code</Label>
                  <Input
                    id="group-join-code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="ABCD"
                    maxLength={8}
                  />
                </div>
                <DialogFooter>
                  <Button onClick={handleJoinClub}>Join Group</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {canShowCreate && (
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button disabled={createDisabled}>
                    <PlusCircle className="mr-2" /> Create Group
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Group</DialogTitle>
                    <DialogDescription>Set up a new group inside this organization.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div className="flex flex-col items-center gap-2">
                      <Image
                        src={groupLogo || `https://placehold.co/100x100.png?text=${(groupName || "G").charAt(0)}`}
                        alt="Group logo preview"
                        width={96}
                        height={96}
                        className="rounded-lg aspect-square object-cover border"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => createGroupLogoInputRef.current?.click()}>
                        Change Picture
                      </Button>
                      <Input
                        ref={createGroupLogoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleCreateGroupLogoChange}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="group-name">Group Name</Label>
                      <Input id="group-name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="group-description">Description</Label>
                      <Input id="group-description" value={groupDescription} onChange={(e) => setGroupDescription(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCreateClub}>Create Group</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">Loading clubs...</p>
          </div>
        ) : groupsWithLogos.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groupsWithLogos.map((group) => (
               <Card key={group.id} className="relative">
                 {group.role === "admin" && (
                   <Button
                     type="button"
                     variant="ghost"
                     size="icon"
                     className="absolute right-3 top-3 z-10 h-8 w-8"
                     onClick={() => handleOpenEditGroup(group)}
                   >
                     <Pencil className="h-4 w-4" />
                     <span className="sr-only">Edit group</span>
                   </Button>
                 )}
                 <CardHeader className="flex-row items-center gap-4">
                   <Image
                     src={group.logo}
                    alt={`${group.name} logo`}
                    width={64}
                    height={64}
                    className="rounded-lg aspect-square object-cover"
                  />
                  <div>
                    <CardTitle>{group.name}</CardTitle>
                    <CardDescription>Manage this club</CardDescription>
                  </div>
                </CardHeader>
                <CardFooter>
                  <Button className="w-full" onClick={() => handleEnterClub(group.id)}>
                    Open Dashboard <ArrowRight className="ml-2" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">You haven't created or joined any clubs yet.</p>
            <p className="text-muted-foreground">Click "Create Group" or "Join Group" to get started!</p>
          </div>
        )}
      </div>
      <div className="mt-8 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setIsProfileOpen(true)}>
          <User className="mr-2" /> Profile
        </Button>
        {orgStatus?.role?.toLowerCase() === "owner" ? (
          <Button variant="outline" onClick={() => setIsDeleteOrgOpen(true)}>
            <Trash2 className="mr-2" /> Delete Organization
          </Button>
        ) : null}
        <Button variant="outline" onClick={handleLogout}>
          <LogIn className="mr-2" /> Log Out
        </Button>
      </div>
      <AlertDialog open={isDeleteOrgOpen} onOpenChange={setIsDeleteOrgOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subscription will end and services will no longer be available after{" "}
              {formatDate(orgStatus?.serviceEndsAt ?? orgStatus?.currentPeriodEnd)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Organization created: {formatDate(orgStatus?.createdAt)}</p>
            <p>Current paid period started: {formatDate(orgStatus?.currentPeriodStart ?? orgStatus?.createdAt)}</p>
            <p>Access remains active until the end of the paid month, even if you delete in the middle of the month.</p>
            {orgStatus?.cancelAtPeriodEnd ? (
              <p className="font-medium text-amber-700">
                This organization is already scheduled to end after {formatDate(orgStatus?.serviceEndsAt ?? orgStatus?.currentPeriodEnd)}.
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteOrgSubmitting}>Keep organization</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleScheduleOrgDeletion();
              }}
              disabled={deleteOrgSubmitting || orgStatus?.cancelAtPeriodEnd}
            >
              {deleteOrgSubmitting ? "Scheduling..." : orgStatus?.cancelAtPeriodEnd ? "Already scheduled" : "Delete organization"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ProfileDialog
        isOpen={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        user={user}
        onSave={handleSaveProfile}
        onDeleted={handleDeleted}
      />
      <Dialog
        open={Boolean(createdGroupPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedGroupPrompt(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Group Created</DialogTitle>
            <DialogDescription>
              Share this join code with members so they can join your group. In the future, you can find this code in the Members section.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Join Code</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border bg-muted px-3 py-2 text-lg font-semibold tracking-[0.2em]">
                {createdGroupPrompt?.joinCode}
              </div>
              <Button type="button" variant="outline" size="icon" onClick={handleCopyCreatedGroupJoinCode}>
                <Copy className="h-4 w-4" />
                <span className="sr-only">Copy join code</span>
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!createdGroupPrompt) return;
                setSelectedGroupId(createdGroupPrompt.groupId);
                setCreatedGroupPrompt(null);
                router.push("/dashboard");
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editingGroup)} onOpenChange={(open) => !open && setEditingGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
            <DialogDescription>
              Update the group name, description, or profile picture for this group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-2">
              <Image
                src={editGroupLogo || `https://placehold.co/100x100.png?text=${(editGroupName || editingGroup?.name || "G").charAt(0)}`}
                alt="Group logo preview"
                width={96}
                height={96}
                className="rounded-lg aspect-square object-cover border"
              />
              <Button type="button" variant="outline" size="sm" onClick={() => editGroupLogoInputRef.current?.click()}>
                Change Picture
              </Button>
              <Input
                ref={editGroupLogoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleEditGroupLogoChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-group-name">Group Name</Label>
              <Input id="edit-group-name" value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-group-description">Description</Label>
              <Input
                id="edit-group-description"
                value={editGroupDescription}
                onChange={(e) => setEditGroupDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingGroup(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGroupEdits}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
