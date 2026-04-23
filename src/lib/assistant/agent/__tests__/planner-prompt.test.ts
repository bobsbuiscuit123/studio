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
      'create_event: draft or plan creating an in-app event'
    );
    expect(ASSISTANT_ACTION_CAPABILITY_GUIDANCE).toContain(
      'create_message: draft or plan sending an in-app direct or group message'
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
      'Do not force unsupported requests into create_announcement, create_event, or create_message'
    );
    expect(prompt).toContain(
      'If the user asks for an unsupported asset or deliverable, set intent to conversational, omit action'
    );
  });
});
