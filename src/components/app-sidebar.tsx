
"use client";

import Link from "next/link";
import { Logo } from "./icons";
import { AppSidebarNav } from "./app-sidebar-nav";
import { useCurrentUserRole, useCurrentUser, useMessages, useAnnouncements, useSocialPosts } from "@/lib/data-hooks";
import { useEffect, useState } from "react";

export function AppSidebar() {
  const { role } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { allMessages, loading: messagesLoading } = useMessages(user?.email);
  const { data: announcements, loading: announcementsLoading } = useAnnouncements();
  const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
  
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);
  const [hasUnreadSocials, setHasUnreadSocials] = useState(false);

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

  return (
    <div className="hidden border-r bg-muted/40 md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo className="h-6 w-6" />
            <span className="">ClubHub</span>
          </Link>
        </div>
        <div className="flex-1">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            <AppSidebarNav 
              role={role || ''} 
              notifications={{
                messages: hasUnreadMessages,
                announcements: hasUnreadAnnouncements,
                social: hasUnreadSocials,
              }}
            />
          </nav>
        </div>
      </div>
    </div>
  );
}
