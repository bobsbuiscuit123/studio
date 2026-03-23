'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

const getInitialOnline = () => {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine ?? true;
};

const confirmOnline = () => {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine ?? true;
};

export function NetworkStatusBanner() {
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(getInitialOnline);

  useEffect(() => {
    let active = true;

    const syncOnline = () => {
      const online = confirmOnline();
      if (active) setIsOnline(online);
    };

    const handleOnline = () => {
      setIsOnline(true);
      toast({
        title: 'Back online',
        description: 'Connection restored. You can continue where you left off.',
      });
    };
    const handleOffline = () => {
      const online = confirmOnline();
      if (!active) return;
      if (online) {
        setIsOnline(true);
        return;
      }
      setIsOnline(false);
      toast({
        title: 'You are offline',
        description: 'Some features may be unavailable until you reconnect.',
        variant: 'destructive',
      });
    };

    syncOnline();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast]);

  if (isOnline) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-md"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span>You&apos;re offline. Changes may not save.</span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    </div>
  );
}

export function OfflineCallout() {
  const [isOnline, setIsOnline] = useState(getInitialOnline);

  useEffect(() => {
    let active = true;

    const syncOnline = () => {
      const online = confirmOnline();
      if (active) setIsOnline(online);
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      const online = confirmOnline();
      if (active) setIsOnline(online);
    };

    syncOnline();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-semibold">No connection</div>
      <div className="mt-1 text-amber-800">
        You&apos;re offline. We&apos;ll keep showing cached data, but updates won&apos;t sync until
        you reconnect.
      </div>
    </div>
  );
}
