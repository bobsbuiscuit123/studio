import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  AI_CHAT_PLANNER_SYSTEM_PROMPT,
  AI_CHAT_RESPONDER_SYSTEM_PROMPT,
  buildAiChatGroupStateSelect,
  buildAiChatPlannerPrompt,
  buildAiChatResponderPrompt,
  normalizeAiChatContext,
} from '@/lib/ai-chat-server';

describe('ai chat server helpers', () => {
  it('builds a selective group_state projection for requested entities', () => {
    expect(buildAiChatGroupStateSelect(['messages', 'members'])).toBe(
      'messages:data->messages,groupChats:data->groupChats,members:data->members'
    );
  });

  it('normalizes requested context fields without requiring the full data blob', () => {
    expect(
      normalizeAiChatContext(
        {
          announcements: [{ id: 1, title: 'Launch' }],
          messages: { thread: [{ text: 'Hello' }] },
          groupChats: [{ id: 'chat-1' }],
        },
        ['announcements', 'messages', 'events']
      )
    ).toEqual({
      announcements: [{ id: 1, title: 'Launch' }],
      messages: { thread: [{ text: 'Hello' }] },
      groupChats: [{ id: 'chat-1' }],
      events: [],
    });
  });

  it('includes bounded history and ids in the planner prompt', () => {
    const prompt = buildAiChatPlannerPrompt({
      message: 'Who is in this group?',
      history: [{ role: 'user', content: 'Hi assistant' }],
      userId: 'user-1',
      orgId: 'org-1',
      groupId: 'group-1',
    });

    expect(prompt).toContain('user_id: user-1');
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
  });

  it('builds a responder prompt with planner metadata and fetched context', () => {
    const prompt = buildAiChatResponderPrompt({
      message: 'Summarize the latest announcement.',
      history: [{ role: 'assistant', content: 'How can I help?' }],
      planner: {
        needs_data: true,
        intent: 'GROUP_DATA',
        entities: ['announcements'],
      },
      usedEntities: ['announcements'],
      context: {
        announcements: [
          {
            id: 7,
            title: 'Meeting moved',
            content: 'The meeting is now on Friday at 4pm.',
            author: 'Coach',
            date: '2026-04-18T10:00:00.000Z',
            viewedBy: ['member@example.com'],
          },
        ],
      },
    });

    expect(prompt).toContain('"intent":"GROUP_DATA"');
    expect(prompt).toContain('used_entities: ["announcements"]');
    expect(prompt).toContain('Meeting moved');
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
    });

    expect(AI_CHAT_RESPONDER_SYSTEM_PROMPT).toContain('When planner_result.needs_data is false');
    expect(prompt).toContain('No group data was fetched because the planner determined this request can be answered without retrieval.');
    expect(prompt).toContain('current_user_message: Draft a dues reminder announcement.');
  });
});
