
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CalendarDays,
  UsersRound,
  Megaphone,
  Presentation,
  Network,
  Landmark,
  MessageSquare,
  GalleryHorizontal,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';

type NotificationMap = {
  messages: boolean;
  announcements: boolean;
  social: boolean;
}

const allNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/announcements', icon: Megaphone, label: 'Announcements', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: 'announcements' },
  { href: '/calendar', icon: CalendarDays, label: 'Calendar', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/attendance', icon: CheckCircle, label: 'Attendance', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/gallery', icon: GalleryHorizontal, label: 'Gallery', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/members', icon: UsersRound, label: 'Members', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/messages', icon: MessageSquare, label: 'Messages', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: 'messages' },
  { href: '/finances', icon: Landmark, label: 'Finances', roles: ['President', 'Admin', 'Officer'], notificationKey: null },
  { href: '/slides', icon: Presentation, label: 'Meeting Slides', roles: ['President', 'Admin', 'Officer'], notificationKey: null },
  { href: '/social', icon: Network, label: 'Social Media', roles: ['President', 'Admin', 'Officer', 'Member'], notificationKey: 'social' },
];

export function AppSidebarNav({ role, notifications }: { role: string; notifications: NotificationMap }) {
  const pathname = usePathname();

  const navItems = allNavItems.filter(item => item.roles.includes(role));

  return (
    <>
      {navItems.map((item) => {
        const hasNotification = item.notificationKey && notifications[item.notificationKey as keyof NotificationMap];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary',
              pathname.startsWith(item.href) && 'bg-muted text-primary'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
            {hasNotification && <span className="ml-auto h-2 w-2 rounded-full bg-primary animate-pulse"></span>}
          </Link>
        )
      })}
    </>
  );
}
