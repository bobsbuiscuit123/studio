import type { AgentActionType } from '@/lib/assistant/agent/types';

type AssistantActionFlag = {
  draftEnabled: boolean;
  executeEnabled: boolean;
};

const boolEnv = (value: string | undefined, fallback: boolean) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
};

export const ASSISTANT_ACTION_FLAGS: Record<AgentActionType, AssistantActionFlag> = {
  create_announcement: {
    draftEnabled: true,
    executeEnabled: boolEnv(process.env.ASSISTANT_EXECUTE_CREATE_ANNOUNCEMENT, true),
  },
  update_announcement: {
    draftEnabled: boolEnv(process.env.ASSISTANT_DRAFT_UPDATE_ANNOUNCEMENT, true),
    executeEnabled: boolEnv(process.env.ASSISTANT_EXECUTE_UPDATE_ANNOUNCEMENT, true),
  },
  create_event: {
    draftEnabled: boolEnv(process.env.ASSISTANT_DRAFT_CREATE_EVENT, true),
    executeEnabled: boolEnv(process.env.ASSISTANT_EXECUTE_CREATE_EVENT, true),
  },
  update_event: {
    draftEnabled: boolEnv(process.env.ASSISTANT_DRAFT_UPDATE_EVENT, true),
    executeEnabled: boolEnv(process.env.ASSISTANT_EXECUTE_UPDATE_EVENT, true),
  },
  create_message: {
    draftEnabled: boolEnv(process.env.ASSISTANT_DRAFT_CREATE_MESSAGE, true),
    executeEnabled: boolEnv(process.env.ASSISTANT_EXECUTE_CREATE_MESSAGE, true),
  },
};

export const getAssistantActionFlag = (actionType: AgentActionType) =>
  ASSISTANT_ACTION_FLAGS[actionType];
