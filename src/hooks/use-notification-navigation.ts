"use client";

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { useToast } from '@/hooks/use-toast';
import { safeFetchJson } from '@/lib/network';
import {
  buildNotificationHref,
  clearPendingNotification,
  notificationSchema,
  parseNotificationFromUrlValue,
  readPendingNotification,
  routeFromNotification,
  type AppNotification,
} from '@/lib/notification-routing';
import {
  clearSelectedGroupId,
  getSelectedOrgId,
  setSelectedGroupId,
  setSelectedOrgId,
} from '@/lib/selection';

type GroupsResponse = {
  ok: boolean;
  data?: {
    groups?: Array<{ id: string }>;
  };
};

const ensureOrgAndGroupContext = async (notification: AppNotification) => {
  const result = await safeFetchJson<GroupsResponse>(
    `/api/groups?orgId=${encodeURIComponent(notification.org_id)}`,
    { retry: { retries: 1 } }
  );

  if (!result.ok) {
    return {
      ok: false as const,
      reason: 'network',
    };
  }

  const groups = result.data?.data?.groups ?? [];
  const hasOrgAccess = Array.isArray(groups);
  if (!hasOrgAccess) {
    return {
      ok: false as const,
      reason: 'forbidden',
    };
  }

  if (notification.group_id && !groups.some(group => group.id === notification.group_id)) {
    return {
      ok: false as const,
      reason: 'forbidden',
    };
  }

  if (getSelectedOrgId() !== notification.org_id) {
    setSelectedOrgId(notification.org_id);
  }

  if (notification.group_id) {
    setSelectedGroupId(notification.group_id);
  } else {
    clearSelectedGroupId();
  }

  return {
    ok: true as const,
  };
};

export function useNotificationNavigation() {
  const router = useRouter();
  const { toast } = useToast();

  const navigateFromNotification = useCallback(
    async (rawNotification: unknown) => {
      const parsed = notificationSchema.safeParse(rawNotification);
      if (!parsed.success) {
        console.error('[notification-navigation] invalid payload', parsed.error.flatten());
        toast({
          title: 'Unable to open notification',
          description: 'That notification payload is invalid.',
          variant: 'destructive',
        });
        router.push('/dashboard');
        return false;
      }

      const notification = parsed.data;
      const contextResult = await ensureOrgAndGroupContext(notification);
      if (!contextResult.ok) {
        toast({
          title: 'Unable to open notification',
          description:
            contextResult.reason === 'forbidden'
              ? 'You no longer have access to that item.'
              : 'We could not load the destination right now.',
          variant: 'destructive',
        });
        router.push('/dashboard');
        return false;
      }

      const route = routeFromNotification(notification);
      router.push(buildNotificationHref(route), { scroll: false });
      return true;
    },
    [router, toast]
  );

  const consumePendingNotification = useCallback(async () => {
    const pendingNotification = readPendingNotification();
    if (!pendingNotification) {
      return false;
    }

    clearPendingNotification();
    return navigateFromNotification(pendingNotification);
  }, [navigateFromNotification]);

  const consumeNotificationFromUrl = useCallback(
    async (value: string | null) => {
      if (!value) {
        return false;
      }

      const notification = parseNotificationFromUrlValue(value);
      if (!notification) {
        return false;
      }

      return navigateFromNotification(notification);
    },
    [navigateFromNotification]
  );

  return {
    navigateFromNotification,
    consumePendingNotification,
    consumeNotificationFromUrl,
  };
}
