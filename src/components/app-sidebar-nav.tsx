
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CalendarDays,
  UsersRound,
  Megaphone,
  Landmark,
  GalleryHorizontal,
  CheckCircle,
  Mail,
  MessageSquare,
  BarChart,
  TrendingUp,
  Bot,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NotificationKey } from '@/lib/data-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSelectedGroupId } from '@/lib/selection';

type NotificationMap = {
  announcements: boolean;
  social: boolean;
  messages: boolean;
  calendar: boolean;
  gallery: boolean;
  forms: boolean;
  attendance: boolean;
}

const allNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/announcements', icon: Megaphone, label: 'Announcements', roles: ['Admin', 'Officer', 'Member'], notificationKey: 'announcements' as NotificationKey },
  { href: '/messages', icon: MessageSquare, label: 'Messages', roles: ['Admin', 'Officer', 'Member'], notificationKey: 'messages' as NotificationKey },
  { href: '/calendar', icon: CalendarDays, label: 'Calendar', roles: ['Admin', 'Officer', 'Member'], notificationKey: 'calendar' as NotificationKey },
  { href: '/forms', icon: ClipboardList, label: 'Forms', roles: ['Admin', 'Officer', 'Member'], notificationKey: 'forms' as NotificationKey },
  { href: '/attendance', icon: CheckCircle, label: 'Attendance', roles: ['Admin', 'Officer', 'Member'], notificationKey: 'attendance' as NotificationKey },
  { href: '/points', icon: BarChart, label: 'Points', roles: ['Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/gallery', icon: GalleryHorizontal, label: 'Gallery', roles: ['Admin', 'Officer', 'Member'], notificationKey: 'gallery' as NotificationKey },
  { href: '/members', icon: UsersRound, label: 'Members', roles: ['Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/assistant', icon: Sparkles, label: 'Assistant', roles: ['Admin', 'Officer', 'Member'], notificationKey: null },
  { href: '/email', icon: Mail, label: 'Email', roles: ['Admin', 'Officer'], notificationKey: null },
  { href: '/finances', icon: Landmark, label: 'Finances', roles: ['Admin'], notificationKey: null },
];

export function AppSidebarNav({ role, notifications, onLinkClick }: { role: string; notifications: NotificationMap, onLinkClick: (key: NotificationKey) => void }) {
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);
  const lastAutoClearedRef = useRef<string | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const groupId = isClient ? getSelectedGroupId() : null;
  const isDemoApp = pathname === '/demo/app' || pathname.startsWith('/demo/app/');

  const navItems = useMemo(() => {
    const filteredNavItems = allNavItems.filter(() => groupId);

    return filteredNavItems.filter(item => item.roles.includes(role)).sort((a, b) => {
      const order = ['Assistant', 'Dashboard', 'Announcements', 'Messages', 'Calendar', 'Forms', 'Attendance', 'Points', 'Gallery', 'Members', 'Email', 'Finances'];
      return order.indexOf(a.label) - order.indexOf(b.label);
    });
  }, [groupId, role]);

  const shouldAutoClearNotification = (key: NotificationKey | null) => Boolean(key);

  const activeNotificationKey = useMemo(() => {
    const activeItem = navItems.find(item => {
      const demoHref =
        item.href === '/dashboard' ? '/demo/app' : `/demo/app${item.href}`;
      const href = isDemoApp ? demoHref : item.href;
      return isDemoApp
        ? item.href === '/dashboard'
          ? pathname === '/demo/app' || pathname === '/demo/app/dashboard'
          : pathname === href || pathname.startsWith(`${href}/`)
        : pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/');
    });
    return activeItem?.notificationKey ?? null;
  }, [isDemoApp, navItems, pathname]);

  useEffect(() => {
    if (!activeNotificationKey || !shouldAutoClearNotification(activeNotificationKey)) {
      lastAutoClearedRef.current = null;
      return;
    }
    const autoClearKey = `${pathname}:${activeNotificationKey}`;
    if (lastAutoClearedRef.current === autoClearKey) {
      return;
    }
    lastAutoClearedRef.current = autoClearKey;
    onLinkClick(activeNotificationKey);
  }, [activeNotificationKey, onLinkClick, pathname]);

  return (
    <>
      {navItems.map((item) => {
        const demoHref =
          item.href === '/dashboard' ? '/demo/app' : `/demo/app${item.href}`;
        const href = isDemoApp ? demoHref : item.href;
        const isActive = isDemoApp
          ? item.href === '/dashboard'
            ? pathname === '/demo/app' || pathname === '/demo/app/dashboard'
            : pathname === href || pathname.startsWith(`${href}/`)
          : pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/');
        const hasNotification =
          Boolean(item.notificationKey && notifications[item.notificationKey as keyof NotificationMap]) &&
          !isActive;
        
        return (
          <Link
            key={item.href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary',
              item.label === 'Assistant' &&
                'bg-gradient-to-r from-emerald-100 via-emerald-50 to-emerald-50 text-emerald-800 hover:text-emerald-900 shadow-[0_0_10px_rgba(16,185,129,0.25)]',
              isActive &&
                (item.label === 'Assistant'
                  ? 'bg-gradient-to-r from-emerald-300 via-emerald-200 to-emerald-100 text-emerald-950 shadow-[0_0_14px_rgba(16,185,129,0.35)]'
                  : 'bg-muted text-primary')
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
