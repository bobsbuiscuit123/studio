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
      <div className="app-shell grid w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
        <AppSidebar />
        <div className="relative flex min-w-0 flex-col">
          <AppHeader />
          <main className="safe-bottom-space flex min-w-0 flex-1 flex-col gap-4 overflow-x-clip p-4 lg:gap-6 lg:p-6">{children}</main>
        </div>
      </div>
    </DemoDataProvider>
  );
}
