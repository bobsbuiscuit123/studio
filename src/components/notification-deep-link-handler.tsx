"use client";

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useNotificationNavigation } from '@/hooks/use-notification-navigation';

export function NotificationDeepLinkHandler() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const handledUrlPayloadRef = useRef<string | null>(null);
  const { consumePendingNotification, consumeNotificationFromUrl } = useNotificationNavigation();

  useEffect(() => {
    void consumePendingNotification();
  }, [consumePendingNotification]);

  useEffect(() => {
    const notificationPayload = searchParams.get('notification');
    if (!notificationPayload || handledUrlPayloadRef.current === notificationPayload) {
      return;
    }

    handledUrlPayloadRef.current = notificationPayload;

    void consumeNotificationFromUrl(notificationPayload).then(handled => {
      if (!handled) {
        return;
      }

      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('notification');
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    });
  }, [consumeNotificationFromUrl, pathname, router, searchParams]);

  return null;
}
