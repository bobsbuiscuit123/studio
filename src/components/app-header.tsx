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
import { usePathname } from "next/navigation";
import { Logo } from "./icons";

const pageTitles: { [key: string]: string } = {
  "/dashboard": "Dashboard",
  "/announcements": "Announcements",
  "/calendar": "Calendar",
  "/finances": "Finances",
  "/members": "Members",
  "/slides": "Meeting Slides",
  "/social": "Social Media",
};

export function AppHeader() {
  const pathname = usePathname();
  const [clubName, setClubName] = useState("");
  const title = pageTitles[pathname] || "ClubHub";

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

  return (
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
            <AppSidebarNav />
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
              <AvatarImage src="https://placehold.co/100x100.png" alt="User Avatar" data-ai-hint="woman smiling"/>
              <AvatarFallback>AJ</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem><User className="mr-2 h-4 w-4" />Profile</DropdownMenuItem>
          <DropdownMenuItem><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
           <Link href="/">
             <DropdownMenuItem><Home className="mr-2 h-4 w-4" />Switch Club</DropdownMenuItem>
            </Link>
          <DropdownMenuItem><LogOut className="mr-2 h-4 w-4" />Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
