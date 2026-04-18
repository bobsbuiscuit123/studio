"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Copy, CreditCard, Pencil, PlusCircle, Settings, Trash2, UserPlus } from "lucide-react";
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
import { useCurrentUser } from "@/lib/data-hooks";
import { useOrgSubscriptionStatus } from "@/lib/org-subscription-hooks";
import { Logo } from "@/components/icons";
import { ProfileDialog } from "@/components/profile-dialog";
import { findPolicyViolation, policyErrorMessage } from "@/lib/content-policy";
import { readLocalViewCacheRecord, writeLocalViewCache } from "@/lib/local-view-cache";
import { getPlaceholderImageUrl } from "@/lib/placeholders";
import type { OrgSettings } from "@/lib/org-settings";
import { generateRandomCode } from "@/lib/random-code";

type Group = {
  id: string;
  name: string;
  description?: string | null;
  join_code?: string | null;
  logo?: string | null;
  role?: string | null;
};

type GroupsResponse = {
  ok: boolean;
  data?: {
    groups: Group[];
  };
};

const GROUPS_CACHE_TTL_MS = 5 * 60_000;
const GROUPS_STALE_CACHE_TTL_MS = 24 * 60 * 60_000;
const GROUPS_REQUEST_TIMEOUT_MS = 8_000;
const BACKGROUND_LOOKUP_RETRY = { retries: 1, baseDelayMs: 500, maxDelayMs: 1_200 };
const groupListCache = new Map<string, { groups: Group[]; loadedAt: number }>();
const groupsCacheKey = (orgId: string) => `view-cache:groups:${orgId}`;

const getCachedGroups = (orgId: string, maxAgeMs: number = GROUPS_CACHE_TTL_MS) => {
  const cached = groupListCache.get(orgId);
  if (cached && Date.now() - cached.loadedAt < maxAgeMs) {
    return cached.groups;
  }

  const persisted = readLocalViewCacheRecord<Group[]>(groupsCacheKey(orgId));
  if (!persisted || Date.now() - persisted.savedAt >= maxAgeMs) {
    return null;
  }

  groupListCache.set(orgId, {
    groups: persisted.value,
    loadedAt: persisted.savedAt,
  });
  return persisted.value;
};

