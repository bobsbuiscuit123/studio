import { describe, expect, it } from 'vitest';

import {
  clearConversationMessages,
  getMessageEntityId,
  markMessageReadByActor,
  mergeGroupChatLists,
  mergeMessageMaps,
  normalizeGroupChats,
  normalizeMessageMap,
  replaceConversationMessage,
  removeConversationMessages,
  removeGroupChatMessages,
} from '@/lib/message-state';

describe('message state normalization', () => {
  it('normalizes legacy direct-message payloads', () => {
    expect(
      normalizeMessageMap({
        ' Alice@example.com_Bob@example.com ': [
          {
            id: ' msg-1 ',
            sender: ' Alice@example.com ',
            text: '  Hey there  ',
            timestamp: '2026-03-26T12:00:00.000Z',
          },
          null,
          {
            sender: 42,
            text: null,
            timestamp: null,
          },
        ],
        empty: 'invalid',
      })
    ).toEqual({
      'alice@example.com_bob@example.com': [
        {
          id: 'msg-1',
          sender: 'alice@example.com',
          text: 'Hey there',
          timestamp: '2026-03-26T12:00:00.000Z',
          readBy: [],
        },
      ],
      empty: [],
    });
  });

  it('normalizes group chats and drops unusable entries', () => {
    expect(
      normalizeGroupChats([
        {
          id: 'chat-1',
          members: [' Alice@example.com ', '', null],
          messages: [
            {
              sender: 'Bob@example.com',
              text: 'Hi',
              timestamp: '2026-03-26T12:30:00.000Z',
              readBy: [' Bob@example.com ', 'alice@example.com'],
            },
          ],
        },
        {
          name: 'missing-id',
        },
      ])
    ).toEqual([
      {
        id: 'chat-1',
        name: 'Group chat',
        members: ['alice@example.com'],
        messages: [
          {
            sender: 'bob@example.com',
            text: 'Hi',
            timestamp: '2026-03-26T12:30:00.000Z',
            readBy: ['bob@example.com', 'alice@example.com'],
          },
        ],
      },
    ]);
  });

  it('normalizes reply references on messages', () => {
    expect(
      normalizeMessageMap({
        'alice@example.com_bob@example.com': [
          {
            id: 'reply-1',
            sender: 'Alice@example.com',
            text: 'I agree',
            timestamp: '2026-03-26T12:35:00.000Z',
            replyTo: {
              id: ' original-1 ',
              sender: ' Bob@example.com ',
              text: '  Can you review this?  ',
              timestamp: '2026-03-26T12:30:00.000Z',
            },
          },
        ],
      })
    ).toEqual({
      'alice@example.com_bob@example.com': [
        {
          id: 'reply-1',
          sender: 'alice@example.com',
          text: 'I agree',
          timestamp: '2026-03-26T12:35:00.000Z',
          readBy: [],
          replyTo: {
            id: 'original-1',
            sender: 'bob@example.com',
            text: 'Can you review this?',
            timestamp: '2026-03-26T12:30:00.000Z',
          },
        },
      ],
    });
  });

  it('marks readBy once, case-insensitively', () => {
    expect(
      markMessageReadByActor(
        {
          sender: 'alice@example.com',
          text: 'Ping',
          timestamp: '2026-03-26T13:00:00.000Z',
          readBy: ['Alice@example.com'],
        },
        'alice@example.com'
      )
    ).toEqual({
      sender: 'alice@example.com',
      text: 'Ping',
      timestamp: '2026-03-26T13:00:00.000Z',
      readBy: ['Alice@example.com'],
    });

    expect(
      markMessageReadByActor(
        {
          sender: 'alice@example.com',
          text: 'Ping',
          timestamp: '2026-03-26T13:00:00.000Z',
          readBy: [],
        },
        'Bob@example.com'
      )
    ).toEqual({
      sender: 'alice@example.com',
      text: 'Ping',
      timestamp: '2026-03-26T13:00:00.000Z',
      readBy: ['bob@example.com'],
    });
  });

  it('merges direct-message maps without dropping optimistic messages', () => {
    expect(
      mergeMessageMaps(
        {
          'alice@example.com_bob@example.com': [
            {
              sender: 'alice@example.com',
              text: 'On my way',
              timestamp: '2026-03-26T14:00:00.000Z',
              readBy: ['alice@example.com'],
            },
          ],
        },
        {
          'alice@example.com_bob@example.com': [
            {
              sender: 'alice@example.com',
              text: 'On my way',
              timestamp: '2026-03-26T14:00:00.000Z',
              readBy: ['bob@example.com'],
            },
          ],
        }
      )
    ).toEqual({
      'alice@example.com_bob@example.com': [
        {
          sender: 'alice@example.com',
          text: 'On my way',
          timestamp: '2026-03-26T14:00:00.000Z',
          readBy: ['alice@example.com', 'bob@example.com'],
        },
      ],
    });
  });

  it('merges edited messages by id without duplicating the original text', () => {
    expect(
      mergeMessageMaps(
        {
          'alice@example.com_bob@example.com': [
            {
              id: 'msg-1',
              sender: 'alice@example.com',
              text: 'Original text',
              timestamp: '2026-03-26T14:00:00.000Z',
              readBy: ['alice@example.com'],
            },
          ],
        },
        {
          'alice@example.com_bob@example.com': [
            {
              id: 'msg-1',
              sender: 'alice@example.com',
              text: 'Edited text',
              timestamp: '2026-03-26T14:00:00.000Z',
              readBy: ['bob@example.com'],
              editedAt: '2026-03-26T14:05:00.000Z',
            },
          ],
        }
      )
    ).toEqual({
      'alice@example.com_bob@example.com': [
        {
          id: 'msg-1',
          sender: 'alice@example.com',
          text: 'Edited text',
          timestamp: '2026-03-26T14:00:00.000Z',
          readBy: ['alice@example.com', 'bob@example.com'],
          editedAt: '2026-03-26T14:05:00.000Z',
        },
      ],
    });
  });

  it('replaces a message by entity id for optimistic edits', () => {
    expect(
      replaceConversationMessage(
        {
          'alice@example.com_bob@example.com': [
            {
              id: 'msg-1',
              sender: 'alice@example.com',
              text: 'Original text',
              timestamp: '2026-03-26T14:00:00.000Z',
              readBy: ['alice@example.com'],
            },
          ],
        },
        'alice@example.com_bob@example.com',
        'msg-1',
        {
          id: 'msg-1',
          sender: 'alice@example.com',
          text: 'Edited text',
          timestamp: '2026-03-26T14:00:00.000Z',
          readBy: ['alice@example.com'],
          editedAt: '2026-03-26T14:05:00.000Z',
        }
      )
    ).toEqual({
      'alice@example.com_bob@example.com': [
        {
          id: 'msg-1',
          sender: 'alice@example.com',
          text: 'Edited text',
          timestamp: '2026-03-26T14:00:00.000Z',
          readBy: ['alice@example.com'],
          editedAt: '2026-03-26T14:05:00.000Z',
        },
      ],
    });
  });

  it('replaces a refreshed legacy message by timeline after edit text changes', () => {
    expect(
      replaceConversationMessage(
        {
          'alice@example.com_bob@example.com': [
            {
              sender: 'alice@example.com',
              text: 'Original text',
              timestamp: '2026-03-26T14:00:00.000Z',
              readBy: ['alice@example.com'],
            },
          ],
        },
        'alice@example.com_bob@example.com',
        'alice@example.com:2026-03-26T14:00:00.000Z:Edited text',
        {
          id: 'msg-1',
          sender: 'alice@example.com',
          text: 'Edited text',
          timestamp: '2026-03-26T14:00:00.000Z',
          readBy: ['alice@example.com'],
          editedAt: '2026-03-26T14:05:00.000Z',
        }
      )
    ).toEqual({
      'alice@example.com_bob@example.com': [
        {
          id: 'msg-1',
          sender: 'alice@example.com',
          text: 'Edited text',
          timestamp: '2026-03-26T14:00:00.000Z',
          readBy: ['alice@example.com'],
          editedAt: '2026-03-26T14:05:00.000Z',
        },
      ],
    });
  });

  it('merges group chats by id and preserves optimistic messages', () => {
    expect(
      mergeGroupChatLists(
        [
          {
            id: 'chat-1',
            name: 'Core Team',
            members: ['alice@example.com', 'bob@example.com'],
            messages: [
              {
                sender: 'alice@example.com',
                text: 'Draft is ready',
                timestamp: '2026-03-26T15:00:00.000Z',
                readBy: ['alice@example.com'],
              },
            ],
          },
        ],
        [
          {
            id: 'chat-1',
            name: 'Core Team',
            members: ['alice@example.com', 'bob@example.com', 'carol@example.com'],
            messages: [],
          },
        ]
      )
    ).toEqual([
      {
        id: 'chat-1',
        name: 'Core Team',
        members: ['alice@example.com', 'bob@example.com', 'carol@example.com'],
        messages: [
          {
            sender: 'alice@example.com',
            text: 'Draft is ready',
            timestamp: '2026-03-26T15:00:00.000Z',
            readBy: ['alice@example.com'],
          },
        ],
      },
    ]);
  });

  it('derives a stable fallback entity id when a message has no explicit id', () => {
    expect(
      getMessageEntityId({
        sender: ' Alice@example.com ',
        text: '  Hello ',
        timestamp: '2026-03-26T16:00:00.000Z',
        readBy: [],
      })
    ).toBe('alice@example.com:2026-03-26T16:00:00.000Z:Hello');
  });

  it('removes selected direct messages by entity id', () => {
    expect(
      removeConversationMessages(
        {
          'alice@example.com_bob@example.com': [
            {
              id: 'msg-1',
              sender: 'alice@example.com',
              text: 'First',
              timestamp: '2026-03-26T17:00:00.000Z',
              readBy: ['alice@example.com'],
            },
            {
              sender: 'bob@example.com',
              text: 'Second',
              timestamp: '2026-03-26T17:01:00.000Z',
              readBy: ['bob@example.com'],
            },
          ],
        },
        'Alice@example.com_Bob@example.com',
        ['msg-1', 'bob@example.com:2026-03-26T17:01:00.000Z:Second']
      )
    ).toEqual({});
  });

  it('clears a direct-message conversation entirely', () => {
    expect(
      clearConversationMessages(
        {
          'alice@example.com_bob@example.com': [
            {
              id: 'msg-1',
              sender: 'alice@example.com',
              text: 'First',
              timestamp: '2026-03-26T17:00:00.000Z',
              readBy: ['alice@example.com'],
            },
          ],
          'alice@example.com_carol@example.com': [],
        },
        'alice@example.com_bob@example.com'
      )
    ).toEqual({
      'alice@example.com_carol@example.com': [],
    });
  });

  it('removes selected group-chat messages by entity id', () => {
    expect(
      removeGroupChatMessages(
        [
          {
            id: 'chat-1',
            name: 'Core Team',
            members: ['alice@example.com', 'bob@example.com'],
            messages: [
              {
                id: 'msg-1',
                sender: 'alice@example.com',
                text: 'Draft is ready',
                timestamp: '2026-03-26T18:00:00.000Z',
                readBy: ['alice@example.com'],
              },
              {
                id: 'msg-2',
                sender: 'bob@example.com',
                text: 'Looks good',
                timestamp: '2026-03-26T18:01:00.000Z',
                readBy: ['bob@example.com'],
              },
            ],
          },
        ],
        'chat-1',
        ['msg-2']
      )
    ).toEqual([
      {
        id: 'chat-1',
        name: 'Core Team',
        members: ['alice@example.com', 'bob@example.com'],
        messages: [
          {
            id: 'msg-1',
            sender: 'alice@example.com',
            text: 'Draft is ready',
            timestamp: '2026-03-26T18:00:00.000Z',
            readBy: ['alice@example.com'],
          },
        ],
      },
    ]);
  });
});
