import { describe, expect, it } from 'vitest';

import {
  getActionRequiredRetrievalResources,
  resolveActionFields,
} from '@/lib/assistant/agent/action-fields';

describe('action field resolution', () => {
  it('requires members retrieval for create_message', () => {
    expect(getActionRequiredRetrievalResources('create_message')).toEqual(['members']);
  });

  it('resolves a unique event target from retrieved titles', () => {
    const fields = resolveActionFields({
      actionType: 'update_event',
      fieldsProvided: {},
      message: 'Update Spring Election Night to start at 7:00 PM',
      retrieval: {
        context: {
          events: [
            { id: 'evt-1', title: 'Spring Election Night' },
            { id: 'evt-2', title: 'Budget Review' },
          ],
        },
        usedEntities: ['events'],
      },
    });

    expect(fields.targetRef).toBe('evt-1');
  });

  it('does not accept a non-matching update target when retrieval data exists', () => {
    const fields = resolveActionFields({
      actionType: 'update_announcement',
      fieldsProvided: {
        targetRef: 'Something Else',
      },
      message: 'Update the volunteer announcement',
      retrieval: {
        context: {
          announcements: [{ id: '12', title: 'Volunteer Signup' }],
        },
        usedEntities: ['announcements'],
      },
    });

    expect(fields.targetRef).toBeUndefined();
  });

  it('resolves recipient names against retrieved members', () => {
    const fields = resolveActionFields({
      actionType: 'create_message',
      fieldsProvided: {
        recipients: ['Alice Smith', 'bob@example.com'],
      },
      message: 'Send Alice and Bob the budget note',
      retrieval: {
        context: {
          members: [
            { name: 'Alice Smith', email: 'alice@example.com' },
            { name: 'Bob Jones', email: 'bob@example.com' },
          ],
        },
        usedEntities: ['members'],
      },
    });

    expect(fields.recipients).toEqual([
      { email: 'alice@example.com', name: 'Alice Smith' },
      { email: 'bob@example.com' },
    ]);
  });
});
