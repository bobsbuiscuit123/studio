import {
  buildAnnouncementNotification,
  buildEventNotification,
  buildMessageNotification,
} from '@/lib/notifications';

describe('notification builders', () => {
  it('builds a message notification with conversation metadata', () => {
    const notification = buildMessageNotification({
      userId: 'user-1',
      orgId: 'org-1',
      groupId: 'group-1',
      messageId: 'message-1',
      conversationId: 'chat-1',
      conversationType: 'group',
      createdAt: '2026-04-13T00:00:00.000Z',
    });

    expect(notification.type).toBe('message');
    expect(notification.entity_id).toBe('message-1');
    expect(notification.parent_id).toBe('chat-1');
    expect(notification.parent_type).toBe('group');
  });

  it('builds announcement and event notifications with entity ids', () => {
    const announcement = buildAnnouncementNotification({
      userId: 'user-1',
      orgId: 'org-1',
      groupId: 'group-1',
      announcementId: 'announcement-4',
    });
    const event = buildEventNotification({
      userId: 'user-1',
      orgId: 'org-1',
      groupId: 'group-1',
      eventId: 'event-9',
    });

    expect(announcement.type).toBe('announcement');
    expect(announcement.entity_id).toBe('announcement-4');
    expect(event.type).toBe('event');
    expect(event.entity_id).toBe('event-9');
  });
});
