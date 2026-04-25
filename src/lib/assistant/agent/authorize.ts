import type { AgentActionType, AgentContext } from '@/lib/assistant/agent/types';

type AuthorizationResult =
  | { ok: true }
  | { ok: false; message: string };

const unauthorizedMessage = 'You do not have permission to do that.';

export function authorizeAction(
  actionType: AgentActionType,
  context: AgentContext
): AuthorizationResult {
  switch (actionType) {
    case 'create_announcement':
      return context.permissions.canCreateAnnouncements
        ? { ok: true }
        : { ok: false, message: unauthorizedMessage };
    case 'update_announcement':
      return context.permissions.canUpdateAnnouncements
        ? { ok: true }
        : { ok: false, message: unauthorizedMessage };
    case 'create_event':
      return context.permissions.canCreateEvents
        ? { ok: true }
        : { ok: false, message: unauthorizedMessage };
    case 'update_event':
      return context.permissions.canUpdateEvents
        ? { ok: true }
        : { ok: false, message: unauthorizedMessage };
    case 'create_message':
      return context.permissions.canMessageMembers
        ? { ok: true }
        : { ok: false, message: unauthorizedMessage };
    case 'create_email':
      return context.permissions.canCreateEmails
        ? { ok: true }
        : { ok: false, message: unauthorizedMessage };
    default:
      return { ok: false, message: unauthorizedMessage };
  }
}
