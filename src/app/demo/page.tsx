'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createDemoSession,
  DEMO_MODE_ENABLED,
  getStoredDemoGroupId,
  getStoredDemoSession,
  storeDemoSession,
  type DemoRole,
} from '@/lib/demo/mockData';
import { setSelectedGroupId } from '@/lib/selection';

const ROLE_OPTIONS: DemoRole[] = ['Admin', 'Parent', 'Student'];

export default function DemoRolePage() {
  const router = useRouter();
  const [loadingRole, setLoadingRole] = useState<DemoRole | null>(null);

  const startDemo = (role: DemoRole) => {
    setLoadingRole(role);
    const existingSession = getStoredDemoSession();
    const sharedGroupId = getStoredDemoGroupId();
    const session = createDemoSession(role, existingSession?.groupId ?? sharedGroupId ?? undefined);
    storeDemoSession(session);
    setSelectedGroupId(session.groupId);
    localStorage.removeItem('currentUser');
    router.push('/demo/app');
  };

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

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>CASPO Demo</CardTitle>
          <CardDescription>Choose a role to start a local mock session.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {ROLE_OPTIONS.map(role => (
            <Button
              key={role}
              size="lg"
              onClick={() => startDemo(role)}
              disabled={loadingRole !== null}
            >
              {loadingRole === role ? 'Starting demo...' : role}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
