import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  AI_CHAT_PLANNER_SYSTEM_PROMPT,
  AI_CHAT_RESPONDER_SYSTEM_PROMPT,
  buildAiChatGroupStateSelect,
  buildAiChatPlannerPrompt,
  buildAiChatResponderPrompt,
  filterAllowedAiChatEntities,
  getAllowedAiChatEntities,
  normalizeAiChatContext,
} from '@/lib/ai-chat-server';

describe('ai chat server helpers', () => {
  it('builds a selective group_state projection for requested entities', () => {
    expect(buildAiChatGroupStateSelect(['messages', 'members', 'forms'])).toBe(
      'messages:data->messages,groupChats:data->groupChats,members:data->members,forms:data->forms'
    );
  });

  it('normalizes requested context fields without requiring the full data blob', () => {
    expect(
      normalizeAiChatContext(
        {
          announcements: [{ id: 1, title: 'Launch' }],
          messages: { thread: [{ text: 'Hello' }] },
          groupChats: [{ id: 'chat-1' }],
          forms: [{ id: 'form-1', title: 'RSVP form' }],
        },
        ['announcements', 'messages', 'events', 'forms']
      )
    ).toEqual({
      announcements: [{ id: 1, title: 'Launch' }],
      messages: { thread: [{ text: 'Hello' }] },
      groupChats: [{ id: 'chat-1' }],
      events: [],
      forms: [{ id: 'form-1', title: 'RSVP form' }],
    });
  });

  it('includes bounded history and ids in the planner prompt', () => {
    const prompt = buildAiChatPlannerPrompt({
      message: 'Who is in this group?',
      history: [{ role: 'user', content: 'Hi assistant' }],
      userId: 'user-1',
      userEmail: 'user-1@example.com',
      orgId: 'org-1',
      groupId: 'group-1',
      role: 'Member',
      availableEntities: ['members', 'forms'],
    });

    expect(prompt).toContain('user_id: user-1');
    expect(prompt).toContain('user_email: user-1@example.com');
    expect(prompt).toContain('accessible_entities: ["members","forms"]');
    expect(prompt).toContain('org_id: org-1');
    expect(prompt).toContain('group_id: group-1');
    expect(prompt).toContain('current_user_message: Who is in this group?');
  });

  it('teaches the planner that drafting requests should skip retrieval', () => {
    expect(AI_CHAT_PLANNER_SYSTEM_PROMPT).toContain(
      'Can you draft an announcement reminding everyone to pay dues?'
    );
    expect(AI_CHAT_PLANNER_SYSTEM_PROMPT).toContain('"needs_data": false');
    expect(AI_CHAT_PLANNER_SYSTEM_PROMPT).toContain('"intent": "GENERATION"');
    expect(AI_CHAT_PLANNER_SYSTEM_PROMPT).toContain('Are there any forms I still need to fill out?');
  });

  it('builds a responder prompt with planner metadata and fetched context', () => {
    const prompt = buildAiChatResponderPrompt({
      message: 'Do I need to fill out any forms?',
      history: [{ role: 'assistant', content: 'How can I help?' }],
      planner: {
        needs_data: true,
        intent: 'GROUP_DATA',
        entities: ['forms'],
      },
      usedEntities: ['forms'],
      context: {
        forms: [
          {
            id: 'form-1',
            title: 'Volunteer Sign-up',
            description: 'Tell us which shift works for you.',
            createdBy: 'coach@example.com',
            createdAt: '2026-04-18T10:00:00.000Z',
            questions: [{ id: 'q-1', prompt: 'Shift?' }],
            responses: [],
          },
        ],
      },
      currentUserEmail: 'member@example.com',
      role: 'Member',
    });

    expect(prompt).toContain('"intent":"GROUP_DATA"');
    expect(prompt).toContain('used_entities: ["forms"]');
    expect(prompt).toContain('Volunteer Sign-up');
    expect(prompt).toContain('"needsResponseFromCurrentUser":true');
    expect(prompt).toContain('"questions":[{"id":"q-1","prompt":"Shift?"');
    expect(prompt).not.toContain('coach@example.com');
  });

  it('tells the responder to generate directly when no retrieval is needed', () => {
    const prompt = buildAiChatResponderPrompt({
      message: 'Draft a dues reminder announcement.',
      history: [{ role: 'user', content: 'Keep it short and friendly.' }],
      planner: {
        needs_data: false,
        intent: 'GENERATION',
        entities: [],
      },
      usedEntities: [],
      context: {},
      currentUserEmail: 'member@example.com',
      role: 'Member',
    });

    expect(AI_CHAT_RESPONDER_SYSTEM_PROMPT).toContain('When planner_result.needs_data is false');
    expect(prompt).toContain('No group data was fetched because the planner determined this request can be answered without retrieval.');
    expect(prompt).toContain('current_user_message: Draft a dues reminder announcement.');
  });

  it('filters admin-only entities for non-admin roles', () => {
    expect(getAllowedAiChatEntities('member')).not.toContain('transactions');
    expect(filterAllowedAiChatEntities(['forms', 'transactions'], 'member')).toEqual(['forms']);
    expect(filterAllowedAiChatEntities(['forms', 'transactions'], 'admin')).toEqual([
      'forms',
      'transactions',
    ]);
  });

  it('hides admin-only form responses and viewer details from non-admins', () => {
    const prompt = buildAiChatResponderPrompt({
      message: 'What does the volunteer form ask?',
      history: [],
      planner: {
        needs_data: true,
        intent: 'GROUP_DATA',
        entities: ['forms'],
      },
      usedEntities: ['forms'],
      context: {
        forms: [
          {
            id: 'form-1',
            title: 'Volunteer Sign-up',
            description: 'Pick your preferred shift.',
            createdBy: 'coach@example.com',
            createdAt: '2026-04-18T10:00:00.000Z',
            viewedBy: ['member@example.com', 'officer@example.com'],
            questions: [
              {
                id: 'q-1',
                prompt: 'Shift?',
                required: true,
                kind: 'single',
                options: ['Morning', 'Afternoon'],
              },
            ],
            responses: [
              {
                respondentEmail: 'other@example.com',
                submittedAt: '2026-04-18T12:00:00.000Z',
                answers: { 'q-1': 'Morning' },
              },
            ],
          },
        ],
      },
      currentUserEmail: 'member@example.com',
      role: 'Member',
    });

    expect(prompt).toContain('"questions":[{"id":"q-1","prompt":"Shift?","required":true,"kind":"single","options":["Morning","Afternoon"]}]');
    expect(prompt).toContain('"viewedCount":2');
    expect(prompt).toContain('"responseCount":1');
    expect(prompt).not.toContain('"viewedBy"');
    expect(prompt).not.toContain('other@example.com');
    expect(prompt).not.toContain('coach@example.com');
  });

  it('includes admin-only form details for admins', () => {
    const prompt = buildAiChatResponderPrompt({
      message: 'Who already responded to the volunteer form?',
      history: [],
      planner: {
        needs_data: true,
        intent: 'GROUP_DATA',
        entities: ['forms'],
      },
      usedEntities: ['forms'],
      context: {
        forms: [
          {
            id: 'form-1',
            title: 'Volunteer Sign-up',
            description: 'Pick your preferred shift.',
            createdBy: 'coach@example.com',
            createdAt: '2026-04-18T10:00:00.000Z',
            viewedBy: ['member@example.com', 'officer@example.com'],
            questions: [
              {
                id: 'q-1',
                prompt: 'Shift?',
                required: true,
                kind: 'single',
                options: ['Morning', 'Afternoon'],
              },
            ],
            responses: [
              {
                respondentEmail: 'other@example.com',
                submittedAt: '2026-04-18T12:00:00.000Z',
                answers: { 'q-1': 'Morning' },
              },
            ],
          },
        ],
      },
      currentUserEmail: 'admin@example.com',
      role: 'Admin',
    });

    expect(prompt).toContain('"viewedBy":["member@example.com","officer@example.com"]');
    expect(prompt).toContain('"respondentEmail":"other@example.com"');
    expect(prompt).toContain('"answer":"Morning"');
  });

  it('scopes direct messages to the current user and removes hidden event and point fields', () => {
    const prompt = buildAiChatResponderPrompt({
      message: 'What do my messages and events look like?',
      history: [],
      planner: {
        needs_data: true,
        intent: 'GROUP_DATA',
        entities: ['messages', 'events', 'points', 'announcements', 'gallery', 'social_posts'],
      },
      usedEntities: ['messages', 'events', 'points', 'announcements', 'gallery', 'social_posts'],
      context: {
        announcements: [
          {
            id: 1,
            title: 'Budget meeting',
            content: 'See you tonight.',
            author: 'Alex',
            date: '2026-04-18',
            viewedBy: ['member@example.com', 'officer@example.com'],
          },
        ],
        messages: {
          'member@example.com_partner@example.com': [{ sender: 'partner@example.com', text: 'Hey', timestamp: '2026-04-18T12:00:00.000Z' }],
          'other@example.com_third@example.com': [{ sender: 'other@example.com', text: 'Secret', timestamp: '2026-04-18T12:00:00.000Z' }],
        },
        events: [
          {
            id: 'event-1',
            title: 'Picnic',
            date: '2026-04-20T10:00:00.000Z',
            location: 'Central Park',
            description: 'Snacks and games',
            points: 5,
            attendees: ['member@example.com', 'other@example.com'],
            rsvps: { yes: ['member@example.com', 'other@example.com'], no: ['declined@example.com'] },
            viewedBy: ['member@example.com'],
            rsvpRequired: true,
          },
        ],
        pointEntries: [
          {
            id: 'point-1',
            memberEmail: 'member@example.com',
            points: 10,
            reason: 'Helped at setup',
            date: '2026-04-18',
            awardedBy: 'admin@example.com',
          },
        ],
        galleryImages: [
          {
            id: 'image-1',
            alt: 'Team photo',
            author: 'Alex',
            date: '2026-04-18',
            likes: 2,
            likedBy: ['member@example.com'],
            status: 'approved',
          },
        ],
        socialPosts: [
          {
            id: 1,
            title: 'Recap',
            content: 'Great turnout',
            author: 'Alex',
            date: '2026-04-18',
            likes: 4,
            liked: true,
            comments: [{ author: 'Taylor', text: 'Loved it' }],
          },
        ],
      },
      currentUserEmail: 'member@example.com',
      role: 'Member',
    });

    expect(prompt).toContain('member@example.com_partner@example.com');
    expect(prompt).not.toContain('other@example.com_third@example.com');
    expect(prompt).toContain('"rsvpCount":2');
    expect(prompt).toContain('"currentUserResponse":"yes"');
    expect(prompt).not.toContain('"attendees"');
    expect(prompt).not.toContain('"viewedBy"');
    expect(prompt).not.toContain('admin@example.com');
    expect(prompt).toContain('"currentUserLiked":true');
    expect(prompt).toContain('"comments":[{"author":"Taylor","text":"Loved it"}]');
    expect(prompt).not.toContain('"status":"approved"');
  });
});
