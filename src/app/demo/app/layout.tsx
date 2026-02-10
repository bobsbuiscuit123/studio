'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { AppSidebar } from '@/components/app-sidebar';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DemoDataProvider } from '@/lib/demo/DemoDataProvider';
import {
  DEMO_MODE_ENABLED,
  getStoredDemoSession,
  type DemoSession,
} from '@/lib/demo/mockData';

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
    localStorage.setItem('selectedClubId', parsed.groupId);
    setSession(parsed);
  }, [router]);

  if (!DEMO_MODE_ENABLED) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Demo mode not enabled</CardTitle>
            <CardDescription>Set NEXT_PUBLIC_DEMO_MODE=true and reload.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading demo session...
      </div>
    );
  }

  return (
    <DemoDataProvider initialSession={session}>
      <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
        <AppSidebar />
        <div className="flex flex-col relative">
          <AppHeader />
          <main className="flex-1 flex flex-col gap-4 p-4 lg:gap-6 lg:p-6">{children}</main>
        </div>
      </div>
    </DemoDataProvider>
  );
}
