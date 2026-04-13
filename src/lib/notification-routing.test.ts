import {
  buildNotificationHref,
  getMessageEntityId,
  routeFromNotification,
} from '@/lib/notification-routing';

describe('notification routing', () => {
  it('routes message notifications to the exact conversation with message focus', () => {
    const route = routeFromNotification({
      schema_version: 1,
      id: 'notif-1',
      user_id: 'user-1',
      org_id: 'org-1',
      group_id: 'group-1',
      type: 'message',
      entity_id: 'message-42',
      parent_id: 'chat-7',
      parent_type: 'group',
      created_at: '2026-04-13T00:00:00.000Z',
      read: false,
    });

    expect(route.pathname).toBe('/messages/group__chat-7');
    expect(route.searchParams).toEqual({ messageId: 'message-42' });
    expect(buildNotificationHref(route)).toBe('/messages/group__chat-7?messageId=message-42');
  });

  it('falls back safely when a message notification is missing parent context', () => {
    const route = routeFromNotification({
      schema_version: 1,
      id: 'notif-2',
      user_id: 'user-1',
      org_id: 'org-1',
      group_id: 'group-1',
      type: 'message',
      entity_id: 'message-42',
      parent_id: null,
      created_at: '2026-04-13T00:00:00.000Z',
      read: false,
    });

    expect(route.pathname).toBe('/messages');
    expect(route.fallbackPathname).toBe('/messages');
  });

  it('routes announcements and events with entity query params', () => {
    const announcementRoute = routeFromNotification({
      schema_version: 1,
      id: 'notif-3',
      user_id: 'user-1',
      org_id: 'org-1',
      group_id: 'group-1',
      type: 'announcement',
      entity_id: '17',
      created_at: '2026-04-13T00:00:00.000Z',
      read: false,
    });
    const eventRoute = routeFromNotification({
      schema_version: 1,
      id: 'notif-4',
      user_id: 'user-1',
      org_id: 'org-1',
      group_id: 'group-1',
      type: 'event',
      entity_id: 'evt-9',
      created_at: '2026-04-13T00:00:00.000Z',
      read: false,
    });

    expect(buildNotificationHref(announcementRoute)).toBe('/announcements?announcementId=17');
    expect(buildNotificationHref(eventRoute)).toBe('/calendar?eventId=evt-9');
  });

  it('derives a stable message entity id when a message has no explicit id', () => {
    expect(
      getMessageEntityId({
        sender: 'alex@example.com',
        text: 'Hello',
        timestamp: '2026-04-13T00:00:00.000Z',
        readBy: [],
      })
    ).toBe('alex@example.com:2026-04-13T00:00:00.000Z:Hello');
  });
});
