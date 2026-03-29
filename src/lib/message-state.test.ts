import { describe, expect, it } from 'vitest';

import {
  markMessageReadByActor,
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
});
