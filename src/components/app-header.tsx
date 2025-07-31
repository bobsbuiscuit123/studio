
"use client";
import { useEffect, useState } from "react";
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
import { useCurrentUserRole, useCurrentUser, useMessages, useAnnouncements, useSocialPosts } from "@/lib/data-hooks";
import type { User as UserType } from "@/lib/mock-data";


const pageTitles: { [key: string]: string } = {
  "/dashboard": "Dashboard",
  "/announcements": "Announcements",
  "/calendar": "Calendar",
  "/gallery": "Gallery",
  "/finances": "Finances",
  "/members": "Members",
  "/slides": "Meeting Slides",
  "/social": "Social Media",
  "/messages": "Messages",
  "/attendance": "Attendance",
  "/email": "Bulk Email",
};

function ProfileDialog({ isOpen, onOpenChange, user, onSave }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; user: UserType | null; onSave: (name: string, email: string) => void; }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');

  useEffect(() => {
    setName(user?.name || '');
    setEmail(user?.email || '');
  }, [user]);

  const handleSave = () => {
    onSave(name, email);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Profile Settings</DialogTitle>
          <DialogDescription>
            Update your name and email here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
  const title = pageTitles[pathname] || "ClubHub";
  const { role } = useCurrentUserRole();
  const { user, saveUser, clearUser } = useCurrentUser();
  const { allMessages, loading: messagesLoading } = useMessages(user?.email);
  const { data: announcements, loading: announcementsLoading } = useAnnouncements();
  const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
  const router = useRouter();
  
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);
  const [hasUnreadSocials, setHasUnreadSocials] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);


  useEffect(() => {
    const clubId = localStorage.getItem('selectedClubId');
    if(clubId) {
      const clubs = JSON.parse(localStorage.getItem('clubs') || '[]');
      const currentClub = clubs.find((c: any) => c.id === clubId);
      if(currentClub) {
        setClubName(currentClub.name);
      }
    }
  }, []);

  useEffect(() => {
    if (!messagesLoading && user && allMessages) {
        setHasUnreadMessages(allMessages.some(m => m.recipientEmail === user.email && !m.read));
    }
  }, [allMessages, user, messagesLoading]);
  
  useEffect(() => {
    if (!announcementsLoading) {
      setHasUnreadAnnouncements(announcements.some(a => !a.read));
    }
  }, [announcements, announcementsLoading]);

  useEffect(() => {
    if (!socialPostsLoading) {
      setHasUnreadSocials(socialPosts.some(p => !p.read));
    }
  }, [socialPosts, socialPostsLoading]);
  
  const handleLogout = () => {
    clearUser();
    localStorage.removeItem('selectedClubId');
    router.push('/');
  }

  const handleSaveProfile = (name: string, email: string) => {
    saveUser({ name, email });
  }

  const getAvatarFallback = (name?: string | null) => name ? name.charAt(0).toUpperCase() : 'U';
  
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
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
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
          <nav className="grid gap-2 text-lg font-medium px-6">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold mb-4"
            >
              <Logo className="h-6 w-6" />
              <span>ClubHub</span>
            </Link>
            <AppSidebarNav 
              role={role || ''} 
              notifications={{
                messages: hasUnreadMessages,
                announcements: hasUnreadAnnouncements,
                social: hasUnreadSocials,
              }}
            />
          </nav>
        </SheetContent>
      </Sheet>

      <div className="w-full flex-1">
         <h1 className="text-lg font-semibold md:text-2xl">{title} {clubName && <span className="text-sm text-muted-foreground font-normal">- {clubName}</span>}</h1>
      </div>
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="overflow-hidden rounded-full">
            <Avatar>
              <AvatarImage src={user?.avatar} alt={user?.name || "User Avatar"} data-ai-hint="person"/>
              <AvatarFallback style={{ backgroundColor: avatarBgColor }}>
                {getAvatarFallback(user?.name)}
                </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{user?.name || "My Account"} ({role})</DropdownMenuLabel>
          <DropdownMenuSeparator />
           <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
           <Link href="/">
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
