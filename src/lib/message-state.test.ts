import { describe, expect, it } from 'vitest';

import {
  markMessageReadByActor,
  mergeGroupChatLists,
  mergeMessageMaps,
  normalizeGroupChats,
  normalizeMessageMap,
} from '@/lib/message-state';

describe('message state normalization', () => {
  it('normalizes legacy direct-message payloads', () => {
    expect(
      normalizeMessageMap({
        ' Alice@example.com_Bob@example.com ': [
          {
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
});
