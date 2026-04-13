import { notificationSchema, type AppNotification } from '@/lib/notification-routing';

type NotificationBuilderBase = {
  id?: string;
  userId: string;
  orgId: string;
  groupId?: string | null;
  createdAt?: string;
  read?: boolean;
};

type MessageNotificationInput = NotificationBuilderBase & {
  messageId: string;
  conversationId: string;
  conversationType: 'dm' | 'group';
};

type AnnouncementNotificationInput = NotificationBuilderBase & {
  announcementId: string;
};

type EventNotificationInput = NotificationBuilderBase & {
  eventId: string;
};

const createNotificationId = (prefix: string, entityId: string) =>
  `${prefix}:${entityId}:${Date.now()}`;

const buildBase = (
  input: NotificationBuilderBase,
  next: Omit<AppNotification, 'schema_version' | 'id' | 'user_id' | 'org_id' | 'group_id' | 'created_at' | 'read'>
) =>
  notificationSchema.parse({
    schema_version: 1,
    id: input.id ?? createNotificationId(next.type, next.entity_id ?? 'unknown'),
    user_id: input.userId,
    org_id: input.orgId,
    group_id: input.groupId ?? null,
    created_at: input.createdAt ?? new Date().toISOString(),
    read: input.read ?? false,
    ...next,
  });

export const buildMessageNotification = (input: MessageNotificationInput) =>
  buildBase(input, {
    type: 'message',
    entity_id: input.messageId,
    parent_id: input.conversationId,
    parent_type: input.conversationType,
  });

export const buildAnnouncementNotification = (
  input: AnnouncementNotificationInput
) =>
  buildBase(input, {
    type: 'announcement',
    entity_id: input.announcementId,
    parent_id: null,
    parent_type: null,
  });

export const buildEventNotification = (input: EventNotificationInput) =>
  buildBase(input, {
    type: 'event',
    entity_id: input.eventId,
    parent_id: null,
    parent_type: null,
  });
