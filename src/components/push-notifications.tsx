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
import { useRouter } from 'next/navigation';

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

export function PushNotificationClient() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const lastRegisteredTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || loading || !user) {
      return;
    }

    let cancelled = false;
    const listenerHandles: PluginListenerHandle[] = [];

    const registerToken = async (token: string) => {
      if (!token || lastRegisteredTokenRef.current === token) return;
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
        lastRegisteredTokenRef.current = token;
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
        await PushNotifications.addListener('pushNotificationActionPerformed', handleAction)
      );

      await PushNotifications.register();
    };

    void init();

    return () => {
      cancelled = true;
      void Promise.all(listenerHandles.map(handle => handle.remove()));
    };
  }, [loading, router, user]);

  return null;
}
