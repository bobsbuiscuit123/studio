
"use client";

import Link from "next/link";
import { Logo } from "./icons";
import { AppSidebarNav } from "./app-sidebar-nav";
import { useCurrentUserRole, useCurrentUser, useAnnouncements, useSocialPosts } from "@/lib/data-hooks";
import { useEffect, useState } from "react";

export function AppSidebar() {
  const { role } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { data: announcements, loading: announcementsLoading } = useAnnouncements();
  const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
  
  const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);
  const [hasUnreadSocials, setHasUnreadSocials] = useState(false);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);

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

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 shrink-0 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo className="h-6 w-6" />
            <span className="">ClubHub</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            <AppSidebarNav 
              role={role || ''} 
              notifications={{
                announcements: hasUnreadAnnouncements,
                social: hasUnreadSocials,
                messages: hasUnreadMessages,
              }}
            />
          </nav>
        </div>
      </div>
    </div>
  );
}
