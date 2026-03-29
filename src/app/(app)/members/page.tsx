
"use client";

import { ChevronDown, Mail, Share2, MessageSquare, UserMinus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMembers, useCurrentUserRole, useCurrentUser } from "@/lib/data-hooks";
import { useToast } from "@/hooks/use-toast";
import { safeFetchJson } from "@/lib/network";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPlaceholderImageUrl } from "@/lib/placeholders";
import { useEffect, useState, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Member } from "@/lib/mock-data";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearSelectedGroupId } from "@/lib/selection";
import { displayGroupRole, type GroupRole } from "@/lib/group-permissions";

export default function MembersPage() {
  const { data: members, updateData: setMembers, loading, clubId, orgId } = useMembers();
  const { toast } = useToast();
  const [joinCode, setJoinCode] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [adminLeaveOpen, setAdminLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const { canEditContent, canManageRoles, role } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const baseMembers = useMemo(() => (Array.isArray(members) ? members : []), [members]);
  const currentUserRole = useMemo<Member["role"]>(() => {
    if (role === "Admin" || role === "Officer" || role === "Member") {
      return role;
    }
    return "Member";
  }, [role]);
  const fallbackMember = useMemo<Member | null>(() => {
    if (!user?.email) return null;
    return {
      id: user.email,
      name: user.name || user.email,
      email: user.email,
      role: currentUserRole,
      avatar:
        user.avatar ||
        getPlaceholderImageUrl({ label: (user.name || user.email || "U").charAt(0) }),
      dataAiHint: "person profile",
    };
  }, [currentUserRole, user?.avatar, user?.email, user?.name]);
  const safeMembers = useMemo(() => {
    if (!user?.email) return baseMembers;
    const alreadyIncluded = baseMembers.some(member => member.email === user.email);
    if (alreadyIncluded || !fallbackMember) return baseMembers;
    return [...baseMembers, fallbackMember];
  }, [baseMembers, fallbackMember, user?.email]);
  const isAdminRole = (value?: string | null) => value === 'Admin';
  const adminCount = safeMembers.filter(member => isAdminRole(member.role)).length;
  const isOnlyAdmin = isAdminRole(role) && adminCount <= 1;
  const transferCandidates = safeMembers.filter(member => member.email !== user?.email && Boolean(member.id));

  useEffect(() => {
    if (!clubId) return;
    const load = async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('join_code')
        .eq('id', clubId)
        .maybeSingle();
      if (!error && data?.join_code) {
        setJoinCode(data.join_code);
      }
    };
    load();
  }, [clubId, supabase]);

  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };

  const handleCopyToClipboard = () => {
    if (joinCode) {
      navigator.clipboard.writeText(joinCode);
      toast({ title: "Copied to clipboard!" });
    }
  };

  const handleRoleChange = async (member: Member, newRole: 'Admin' | 'Officer' | 'Member') => {
    if (!clubId || !orgId || !member.id) return;
    if (isAdminRole(role) && isAdminRole(member?.role) && adminCount <= 1 && !isAdminRole(newRole)) {
      toast({ title: "Admin required", description: "Assign another admin before removing the last admin." });
      return;
    }
    const normalizedRole = newRole.toLowerCase() as GroupRole;
    const result = await safeFetchJson<{ ok: boolean; error?: { message?: string } }>(
      "/api/groups/members",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, groupId: clubId, userId: member.id, role: normalizedRole }),
      }
    );
    if (!result.ok || !result.data?.ok) {
      const message = !result.ok ? result.error.message : result.data?.error?.message || "Failed to update role.";
      toast({ title: "Role change failed", description: message, variant: "destructive" });
      return;
    }
    setMembers(baseMembers.map(m => (m.id === member.id ? { ...m, role: displayGroupRole(normalizedRole) } : m)));
    toast({ title: "Member role updated successfully!" });
  };

  const handleRemoveMember = async (member: Member) => {
    if (!clubId || !orgId || !member.id) return;
    const result = await safeFetchJson<{ ok: boolean; error?: { message?: string } }>(
      "/api/groups/members",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, groupId: clubId, userId: member.id }),
      }
    );
    if (!result.ok || !result.data?.ok) {
      const message = !result.ok ? result.error.message : result.data?.error?.message || "Failed to remove member.";
      toast({ title: "Remove failed", description: message, variant: "destructive" });
      return;
    }
    setMembers(baseMembers.filter(m => m.id !== member.id));
    toast({ title: "Member removed from group." });
  };

  const handleLeaveGroup = async (transferAdminUserId?: string) => {
    if (!clubId || !orgId) return;
    setActionLoading(true);
    const result = await safeFetchJson<{ ok: boolean; error?: { message?: string } }>(
      "/api/groups/leave",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, groupId: clubId, transferAdminUserId }),
      }
    );
    setActionLoading(false);
    if (!result.ok || !result.data?.ok) {
      const message = !result.ok ? result.error.message : result.data?.error?.message || "Failed to leave group.";
      toast({ title: "Leave failed", description: message, variant: "destructive" });
      return;
    }
    clearSelectedGroupId();
    router.push("/clubs");
  };

  const handleDeleteGroup = async () => {
    if (!clubId || !orgId) return;
    setActionLoading(true);
    const result = await safeFetchJson<{ ok: boolean; error?: { message?: string } }>(
      "/api/groups/delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, groupId: clubId }),
      }
    );
    setActionLoading(false);
    if (!result.ok || !result.data?.ok) {
      const message = !result.ok ? result.error.message : result.data?.error?.message || "Failed to delete group.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
      return;
    }
    setDeleteOpen(false);
    setAdminLeaveOpen(false);
    clearSelectedGroupId();
    router.replace("/clubs");
    router.refresh();
  };
  
  const handleMessageClick = () => {
    router.push('/messages');
  }

  return (
    <div className="app-page-shell">
      <div className="app-page-scroll">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Member Directory</h1>
        <div className="flex gap-2">
          {canEditContent && (
              <Dialog>
                  <DialogTrigger asChild>
                  <Button variant="outline">
                      <Share2 className="mr-2" /> Invite Members
                  </Button>
                  </DialogTrigger>
                  <DialogContent className="top-16 max-h-[calc(100dvh-5rem)] sm:top-[50%] sm:max-h-[calc(100dvh-2rem)]">
                  <DialogHeader>
                      <DialogTitle>Invite Members with Join Code</DialogTitle>
                      <DialogDescription>
                      Share this code with people you want to invite to your group. This code is unique to your group and will not change.
                      </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                      {joinCode ? (
                          <p className="text-center text-4xl font-bold tracking-[0.5em] bg-muted p-4 rounded-lg">{joinCode}</p>
                      ) : (
                          <p className="text-center text-muted-foreground">Loading join code...</p>
                      )}
                  </div>
                  <DialogFooter>
                      <Button onClick={handleCopyToClipboard} disabled={!joinCode}>Copy Code</Button>
                  </DialogFooter>
                  </DialogContent>
              </Dialog>
          )}
        </div>
      </div>

       {loading ? <p>Loading...</p> : 
          safeMembers.length > 0 ? (
          <div className="grid gap-4 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {safeMembers.map((member) => (
              <Card key={member.email}>
                <CardHeader className="items-center text-center">
                    <Avatar className="w-24 h-24 mb-2 text-4xl">
                        <AvatarImage src={member.avatar} alt={`${member.name}'s avatar`} data-ai-hint={member.dataAiHint || 'person'} />
                        <AvatarFallback style={{ backgroundColor: member.avatar ? undefined : stringToColor(member.name)}}>
                            {member.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                  <CardTitle>{member.name}</CardTitle>
                  <CardDescription>{member.role} {member.email === user?.email && "(You)"}</CardDescription>
                </CardHeader>
                <CardContent className="text-center">
                  <a href={`mailto:${member.email}`} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2">
                    <Mail className="h-4 w-4" />
                    {member.email}
                  </a>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                   {member.email !== user?.email && (
                     <Button variant="outline" className="w-full" onClick={handleMessageClick}>
                        <MessageSquare className="mr-2" /> Message
                     </Button>
                   )}
                   {canManageRoles && member.email !== user?.email && (
                     <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="secondary" className="w-full">
                          Manage Role <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {role === 'Admin' && (
                            <DropdownMenuItem onClick={() => handleRoleChange(member, 'Admin')}>
                              Set as Admin
                            </DropdownMenuItem>
                        )}
                         <DropdownMenuItem onClick={() => handleRoleChange(member, 'Officer')}>
                          Set as Officer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRoleChange(member, 'Member')}>
                          Set as Member
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRemoveMember(member)}>
                          <UserMinus className="mr-2 h-4 w-4" /> Remove from group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
       ) : (
           <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No members yet.</p>
            {canEditContent ? (
              <p className="text-muted-foreground">Share the join code to invite your first members.</p>
            ) : (
              <p className="text-muted-foreground">Ask an admin for the join code.</p>
           )}
          </div>
        )}
      </div>
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave group?</DialogTitle>
            <DialogDescription>
              You’ll lose access to this group until you rejoin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLeaveOpen(false)}>Cancel</Button>
            <Button onClick={() => handleLeaveGroup()} disabled={actionLoading}>Leave group</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adminLeaveOpen} onOpenChange={setAdminLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin required</DialogTitle>
            <DialogDescription>
              You’re the only admin. Assign a new admin or delete the group before leaving.
            </DialogDescription>
          </DialogHeader>
          {transferCandidates.length > 0 ? (
            <div className="space-y-3 py-2">
              <Label htmlFor="transfer-admin">Assign new admin</Label>
              <Select value={transferTarget} onValueChange={setTransferTarget}>
                <SelectTrigger id="transfer-admin">
                  <SelectValue placeholder="Select member" />
                </SelectTrigger>
                  <SelectContent>
                    {transferCandidates.map(member => (
                    <SelectItem key={member.id} value={member.id!}>
                      {member.name} ({member.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No other members to promote.</p>
          )}
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="destructive" onClick={() => {
              setAdminLeaveOpen(false);
              setDeleteOpen(true);
            }}>
              Delete group
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setAdminLeaveOpen(false)}>Cancel</Button>
              <Button
                onClick={() => handleLeaveGroup(transferTarget)}
                disabled={!transferTarget || actionLoading}
              >
                Assign admin & leave
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete group?</DialogTitle>
            <DialogDescription>
              This permanently deletes the group and all of its data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteGroup} disabled={actionLoading}>
              Delete group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
