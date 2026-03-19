
"use client";
import { useEffect, useState, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut, Home, User, ChevronDown } from "lucide-react";
import { OrgAiQuotaBadge } from "@/components/org-ai-quota-badge";
import Link from 'next/link';
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./icons";
import { useCurrentUserRole, useCurrentUser } from "@/lib/data-hooks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { User as UserType } from "@/lib/mock-data";
import { useOptionalDemoCtx } from "@/lib/demo/DemoDataProvider";
import { clearStoredDemoSession } from "@/lib/demo/mockData";
import { ProfileDialog } from "@/components/profile-dialog";
import { safeFetchJson } from "@/lib/network";
import {
  getSelectedGroupId,
  getSelectedOrgId,
  clearSelectedGroupId,
  clearSelectedOrgId,
} from "@/lib/selection";


const pageTitles: { [key: string]: string } = {
  "/dashboard": "Dashboard",
  "/demo/app": "Demo Dashboard",
  "/demo/app/dashboard": "Demo Dashboard",
  "/demo/app/announcements": "Announcements",
  "/demo/app/calendar": "Calendar",
  "/demo/app/gallery": "Gallery",
  "/demo/app/finances": "Finances",
  "/demo/app/members": "Members",
  "/demo/app/attendance": "Attendance",
  "/demo/app/points": "Points",
  "/demo/app/email": "Bulk Email",
  "/demo/app/messages": "Messages",
  "/demo/app/assistant": "Assistant",
  "/demo/app/forms": "Forms",
  "/orgs": "Organizations",
  "/orgs/create": "Create Organization",
  "/orgs/join": "Join Organization",
  "/clubs": "Clubs",
  "/announcements": "Announcements",
  "/calendar": "Calendar",
  "/gallery": "Gallery",
  "/finances": "Finances",
  "/members": "Members",
  "/attendance": "Attendance",
  "/points": "Points",
  "/email": "Bulk Email",
  "/messages": "Messages",
  "/assistant": "AI Assistant",
};

