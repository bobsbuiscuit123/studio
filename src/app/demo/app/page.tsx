'use client';

import DashboardPage from '@/app/(app)/dashboard/page';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useDemoCtx } from '@/lib/demo/DemoDataProvider';

export default function DemoAppPage() {
  const { session, clubName } = useDemoCtx();
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Demo session active</CardTitle>
          <CardDescription>
            Role: {session.role} | Group: {clubName}
          </CardDescription>
        </CardHeader>
      </Card>
      <DashboardPage />
    </>
  );
}
