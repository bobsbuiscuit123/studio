
"use client";
import { useEffect, useState, useRef, useMemo } from "react";
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
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Menu, LogOut, Home, User } from "lucide-react";
import { AppSidebarNav } from "./app-sidebar-nav";
import Link from 'next/link';
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./icons";
import { useCurrentUserRole, useCurrentUser, useNotifications, useMembers } from "@/lib/data-hooks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { User as UserType } from "@/lib/mock-data";
import { useOptionalDemoCtx } from "@/lib/demo/DemoDataProvider";
import { clearStoredDemoSession } from "@/lib/demo/mockData";


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
  "/browse-clubs": "Club Directory",
};

function ProfileDialog({ isOpen, onOpenChange, user, onSave }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; user: UserType | null; onSave: (updatedUser: Partial<UserType>) => void; }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(user?.name || '');
      setEmail(user?.email || '');
      setAvatar(user?.avatar || '');
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

  const handleSave = () => {
    if (user) {
      onSave({
        name,
        avatar: avatarPreview || avatar,
      });
    }
    onOpenChange(false);
  };

  return (
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
                <AvatarImage src={avatarPreview || ''} />
                <AvatarFallback className="text-3xl">{name.charAt(0)}</AvatarFallback>
             </Avatar>
             <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>Change Picture</Button>
             <Input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} readOnly disabled/>
          </div>
        </div>
        <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const [clubName, setClubName] = useState("");
  const demoCtx = useOptionalDemoCtx();
  const isDemoRoute = pathname === '/demo' || pathname.startsWith('/demo/');
  const useDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' && isDemoRoute && Boolean(demoCtx);
  const appName = useDemo ? 'CASPO' : 'ClubHub AI';
  const title = pageTitles[pathname] || appName;
  const homeHref = useDemo ? '/demo/app' : '/';
  const { role } = useCurrentUserRole();
  const { user, saveUser, clearUser } = useCurrentUser();
  const membersHook = useMembers();
  const { unread, markAllAsRead } = useNotifications();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const supabase = useMemo(() => (useDemo ? null : createSupabaseBrowserClient()), [useDemo]);
  
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);


  useEffect(() => {
    const load = async () => {
      if (useDemo && demoCtx) {
        setClubName(demoCtx.clubName);
        return;
      }
      const clubId = localStorage.getItem('selectedClubId');
      if (!clubId || !supabase) {
        setClubName("");
        return;
      }
      const { data, error } = await supabase
        .from('orgs')
        .select('name')
        .eq('id', clubId)
        .maybeSingle();
      if (error) {
        setClubName("");
        return;
      }
      setClubName(data?.name || "");
    };
    load();
  }, [demoCtx, pathname, supabase, useDemo]);
  
  const handleLogout = async () => {
    if (useDemo) {
      clearStoredDemoSession();
      localStorage.removeItem('selectedClubId');
      clearUser();
      router.push('/demo');
      return;
    }
    if (!supabase) return;
    await supabase.auth.signOut();
    clearUser();
    localStorage.removeItem('selectedClubId');
    router.push('/');
  }

  const handleSaveProfile = (updatedUser: Partial<UserType>) => {
     saveUser(currentUser => ({...currentUser, ...updatedUser} as UserType));
     if (updatedUser.name || updatedUser.avatar) {
       membersHook.updateData(prev => {
         const list = Array.isArray(prev) ? prev : [];
         return list.map(member =>
           member.email === user?.email
             ? {
                 ...member,
                 name: updatedUser.name ?? member.name,
                 avatar: updatedUser.avatar ?? member.avatar,
               }
             : member
         );
       });
     }
  }

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

  return (
    <>
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6 shrink-0">
       <Sheet>
        <SheetTrigger asChild>
          <Button size="icon" variant="outline" className="sm:hidden">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle Menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex flex-col p-0">
           <SheetHeader className="p-6">
            <SheetTitle className="sr-only">Main Menu</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <nav className="grid gap-2 text-lg font-medium px-6">
              <Link
                href={homeHref}
                className="flex items-center gap-2 text-lg font-semibold mb-4"
              >
                <Logo className="h-6 w-6" />
                <span>{appName}</span>
              </Link>
              <AppSidebarNav 
                role={role || ''} 
                notifications={unread}
                onLinkClick={(key) => markAllAsRead(key)}
              />
            </nav>
          </div>
        </SheetContent>
      </Sheet>

      <div className="w-full flex-1">
         <h1 className="text-lg font-semibold md:text-2xl">{title} {clubName && <span className="text-sm text-muted-foreground font-normal">- {clubName}</span>}</h1>
      </div>
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="overflow-hidden rounded-full">
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
           <Link href={useDemo ? '/demo' : '/'}>
             <DropdownMenuItem><Home className="mr-2 h-4 w-4" />Switch Club</DropdownMenuItem>
            </Link>
          <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <ProfileDialog isOpen={isProfileOpen} onOpenChange={setIsProfileOpen} user={user} onSave={handleSaveProfile} />
    </>
  );
}
