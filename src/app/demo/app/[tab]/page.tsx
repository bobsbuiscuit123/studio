'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AnnouncementsPage from '@/app/(app)/announcements/page';
import AssistantPage from '@/app/(app)/assistant/page';
import AttendancePage from '@/app/(app)/attendance/page';
import CalendarPage from '@/app/(app)/calendar/page';
import DashboardPage from '@/app/(app)/dashboard/page';
import EmailPage from '@/app/(app)/email/page';
import FinancesPage from '@/app/(app)/finances/page';
import FormsPage from '@/app/(app)/forms/page';
import GalleryPage from '@/app/(app)/gallery/page';
import MembersPage from '@/app/(app)/members/page';
import MessagesPage from '@/app/(app)/messages/page';
import PointsPage from '@/app/(app)/points/page';

const TAB_COMPONENTS: Record<string, () => JSX.Element> = {
  dashboard: DashboardPage,
  announcements: AnnouncementsPage,
  assistant: AssistantPage,
  attendance: AttendancePage,
  calendar: CalendarPage,
  email: EmailPage,
  finances: FinancesPage,
  forms: FormsPage,
  gallery: GalleryPage,
  members: MembersPage,
  messages: MessagesPage,
  points: PointsPage,
};

export default function DemoTabPage() {
  const router = useRouter();
  const params = useParams<{ tab: string }>();
  const tab = typeof params?.tab === 'string' ? params.tab : 'dashboard';
  const Component = TAB_COMPONENTS[tab];

  useEffect(() => {
    if (!Component) {
      router.replace('/demo/app');
    }
  }, [Component, router]);

  if (!Component) return null;

  return <Component />;
}
