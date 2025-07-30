
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
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Menu, Settings, User, LogOut, Home } from "lucide-react";
import { AppSidebarNav } from "./app-sidebar-nav";
import Link from 'next/link';
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "./icons";
import { useCurrentUserRole, useCurrentUser, useMessages, useAnnouncements, useSocialPosts } from "@/lib/data-hooks";
import { SettingsDialog } from "./settings-dialog";

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
};

export function AppHeader() {
  const pathname = usePathname();
  const [clubName, setClubName] = useState("");
  const title = pageTitles[pathname] || "ClubHub";
  const { role } = useCurrentUserRole();
  const { user, clearUser } = useCurrentUser();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { allMessages, loading: messagesLoading } = useMessages(user?.email);
  const { data: announcements, loading: announcementsLoading } = useAnnouncements();
  const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
  const router = useRouter();
  
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);
  const [hasUnreadSocials, setHasUnreadSocials] = useState(false);


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
        <SheetContent side="left" className="flex flex-col">
          <nav className="grid gap-2 text-lg font-medium">
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
          <DropdownMenuLabel>{user?.name || "My Account"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setIsSettingsOpen(true)}><User className="mr-2 h-4 w-4" />Profile</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setIsSettingsOpen(true)}><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
           <Link href="/">
             <DropdownMenuItem><Home className="mr-2 h-4 w-4" />Switch Club</DropdownMenuItem>
            </Link>
          <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
