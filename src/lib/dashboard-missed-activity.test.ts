import { describe, expect, it } from 'vitest';

import { buildDashboardMissedPopupItems } from '@/lib/dashboard-missed-activity';
import { createGroupActivitySnapshot } from '@/lib/notification-state';
import type { Announcement, ClubEvent, ClubForm, GroupChat, Member, Message } from '@/lib/mock-data';

const baseMembers: Member[] = [
  {
    name: 'Me',
    email: 'me@example.com',
    role: 'Member',
    avatar: 'me.png',
  },
  {
    name: 'Alex',
    email: 'alex@example.com',
    role: 'Officer',
    avatar: 'alex.png',
  },
];

const baseEvents: ClubEvent[] = [
  {
    id: 'event-1',
    title: 'Planning Night',
    description: '',
    location: 'HQ',
    date: new Date('2026-03-30T18:00:00.000Z'),
    attendees: ['alex@example.com'],
    rsvps: {
      yes: ['alex@example.com'],
      no: [],
      maybe: [],
    },
  },
];

const resolveMemberName = (email: string) =>
  email === 'alex@example.com' ? 'Alex' : email === 'me@example.com' ? 'Me' : email;

describe('dashboard missed activity', () => {
  it('includes missed announcements, unread messages, and new forms from before the current group session', () => {
    const announcements: Announcement[] = [
      {
        id: 1,
        title: 'Important update',
        content: 'Please read',
        author: 'alex@example.com',
        date: '2026-03-30T10:00:00.000Z',
        read: false,
        viewedBy: [],
      },
    ];
    const messages: Record<string, Message[]> = {
      'alex@example.com_me@example.com': [
        {
          sender: 'alex@example.com',
          text: 'Can you review this?',
          timestamp: '2026-03-30T10:05:00.000Z',
          readBy: [],
        },
      ],
    };
    const groupChats: GroupChat[] = [];
    const forms: ClubForm[] = [
      {
        id: 'form-1',
        title: 'RSVP form',
        description: '',
        questions: [],
        createdBy: 'alex@example.com',
        createdAt: '2026-03-30T10:10:00.000Z',
        viewedBy: [],
        responses: [],
      },
    ];

    const items = buildDashboardMissedPopupItems({
      announcements,
      events: baseEvents,
      forms,
      groupChats,
      members: baseMembers,
      messages,
      persistedSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      resolveMemberName,
      sessionSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      groupSessionStartedAt: new Date('2026-03-30T11:00:00.000Z').getTime(),
      shownActivityKeys: new Set(),
      userEmail: 'me@example.com',
    });

    expect(items.map(item => item.type)).toEqual(['form', 'message', 'announcement']);
    expect(items.flatMap(item => item.keys)).toEqual([
      'form:form-1',
      'message:dm:alex@example.com_me@example.com:2026-03-30T10:05:00.000Z:alex@example.com',
      'announcement:1',
    ]);
  });

  it('suppresses announcement, message, and form deltas created during the current visible group session', () => {
    const items = buildDashboardMissedPopupItems({
      announcements: [
        {
          id: 1,
          title: 'Live update',
          content: 'Fresh',
          author: 'alex@example.com',
          date: '2026-03-30T12:05:00.000Z',
          read: false,
          viewedBy: [],
        },
      ],
      events: baseEvents,
      forms: [
        {
          id: 'form-1',
          title: 'Fresh form',
          description: '',
          questions: [],
          createdBy: 'alex@example.com',
          createdAt: '2026-03-30T12:06:00.000Z',
          viewedBy: [],
          responses: [],
        },
      ],
      groupChats: [
        {
          id: 'leaders',
          name: 'Leaders',
          members: ['me@example.com', 'alex@example.com'],
          messages: [
            {
              sender: 'alex@example.com',
              text: 'Seen while active',
              timestamp: '2026-03-30T12:07:00.000Z',
              readBy: [],
            },
          ],
        },
      ],
      members: baseMembers,
      messages: {},
      persistedSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      resolveMemberName,
      sessionSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      groupSessionStartedAt: new Date('2026-03-30T12:00:00.000Z').getTime(),
      shownActivityKeys: new Set(),
      userEmail: 'me@example.com',
    });

    expect(items).toHaveLength(0);
  });

  it('shows structural deltas only when they existed before the current group session', () => {
    const nextMembers: Member[] = [
      ...baseMembers,
      {
        name: 'Taylor',
        email: 'taylor@example.com',
        role: 'Member',
        avatar: 'taylor.png',
      },
    ];
    const nextEvents: ClubEvent[] = [
      ...baseEvents,
      {
        id: 'event-2',
        title: 'Workshop',
        description: '',
        location: 'Room 2',
        date: new Date('2026-03-31T18:00:00.000Z'),
        attendees: ['alex@example.com', 'taylor@example.com'],
        rsvps: {
          yes: ['alex@example.com', 'taylor@example.com'],
          no: [],
          maybe: [],
        },
      },
    ];

    const existingBeforeSession = buildDashboardMissedPopupItems({
      announcements: [],
      events: nextEvents,
      forms: [],
      groupChats: [],
      members: nextMembers,
      messages: {},
      persistedSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      resolveMemberName,
      sessionSnapshot: createGroupActivitySnapshot({ members: nextMembers, events: nextEvents }),
      groupSessionStartedAt: new Date('2026-03-30T12:00:00.000Z').getTime(),
      shownActivityKeys: new Set(),
      userEmail: 'me@example.com',
    });

    expect(existingBeforeSession.map(item => item.type)).toEqual(['member', 'event', 'rsvp', 'attendance']);

    const happenedDuringSession = buildDashboardMissedPopupItems({
      announcements: [],
      events: nextEvents,
      forms: [],
      groupChats: [],
      members: nextMembers,
      messages: {},
      persistedSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      resolveMemberName,
      sessionSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      groupSessionStartedAt: new Date('2026-03-30T12:00:00.000Z').getTime(),
      shownActivityKeys: new Set(),
      userEmail: 'me@example.com',
    });

    expect(happenedDuringSession).toHaveLength(0);
  });

  it('does not include new form responses as popup delta items', () => {
    const items = buildDashboardMissedPopupItems({
      announcements: [],
      events: baseEvents,
      forms: [
        {
          id: 'form-1',
          title: 'Availability',
          description: '',
          questions: [],
          createdBy: 'alex@example.com',
          createdAt: '2026-03-30T08:00:00.000Z',
          viewedBy: ['me@example.com'],
          responses: [
            {
              id: 'response-1',
              respondentEmail: 'alex@example.com',
              submittedAt: '2026-03-30T09:00:00.000Z',
              answers: {},
            },
          ],
        },
      ],
      groupChats: [],
      members: baseMembers,
      messages: {},
      persistedSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      resolveMemberName,
      sessionSnapshot: createGroupActivitySnapshot({ members: baseMembers, events: baseEvents }),
      groupSessionStartedAt: new Date('2026-03-30T11:00:00.000Z').getTime(),
      shownActivityKeys: new Set(),
      userEmail: 'me@example.com',
    });

    expect(items).toHaveLength(0);
  });
});