export function AppHeader() {
  const pathname = usePathname();
  const isMessagesRoute =
    pathname === "/messages" ||
    pathname.startsWith("/messages/") ||
    pathname === "/demo/app/messages" ||
    pathname.startsWith("/demo/app/messages/");
  const [clubName, setClubName] = useState("");
  const [orgName, setOrgName] = useState("");
  const demoCtx = useOptionalDemoCtx();
  const isDemoRoute = pathname === '/demo' || pathname.startsWith('/demo/');
  const useDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' && isDemoRoute && Boolean(demoCtx);
  const appName = useDemo ? 'CASPO' : 'CASPO';
  const title = pageTitles[pathname] || appName;
  const { role, canEditContent } = useCurrentUserRole();
  const { user, saveUser, clearUser } = useCurrentUser();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);
  
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [adminLeaveOpen, setAdminLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transferCandidates, setTransferCandidates] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [transferTarget, setTransferTarget] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);


  useEffect(() => {
    const load = async () => {
      if (useDemo && demoCtx) {
        setClubName(demoCtx.clubName);
        return;
      }
      const orgId = getSelectedOrgId();
      const groupId = getSelectedGroupId();
      if (!orgId || !supabase) {
        setClubName("");
        setOrgName("");
        return;
      }
      const { data: orgRow } = await supabase
        .from('orgs')
        .select('name')
        .eq('id', orgId)
        .maybeSingle();
      setOrgName(orgRow?.name || "");
      if (!groupId) {
        setClubName("");
        return;
      }
      const { data: groupRow } = await supabase
        .from('groups')
        .select('name')
        .eq('id', groupId)
        .maybeSingle();
      setClubName(groupRow?.name || "");
    };
    load();
  }, [demoCtx, pathname, supabase, useDemo]);
  
  const handleLogout = async () => {
    if (useDemo) {
      clearStoredDemoSession();
      clearSelectedGroupId();
      clearSelectedOrgId();
      clearUser();
      router.push('/demo');
      return;
    }
    if (!supabase) return;
    await supabase.auth.signOut();
    clearUser();
    clearSelectedGroupId();
    clearSelectedOrgId();
    router.push('/');
  }

  const handleSaveProfile = async (updatedUser: Partial<UserType>) => {
     await saveUser(currentUser => ({...currentUser, ...updatedUser} as UserType));
   }

  const handleDeleted = async () => {
    if (useDemo) {
      clearStoredDemoSession();
      clearSelectedGroupId();
      clearSelectedOrgId();
      clearUser();
      router.push('/demo');
      return;
    }
    if (supabase) {
      await supabase.auth.signOut();
    }
    clearUser();
    clearSelectedGroupId();
    clearSelectedOrgId();
    router.push('/');
  };

  const getAvatarFallback = (name?: string | null) => name ? name.charAt(0).toUpperCase() : '';
  
  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };
  
  const avatarBgColor = (user?.name && !user?.avatar) ? stringToColor(user.name) : undefined;
  const isAdminRole = role === 'Admin';
  const hasGroupContext = Boolean(!useDemo && getSelectedOrgId() && getSelectedGroupId() && clubName);

  const loadTransferCandidates = async () => {
    if (!supabase || !user?.email) return [];
    const groupId = getSelectedGroupId();
    if (!groupId) return [];
    const { data: stateRow } = await supabase
      .from('group_state')
      .select('data')
      .eq('group_id', groupId)
      .maybeSingle();
    const members = ((stateRow?.data as { members?: Array<{ id?: string; name: string; email: string; role?: string }> } | null)?.members ?? [])
      .filter(member => member.id && member.email !== user.email)
      .map(member => ({ id: member.id!, name: member.name, email: member.email }));
    setTransferCandidates(members);
    return members;
  };

  const openLeaveAction = async () => {
    if (!hasGroupContext) return;
    if (!isAdminRole) {
      setLeaveOpen(true);
      return;
    }
    const candidates = await loadTransferCandidates();
    if (candidates.length > 0) {
      setAdminLeaveOpen(true);
      return;
    }
    setAdminLeaveOpen(true);
  };

  const handleLeaveGroup = async (transferAdminUserId?: string) => {
    const orgId = getSelectedOrgId();
    const groupId = getSelectedGroupId();
    if (!orgId || !groupId) return;
    setActionLoading(true);
    const result = await safeFetchJson<{ ok: boolean; error?: { message?: string } }>(
      "/api/groups/leave",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, groupId, transferAdminUserId }),
      }
    );
    setActionLoading(false);
    if (!result.ok || !result.data?.ok) {
      console.error('Leave group failed', !result.ok ? result.error : result.data?.error);
      return;
    }
    clearSelectedGroupId();
    router.push("/clubs");
  };

  const handleDeleteGroup = async () => {
    const orgId = getSelectedOrgId();
    const groupId = getSelectedGroupId();
    if (!orgId || !groupId) return;
    setActionLoading(true);
    const result = await safeFetchJson<{ ok: boolean; error?: { message?: string } }>(
      "/api/groups/delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, groupId }),
      }
    );
    setActionLoading(false);
    if (!result.ok || !result.data?.ok) {
      console.error('Delete group failed', !result.ok ? result.error : result.data?.error);
      return;
    }
    setDeleteOpen(false);
    setAdminLeaveOpen(false);
    clearSelectedGroupId();
    router.replace("/clubs");
    router.refresh();
  };

  return (
    <>
    <header className={`sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur ${isMessagesRoute ? "hidden md:block" : ""}`}>
      <div className="mx-auto flex min-h-14 max-w-screen-md items-center justify-between gap-3 px-4 py-2 md:max-w-none lg:px-6">
        <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
          <Link href={useDemo ? '/demo/app' : '/orgs'} className="hidden items-center gap-2 font-semibold md:flex">
            <Logo className="h-6 w-6" />
            <span>{appName}</span>
          </Link>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="truncate text-lg font-semibold leading-tight md:text-2xl">{title}</h1>
              {hasGroupContext ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl">
                      <ChevronDown className="h-4 w-4" />
                      <span className="sr-only">Group actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {isAdminRole ? (
                      <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
                        Delete Group
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={openLeaveAction}>
                      Leave Group
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {(orgName || clubName) ? (
              <p className="truncate text-sm text-muted-foreground">
                {[orgName, clubName].filter(Boolean).join(" / ")}
              </p>
            ) : null}
          </div>
        </div>

        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-2xl sm:hidden">
          <Link href={useDemo ? '/demo' : '/clubs'}>
            <Home className="h-5 w-5" />
            <span className="sr-only">Back to groups</span>
          </Link>
        </Button>

        <div className="min-w-0 flex-1 text-center sm:hidden">
          <div className="flex items-center justify-center gap-1">
            <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
            {hasGroupContext ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-xl">
                    <ChevronDown className="h-4 w-4" />
                    <span className="sr-only">Group actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {isAdminRole ? (
                    <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
                      Delete Group
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={openLeaveAction}>
                    Leave Group
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {(orgName || clubName) ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {[orgName, clubName].filter(Boolean).join(" / ")}
            </p>
          ) : null}
        </div>

        {!useDemo && getSelectedOrgId() && canEditContent ? (
          <div className="hidden shrink-0 sm:block">
            <OrgAiQuotaBadge compact />
          </div>
        ) : null}
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl active:scale-95">
             {isMounted && user ? (
                <Avatar>
                  <AvatarImage src={user?.avatar} alt={user?.name || "User Avatar"} data-ai-hint="person"/>
                  <AvatarFallback style={{ backgroundColor: avatarBgColor }}>
                    {getAvatarFallback(user?.name)}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <Avatar>
                  <AvatarFallback></AvatarFallback>
                </Avatar>
              )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{user?.name || "My Account"} ({role || "No role"})</DropdownMenuLabel>
          <DropdownMenuSeparator />
           <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
           <Link href={useDemo ? '/demo' : '/clubs'}>
             <DropdownMenuItem><Home className="mr-2 h-4 w-4" />Switch Group</DropdownMenuItem>
             </Link>
          <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
    <ProfileDialog
      isOpen={isProfileOpen}
      onOpenChange={setIsProfileOpen}
      user={user}
      onSave={handleSaveProfile}
      onDeleted={handleDeleted}
      mode={useDemo ? 'demo' : 'live'}
    />
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
            <Select value={transferTarget} onValueChange={setTransferTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select new admin" />
              </SelectTrigger>
              <SelectContent>
                {transferCandidates.map(member => (
                  <SelectItem key={member.id} value={member.id}>
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
    </>
  );
}

