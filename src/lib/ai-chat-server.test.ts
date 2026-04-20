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
    });

    expect(prompt).toContain('"intent":"GROUP_DATA"');
    expect(prompt).toContain('used_entities: ["forms"]');
    expect(prompt).toContain('Volunteer Sign-up');
    expect(prompt).toContain('"needsResponseFromCurrentUser":true');
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
});
