import {
  createEmptyNotificationActivity,
  getNotificationActivityByKey,
  getRoleFromMembers,
  getUnreadNotifications,
} from '@/lib/notification-state';

describe('notification state', () => {
  it('derives the current role from member email without case sensitivity', () => {
    const role = getRoleFromMembers(
      [
        { name: 'Alex', email: 'alex@example.com', role: 'Admin', avatar: 'a' },
        { name: 'Sam', email: 'sam@example.com', role: 'Member', avatar: 'b' },
      ],
      'ALEX@example.com'
    );

    expect(role).toBe('Admin');
  });

  it('calculates unread activity from unseen records only', () => {
    const activity = getNotificationActivityByKey({
      announcements: [
        {
          id: 1,
          title: 'Meeting',
          content: 'Details',
          author: 'officer@example.com',
          date: '2026-03-29T12:00:00.000Z',
          read: false,
          viewedBy: [],
        },
      ],
      socialPosts: [
        {
          id: 1,
          title: 'My own post',
          content: 'Hello',
          images: [],
          author: 'me@example.com',
          date: '2026-03-29T13:00:00.000Z',
          likes: 0,
          comments: [],
          read: false,
        },
      ],
      allMessages: {
        chat: [
          {
            sender: 'friend@example.com',
            text: 'Ping',
            timestamp: '2026-03-29T14:00:00.000Z',
            readBy: [],
          },
        ],
      },
      groupChats: [
        {
          id: 'leaders',
          name: 'Leaders',
          members: ['me@example.com', 'friend@example.com'],
          messages: [
            {
              sender: 'friend@example.com',
              text: 'Update',
              timestamp: '2026-03-29T15:00:00.000Z',
              readBy: [],
            },
          ],
        },
      ],
      events: [
        {
          id: 'event-1',
          title: 'Planning',
          description: '',
          location: 'HQ',
          date: new Date('2026-03-29T16:00:00.000Z'),
          attendees: ['me@example.com', 'friend@example.com', 'third@example.com'],
          viewedBy: [],
        },
      ],
      galleryImages: [
        {
          id: 1,
          src: 'image.png',
          alt: 'Photo',
          author: 'friend@example.com',
          date: '2026-03-29T17:00:00.000Z',
          likes: 0,
          status: 'approved',
        },
      ],
      forms: [
        {
          id: 'form-1',
          title: 'Availability',
          createdBy: 'officer@example.com',
          createdAt: '2026-03-29T18:00:00.000Z',
          questions: [],
          viewedBy: [],
          responses: [
            {
              id: 'response-1',
              respondentEmail: 'friend@example.com',
              submittedAt: '2026-03-29T19:00:00.000Z',
              answers: {},
            },
          ],
        },
      ],
      user: {
        email: 'me@example.com',
        name: 'Me',
      },
      role: 'Admin',
      loading: false,
    });

    expect(activity.announcements).toBe(new Date('2026-03-29T12:00:00.000Z').getTime());
    expect(activity.social).toBe(0);
    expect(activity.messages).toBe(new Date('2026-03-29T15:00:00.000Z').getTime());
    expect(activity.calendar).toBe(new Date('2026-03-29T16:00:00.000Z').getTime());
    expect(activity.gallery).toBe(new Date('2026-03-29T17:00:00.000Z').getTime());
    expect(activity.forms).toBe(new Date('2026-03-29T19:00:00.000Z').getTime());
    expect(activity.attendance).toBe(2);
  });

  it('derives unread flags from activity and last-viewed state', () => {
    const activity = {
      ...createEmptyNotificationActivity(),
      announcements: 10,
      attendance: 3,
    };

    const unread = getUnreadNotifications({
      activityByKey: activity,
      tabLastViewed: createEmptyNotificationActivity(),
      loading: false,
      user: { email: 'me@example.com', name: 'Me' },
      role: 'Admin',
    });

    expect(unread.announcements).toBe(true);
    expect(unread.attendance).toBe(true);
    expect(unread.messages).toBe(false);
  });

  it('treats gallery uploads as visible activity even if older records still say pending', () => {
    const activity = getNotificationActivityByKey({
      announcements: [],
      socialPosts: [],
      allMessages: {},
      groupChats: [],
      events: [],
      galleryImages: [
        {
          id: 42,
          src: 'image.png',
          alt: 'Photo',
          author: 'friend@example.com',
          date: '2026-03-30T12:00:00.000Z',
          likes: 0,
          status: 'pending',
        },
      ],
      forms: [],
      user: {
        email: 'me@example.com',
        name: 'Me',
      },
      role: 'Member',
      loading: false,
    });

    expect(activity.gallery).toBe(new Date('2026-03-30T12:00:00.000Z').getTime());
  });
});