export default function ClubsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();
  const { user, saveUser, clearUser } = useCurrentUser();
  const selectedOrgId = getSelectedOrgId();
  const [groups, setGroups] = useState<Group[]>(() =>
    selectedOrgId ? getCachedGroups(selectedOrgId, GROUPS_STALE_CACHE_TTL_MS) ?? [] : []
  );
  const [loading, setLoading] = useState(
    () => (selectedOrgId ? !getCachedGroups(selectedOrgId, GROUPS_STALE_CACHE_TTL_MS) : true)
  );
  const [joinCode, setJoinCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupLogo, setGroupLogo] = useState<string | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createGroupSubmitting, setCreateGroupSubmitting] = useState(false);
  const [createdGroupPrompt, setCreatedGroupPrompt] = useState<{ groupId: string; joinCode: string } | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupDescription, setEditGroupDescription] = useState("");
  const [editGroupLogo, setEditGroupLogo] = useState<string | null>(null);
  const createGroupLogoInputRef = useRef<HTMLInputElement | null>(null);
  const editGroupLogoInputRef = useRef<HTMLInputElement | null>(null);
  const createGroupSubmitLockRef = useRef(false);
  const [isDeleteOrgOpen, setIsDeleteOrgOpen] = useState(false);
  const [deleteOrgSubmitting, setDeleteOrgSubmitting] = useState(false);
  const [isEditOrgOpen, setIsEditOrgOpen] = useState(false);
  const [orgSettingsLoading, setOrgSettingsLoading] = useState(false);
  const [orgJoinCode, setOrgJoinCode] = useState("");

  const { status: orgStatus } = useOrgSubscriptionStatus(selectedOrgId);
  const isOrgOwner = orgStatus?.role?.toLowerCase() === "owner";

  useEffect(() => {
    void router.prefetch("/dashboard");
  }, [router]);

  const formatDate = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(new Date(value))
      : "Unknown";

  const handleDeleteOrganization = async () => {
    if (!selectedOrgId || !isOrgOwner) return;
    setDeleteOrgSubmitting(true);
    const response = await safeFetchJson<{ ok: boolean; data?: { deletedAt: string } }>(
      `/api/orgs/${selectedOrgId}/cancel`,
      {
        method: "POST",
      }
    );
    if (!response.ok || !response.data?.ok || !response.data.data?.deletedAt) {
      toast({
        title: "Delete failed",
        description: response.ok ? "Unable to delete organization." : response.error.message,
        variant: "destructive",
      });
      setDeleteOrgSubmitting(false);
      return;
    }
    setDeleteOrgSubmitting(false);
    setIsDeleteOrgOpen(false);
    clearSelectedOrgId();
    clearSelectedGroupId();
    toast({
      title: "Organization deleted",
      description: "The organization and its subscription mapping were removed.",
    });
    router.push("/orgs");
  };

  const handleOpenEditOrganization = async () => {
    if (!selectedOrgId || !isOrgOwner) return;
    setOrgSettingsLoading(true);
    const response = await safeFetchJson<{ ok: true; data: OrgSettings }>(
      `/api/orgs/${selectedOrgId}/settings`,
      { method: "GET" }
    );
    setOrgSettingsLoading(false);
    if (!response.ok) {
      toast({
        title: "Couldn't load organization settings",
        description: response.error.message,
        variant: "destructive",
      });
      return;
    }
    setOrgJoinCode(response.data.data.joinCode ?? "");
    setIsEditOrgOpen(true);
  };

  const handleCopyOrgCode = async () => {
    if (!orgJoinCode) return;
    await navigator.clipboard.writeText(orgJoinCode);
    toast({ title: "Copied", description: "Organization code copied to clipboard." });
  };

  useEffect(() => {
    if (!selectedOrgId) {
      router.replace("/orgs");
      return;
    }

    let active = true;
    const load = async () => {
      const freshGroups = getCachedGroups(selectedOrgId, GROUPS_CACHE_TTL_MS);
      const fallbackGroups = freshGroups ?? getCachedGroups(selectedOrgId, GROUPS_STALE_CACHE_TTL_MS);
      if (fallbackGroups) {
        setGroups(fallbackGroups);
        setLoading(false);
        if (freshGroups) {
          return;
        }
      } else {
        setLoading(true);
      }

      const groupsResult = await safeFetchJson<GroupsResponse>(
        `/api/groups?orgId=${encodeURIComponent(selectedOrgId)}`,
        {
          method: "GET",
          timeoutMs: GROUPS_REQUEST_TIMEOUT_MS,
          retry: fallbackGroups ? BACKGROUND_LOOKUP_RETRY : { retries: 0 },
        }
      );
      if (!active) {
        return;
      }
      if (!groupsResult.ok) {
        if (/unauthorized/i.test(groupsResult.error.message)) {
          router.replace("/login");
          return;
        }
        if (/organization missing|not a member/i.test(groupsResult.error.message)) {
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
        if (fallbackGroups) {
          return;
        }
        toast({
          title: "Group lookup failed",
          description: groupsResult.error.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      const nextGroups = groupsResult.data?.data?.groups ?? [];
      groupListCache.set(selectedOrgId, {
        groups: nextGroups,
        loadedAt: Date.now(),
      });
      writeLocalViewCache(groupsCacheKey(selectedOrgId), nextGroups);
      setGroups(nextGroups);
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
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
    if (createGroupSubmitLockRef.current) return;
    if (!groupName.trim()) {
      toast({ title: "Missing name", description: "Enter a group name.", variant: "destructive" });
      return;
    }
    if (findPolicyViolation(groupName) || findPolicyViolation(groupDescription)) {
      toast({ title: "Content blocked", description: policyErrorMessage, variant: "destructive" });
      return;
    }
    createGroupSubmitLockRef.current = true;
    setCreateGroupSubmitting(true);
    const joinCode = generateRandomCode(4);
    try {
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
    } finally {
      createGroupSubmitLockRef.current = false;
      setCreateGroupSubmitting(false);
    }
  };

  const handleEnterClub = (groupId: string) => {
    setSelectedGroupId(groupId);
    router.push("/dashboard");
  };

  const canShowCreate = true;
  const createDisabled = createGroupSubmitting;

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

  const groupsWithLogos = groups.map((group) => ({
    ...group,
    logo: group.logo || getPlaceholderImageUrl({ label: group.name.charAt(0) }),
  }));

  return (
    <div className="viewport-page bg-background">
      <div className="viewport-scroll mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pb-6 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Logo className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight">CASPO</h1>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-2xl"
            onClick={() => setIsProfileOpen(true)}
          >
            <Settings className="h-5 w-5" />
            <span className="sr-only">Settings</span>
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">Your all-in-one club management platform.</p>

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Your Groups</h2>
        </div>

        <div className="space-y-3">
          {canShowCreate && (
            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={(open) => {
                if (createGroupSubmitting) return;
                setIsCreateDialogOpen(open);
              }}
            >
              <DialogTrigger asChild>
                <Button className="w-full" disabled={createDisabled}>
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
                      src={groupLogo || getPlaceholderImageUrl({ label: (groupName || "G").charAt(0) })}
                      alt="Group logo preview"
                      width={96}
                      height={96}
                      className="rounded-lg aspect-square object-cover border"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => createGroupLogoInputRef.current?.click()}
                      disabled={createGroupSubmitting}
                    >
                      Change Picture
                    </Button>
                    <Input
                      ref={createGroupLogoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={createGroupSubmitting}
                      onChange={handleCreateGroupLogoChange}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="group-name">Group Name</Label>
                    <Input
                      id="group-name"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      disabled={createGroupSubmitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="group-description">Description</Label>
                    <Input
                      id="group-description"
                      value={groupDescription}
                      onChange={(e) => setGroupDescription(e.target.value)}
                      disabled={createGroupSubmitting}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateClub} disabled={createGroupSubmitting}>
                    {createGroupSubmitting ? "Creating..." : "Create Group"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {isOrgOwner ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void handleOpenEditOrganization()}
              disabled={orgSettingsLoading}
            >
              <Pencil className="mr-2" /> {orgSettingsLoading ? "Loading organization..." : "Edit Organization"}
            </Button>
          ) : null}

          {isOrgOwner ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push(`/orgs/${selectedOrgId}/credits`)}
            >
              <CreditCard className="mr-2" /> Manage Organization Billing
            </Button>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={handleBackToOrgs} className="w-full">
              Switch Org
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary" className="w-full">
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
          </div>

        </div>

        {loading ? (
          <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">Loading clubs...</p>
          </div>
        ) : groupsWithLogos.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groupsWithLogos.map((group) => (
               <Card key={group.id} className="relative rounded-2xl shadow-sm">
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
                 <CardHeader className="flex-row items-center gap-4 p-4">
                   <Image
                     src={group.logo}
                     alt={`${group.name} logo`}
                     width={56}
                     height={56}
                     className="rounded-2xl aspect-square object-cover"
                   />
                   <div className="min-w-0">
                     <CardTitle className="truncate text-base">{group.name}</CardTitle>
                     <CardDescription className="line-clamp-2 text-sm">Manage this club</CardDescription>
                   </div>
                 </CardHeader>
                <CardFooter className="p-4 pt-0">
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

        {isOrgOwner ? (
          <div>
            <Button variant="destructive" onClick={() => setIsDeleteOrgOpen(true)} className="w-full">
              <Trash2 className="mr-2" /> Delete Organization
            </Button>
          </div>
        ) : null}
      </div>
      <AlertDialog open={isOrgOwner && isDeleteOrgOpen} onOpenChange={setIsDeleteOrgOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete organization?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the organization and its groups for all members.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 text-sm text-slate-600">
              <p>Organization created: {formatDate(orgStatus?.createdAt)}</p>
              <p>Current plan: {orgStatus?.planName ?? 'Free'}.</p>
              <p>AI will stop for members immediately because the organization will no longer exist.</p>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteOrgSubmitting}>Keep organization</AlertDialogCancel>
            <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteOrganization();
                }}
                disabled={deleteOrgSubmitting || !isOrgOwner}
              >
                {deleteOrgSubmitting ? "Deleting..." : "Delete organization"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
      <ProfileDialog
        isOpen={isProfileOpen}
        onOpenChange={setIsProfileOpen}
        user={user}
        onSave={handleSaveProfile}
        onLogout={handleLogout}
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
                src={editGroupLogo || getPlaceholderImageUrl({ label: (editGroupName || editingGroup?.name || "G").charAt(0) })}
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
      <Dialog open={isEditOrgOpen} onOpenChange={setIsEditOrgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              View and share the organization code.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Organization Code</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border bg-muted px-3 py-2 text-base font-semibold tracking-[0.2em]">
                  {orgJoinCode || "Unavailable"}
                </div>
                <Button type="button" variant="outline" size="icon" onClick={handleCopyOrgCode} disabled={!orgJoinCode}>
                  <Copy className="h-4 w-4" />
                  <span className="sr-only">Copy organization code</span>
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditOrgOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
