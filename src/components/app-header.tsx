
"use client";
import { useEffect, useState, useRef } from "react";
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
import { useCurrentUserRole, useCurrentUser, useNotifications } from "@/lib/data-hooks";
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
  "/attendance": "Attendance",
  "/points": "Points",
  "/email": "Bulk Email",
  "/messages": "Messages",
  "/mindmap": "Mind Map",
  "/assistant": "AI Assistant",
};

function ProfileDialog({ isOpen, onOpenChange, user, onSave }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; user: UserType | null; onSave: (updatedUser: Partial<User>) => void; }) {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(user?.name || '');
    setEmail(user?.email || '');
    setAvatar(user?.avatar || '');
    setAvatarPreview(user?.avatar || null);
  }, [user]);

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
  const title = pageTitles[pathname] || "ClubHub AI";
  const { role } = useCurrentUserRole();
  const { user, saveUser, clearUser } = useCurrentUser();
  const { unread, markAllAsRead } = useNotifications();
  const router = useRouter();
  
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
  }, [pathname]); // Rerun when path changes to update club name if needed
  
  const handleLogout = () => {
    clearUser();
    localStorage.removeItem('selectedClubId');
    localStorage.removeItem('selectedClubLogo');
    router.push('/');
  }

  const handleSaveProfile = (updatedUser: Partial<UserType>) => {
     saveUser(currentUser => ({...currentUser, ...updatedUser} as UserType));
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
                href="/"
                className="flex items-center gap-2 text-lg font-semibold mb-4"
              >
                <Logo className="h-6 w-6" />
                <span>ClubHub AI</span>
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
