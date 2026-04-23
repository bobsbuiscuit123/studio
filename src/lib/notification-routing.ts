import { z } from 'zod';

import type { Message } from '@/lib/mock-data';
import { getMessageEntityId as getSharedMessageEntityId } from '@/lib/message-state';

export const notificationTypeValues = [
  'message',
  'announcement',
  'event',
  'social',
  'form',
  'gallery',
  'attendance',
  'points',
  'finance',
  'member',
] as const;

export const notificationSchema = z.object({
  schema_version: z.literal(1).default(1),
  id: z.string().min(1),
  user_id: z.string().min(1),
  org_id: z.string().min(1),
  group_id: z.string().min(1).nullable().optional(),
  type: z.enum(notificationTypeValues),
  entity_id: z.string().min(1).nullable(),
  parent_id: z.string().min(1).nullable().optional(),
  parent_type: z.enum(['dm', 'group']).nullable().optional(),
  created_at: z.string().min(1),
  read: z.boolean(),
});

export type AppNotification = z.infer<typeof notificationSchema>;
export type NotificationType = AppNotification['type'];

export type NotificationRoute = {
  pathname: string;
  searchParams?: Record<string, string>;
  fallbackPathname: string;
};

export const PENDING_NOTIFICATION_STORAGE_KEY = 'pendingNotificationV1';

const toSearchParams = (searchParams?: Record<string, string>) => {
  const params = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  return params.toString();
};

const encodeConversationRouteId = (parentId: string, parentType?: AppNotification['parent_type']) => {
  if (parentId.startsWith('dm__') || parentId.startsWith('group__')) {
    return parentId;
  }

  if (parentType === 'dm') {
    return `dm__${encodeURIComponent(parentId)}`;
  }

  return `group__${encodeURIComponent(parentId)}`;
};

export const getMessageEntityId = (message: Message) => getSharedMessageEntityId(message);

export const buildNotificationHref = (route: NotificationRoute) => {
  const query = toSearchParams(route.searchParams);
  return query ? `${route.pathname}?${query}` : route.pathname;
};

export const getNotificationFallbackPath = (notification: Pick<AppNotification, 'type'>) => {
  switch (notification.type) {
    case 'message':
      return '/messages';
    case 'announcement':
      return '/announcements';
    case 'event':
      return '/calendar';
    case 'social':
    case 'gallery':
      return '/gallery';
    case 'form':
      return '/forms';
    case 'attendance':
      return '/attendance';
    case 'points':
      return '/points';
    case 'finance':
      return '/finances';
    case 'member':
      return '/members';
    default:
      return '/dashboard';
  }
};

export function routeFromNotification(rawNotification: unknown): NotificationRoute {
  const parsed = notificationSchema.safeParse(rawNotification);
  if (!parsed.success) {
    console.error('[notification-routing] invalid notification payload', parsed.error.flatten());
    return {
      pathname: '/dashboard',
      fallbackPathname: '/dashboard',
    };
  }

  const notification = parsed.data;
  const fallbackPathname = getNotificationFallbackPath(notification);

  switch (notification.type) {
    case 'message': {
      if (!notification.parent_id) {
        return {
          pathname: fallbackPathname,
          fallbackPathname,
        };
      }

      return {
        pathname: `/messages/${encodeConversationRouteId(
          notification.parent_id,
          notification.parent_type ?? undefined
        )}`,
        searchParams: notification.entity_id
          ? {
              messageId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    }
    case 'announcement':
      return {
        pathname: '/announcements',
        searchParams: notification.entity_id
          ? {
              announcementId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'event':
      return {
        pathname: '/calendar',
        searchParams: notification.entity_id
          ? {
              eventId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'social':
      return {
        pathname: '/gallery',
        searchParams: notification.entity_id
          ? {
              postId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'form':
      return {
        pathname: '/forms',
        searchParams: notification.entity_id
          ? {
              formId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'gallery':
      return {
        pathname: '/gallery',
        searchParams: notification.entity_id
          ? {
              imageId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'attendance':
      return {
        pathname: '/attendance',
        searchParams: notification.entity_id
          ? {
              eventId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'points':
      return {
        pathname: '/points',
        searchParams: notification.entity_id
          ? {
              entryId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'finance':
      return {
        pathname: '/finances',
        searchParams: notification.entity_id
          ? {
              transactionId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    case 'member':
      return {
        pathname: '/members',
        searchParams: notification.entity_id
          ? {
              memberId: notification.entity_id,
            }
          : undefined,
        fallbackPathname,
      };
    default:
      console.error('[notification-routing] unknown notification type', notification);
      return {
        pathname: '/dashboard',
        fallbackPathname: '/dashboard',
      };
  }
}

export const serializeNotificationForUrl = (notification: AppNotification) =>
  encodeURIComponent(JSON.stringify(notification));

export const parseNotificationFromUrlValue = (value: string) => {
  try {
    return notificationSchema.parse(JSON.parse(decodeURIComponent(value)));
  } catch (error) {
    console.error('[notification-routing] failed to parse URL payload', error);
    return null;
  }
};

export const storePendingNotification = (notification: AppNotification) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PENDING_NOTIFICATION_STORAGE_KEY, JSON.stringify(notification));
};

export const readPendingNotification = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(PENDING_NOTIFICATION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return notificationSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error('[notification-routing] failed to parse pending notification', error);
    return null;
  }
};

export const clearPendingNotification = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(PENDING_NOTIFICATION_STORAGE_KEY);
};
