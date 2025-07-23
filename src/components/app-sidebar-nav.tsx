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
} from 'lucide-react';
import { cn } from '@/lib/utils';

const allNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['President', 'Admin', 'Member'] },
  { href: '/announcements', icon: Megaphone, label: 'Announcements', roles: ['President', 'Admin', 'Member'] },
  { href: '/calendar', icon: CalendarDays, label: 'Calendar', roles: ['President', 'Admin', 'Member'] },
  { href: '/members', icon: UsersRound, label: 'Members', roles: ['President', 'Admin', 'Member'] },
  { href: '/finances', icon: Landmark, label: 'Finances', roles: ['President', 'Admin'] },
  { href: '/slides', icon: Presentation, label: 'Meeting Slides', roles: ['President', 'Admin'] },
  { href: '/social', icon: Network, label: 'Social Media', roles: ['President', 'Admin', 'Member'] },
];

export function AppSidebarNav({ role }: { role: string }) {
  const pathname = usePathname();

  const navItems = allNavItems.filter(item => item.roles.includes(role));

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
