'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { AppMobileTabBar } from '@/components/app-mobile-tab-bar';
import { AppSidebar } from '@/components/app-sidebar';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DemoDataProvider } from '@/lib/demo/DemoDataProvider';
import {
  DEMO_MODE_ENABLED,
  getStoredDemoSession,
  type DemoSession,
} from '@/lib/demo/mockData';
import { setSelectedGroupId } from '@/lib/selection';

export default function DemoAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [session, setSession] = useState<DemoSession | null>(null);

  useEffect(() => {
    if (!DEMO_MODE_ENABLED) {
      router.replace('/');
      return;
    }
    const parsed = getStoredDemoSession();
    if (!parsed) {
      router.replace('/demo');
      return;
    }
    setSelectedGroupId(parsed.groupId);
    setSession(parsed);
  }, [router]);

  if (!DEMO_MODE_ENABLED) {
    return (
      <div className="viewport-page">
        <div className="viewport-scroll flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Demo mode not enabled</CardTitle>
            <CardDescription>Set NEXT_PUBLIC_DEMO_MODE=true and reload.</CardDescription>
          </CardHeader>
        </Card>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="viewport-page">
        <div className="viewport-scroll flex items-center justify-center text-sm text-muted-foreground">
          Loading demo session...
        </div>
      </div>
    );
  }

  return (
    <DemoDataProvider initialSession={session}>
      <div className="app-shell grid w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
        <AppSidebar />
        <div className="relative flex min-w-0 flex-col overflow-hidden">
          <AppHeader />
          <main className="main-container safe-bottom-space mx-auto flex w-full max-w-screen-md min-w-0 flex-1 flex-col gap-4 overflow-x-clip px-4 py-0 sm:max-w-none sm:px-4 sm:py-0 lg:gap-6 lg:px-6 lg:py-0">{children}</main>
          <div className="md:hidden">
            <AppMobileTabBar />
          </div>
        </div>
      </div>
    </DemoDataProvider>
  );
}
