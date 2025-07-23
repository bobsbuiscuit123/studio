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
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/assistant', icon: Bot, label: 'AI Assistant' },
  { href: '/announcements', icon: Megaphone, label: 'Announcements' },
  { href: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { href: '/members', icon: UsersRound, label: 'Members' },
  { href: '/finances', icon: Landmark, label: 'Finances' },
  { href: '/slides', icon: Presentation, label: 'Meeting Slides' },
  { href: '/social', icon: Network, label: 'Social Media' },
];

export function AppSidebarNav() {
  const pathname = usePathname();

  return (
    <>
      {navItems.map((item) => (
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
        </Link>
      ))}
    </>
  );
}
