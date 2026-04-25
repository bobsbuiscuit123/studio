import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_ACTION_CAPABILITY_GUIDANCE,
  buildAssistantPlannerPrompt,
} from '@/lib/assistant/agent/planner-prompt';

describe('assistant planner prompt', () => {
  it('describes the supported in-app action types in detail', () => {
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'create_announcement: draft or plan posting an in-app announcement'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'Announcements are always group-wide and go to everyone.'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'create_event: draft or plan creating an in-app event'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'create_message: draft or plan sending an in-app direct or group message'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'update_message: draft or plan edits to the active in-app message draft'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'create_email: draft or plan filling the email tab composer'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'update_email: draft or plan edits to the active email draft'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'Prefer create_email over create_message when the user explicitly asks for an email'
    );
  });

  it('routes unsupported asset requests to conversational with no action', () => {
    const prompt = buildAssistantPlannerPrompt({
      message: 'make a flyer for our newest garba event',
      history: [{ role: 'user', content: 'Keep it colorful.' }],
      role: 'Admin',
    });

    expect(prompt).toContain('Unsupported or miscellaneous capability requests must stay conversational with no action.');
    expect(prompt).toContain('making a flyer, poster, graphic, image, logo, slide deck');
    expect(prompt).toContain(
      'Do not force unsupported requests into create_announcement, create_event, create_message, create_email, update_message, or update_email'
    );
    expect(prompt).toContain(
      'If the user asks for an unsupported asset or deliverable, set intent to conversational, omit action'
    );
  });

  it('tells the planner to treat draft follow-ups as update actions without target ids', () => {
    const prompt = buildAssistantPlannerPrompt({
      message: 'make it shorter',
      history: [
        {
          role: 'assistant',
          content:
            'assistant_state: draft_preview\nassistant_reply: Here is a draft announcement.\ndraft_payload: {"kind":"announcement","title":"Dues Reminder","body":"Please pay your dues this week."}',
        },
      ],
      role: 'Admin',
      activeDraft: {
        pendingActionId: '182ef2d1-3f77-4b24-88b8-75be9fbd9c50',
        actionType: 'create_announcement',
        currentPayload: {
          kind: 'announcement',
          title: 'Dues Reminder',
          body: 'Please pay your dues this week.',
        },
      },
      announcementTargets: [
        { id: '12', title: 'Board Elections' },
        { id: '18', title: 'Dues Reminder' },
      ],
    });

    expect(prompt).toContain(
      'classify it as update_announcement'
    );
    expect(prompt).toContain(
      'do not require action.fieldsProvided.targetRef. The active draft context is the edit target.'
    );
    expect(prompt).toContain('active_draft_context:');
    expect(prompt).toContain('available_announcement_targets:');
    expect(prompt).toContain('"id":"18"');
    expect(prompt).toContain('If current_message clearly refers to one existing announcement or event');
  });
});
