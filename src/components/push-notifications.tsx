'use client';

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationActionPerformed,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { usePathname, useRouter } from 'next/navigation';

import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/lib/data-hooks';
import { safeFetchJson } from '@/lib/network';

const parsePushParams = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const getPushRoute = (notification: PushNotificationSchema | undefined) => {
  const data = notification?.data;
  const route = typeof data?.route === 'string' ? data.route : '';
  const params = parsePushParams(data?.params);
  return { route, params };
};

const normalizeRoutePath = (value: string) => {
  if (!value) return '';
  try {
    const parsed = new URL(value, 'https://caspo.local');
    return parsed.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return value.split('?')[0]?.replace(/\/+$/, '') || '/';
  }
};

const getRouteSection = (value: string) => {
  let path = normalizeRoutePath(value);
  if (path === '/demo/app') {
    path = '/';
  } else if (path.startsWith('/demo/app/')) {
    path = path.slice('/demo/app'.length) || '/';
  }
  return path.split('/').filter(Boolean)[0] ?? '';
};

const shouldSuppressForegroundToast = (pathname: string, route: string) => {
  const currentPath = normalizeRoutePath(pathname);
  const targetPath = normalizeRoutePath(route);
  if (!currentPath || !targetPath) {
    return false;
  }
  if (currentPath === targetPath) {
    return true;
  }
  const currentSection = getRouteSection(currentPath);
  const targetSection = getRouteSection(targetPath);
  return Boolean(currentSection) && currentSection === targetSection;
};

export function PushNotificationClient() {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const { user, loading } = useCurrentUser();
  const lastRegistrationKeyRef = useRef<string | null>(null);
  const pathnameRef = useRef(pathname);
  const toastRef = useRef(toast);
  const userEmailRef = useRef(user?.email ?? null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    userEmailRef.current = user?.email ?? null;
  }, [user?.email]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || loading || !user?.email) {
      return;
    }

    let cancelled = false;
    const listenerHandles: PluginListenerHandle[] = [];

    const registerToken = async (token: string) => {
      const userEmail = userEmailRef.current;
      if (!userEmail) return;
      const registrationKey = `${userEmail}:${token}`;
      if (!token || lastRegistrationKeyRef.current === registrationKey) return;
      const result = await safeFetchJson<{ ok: boolean }>('/api/push/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          platform: Capacitor.getPlatform(),
        }),
        timeoutMs: 10_000,
        retry: { retries: 0 },
        treatOfflineAsError: false,
      });

      if (result.ok) {
        lastRegistrationKeyRef.current = registrationKey;
      } else {
        console.error('Push token registration failed', result.error);
      }
    };

    const handleRegistration = async (token: Token) => {
      if (cancelled) return;
      await registerToken(token.value);
    };

    const handleAction = (event: PushNotificationActionPerformed) => {
      const { route } = getPushRoute(event.notification);
      if (!route) return;
      router.push(route);
    };

    const handleReceived = (notification: PushNotificationSchema) => {
      const { route } = getPushRoute(notification);
      if (route && shouldSuppressForegroundToast(pathnameRef.current, route)) {
        return;
      }

      const title = typeof notification.title === 'string' ? notification.title.trim() : '';
      const body = typeof notification.body === 'string' ? notification.body.trim() : '';
      if (!title && !body) {
        return;
      }

      toastRef.current({
        title: title || 'Notification',
        description: body || undefined,
      });
    };

    const init = async () => {
      const existingPermissions = await PushNotifications.checkPermissions();
      let receive = existingPermissions.receive;
      if (receive === 'prompt') {
        const requested = await PushNotifications.requestPermissions();
        receive = requested.receive;
      }
      if (receive !== 'granted') {
        return;
      }

      listenerHandles.push(await PushNotifications.addListener('registration', handleRegistration));
      listenerHandles.push(
        await PushNotifications.addListener('registrationError', error => {
          console.error('Push registration error', error);
        })
      );
      listenerHandles.push(
        await PushNotifications.addListener('pushNotificationReceived', handleReceived)
      );
      listenerHandles.push(
        await PushNotifications.addListener('pushNotificationActionPerformed', handleAction)
      );

      await PushNotifications.register();
    };

    void init();

    return () => {
      cancelled = true;
      void Promise.all(listenerHandles.map(handle => handle.remove()));
    };
  }, [loading, router, user?.email]);

  return null;
}
