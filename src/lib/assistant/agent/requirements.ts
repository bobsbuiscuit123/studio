import type { AgentActionType, DraftPreview } from '@/lib/assistant/agent/types';

type RequirementsEvaluation = {
  missingFields: string[];
  clarificationMessage: string | null;
};

const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const hasRecipients = (value: unknown) => Array.isArray(value) && value.length > 0;

const buildResult = (missingFields: string[], clarificationMessage: string | null): RequirementsEvaluation => ({
  missingFields,
  clarificationMessage,
});

export function evaluateRequiredFields(
  actionType: AgentActionType,
  fieldsProvided: Record<string, unknown>,
  preview?: DraftPreview | null
): RequirementsEvaluation {
  switch (actionType) {
    case 'create_announcement': {
      const title = preview?.kind === 'announcement' ? preview.title : fieldsProvided.title;
      const body = preview?.kind === 'announcement' ? preview.body : fieldsProvided.body;
      const missing = !hasText(title) && !hasText(body) ? ['title', 'body'] : [];
      return buildResult(missing, missing.length ? 'What should this announcement say?' : null);
    }
    case 'update_announcement': {
      const missing = !hasText(fieldsProvided.targetRef) ? ['targetRef'] : [];
      return buildResult(
        missing,
        missing.length ? 'Which announcement would you like me to update?' : null
      );
    }
    case 'create_event': {
      const date = preview?.kind === 'event' ? preview.date : fieldsProvided.date;
      const time = preview?.kind === 'event' ? preview.time : fieldsProvided.time;
      const missing = [!hasText(date) ? 'date' : null, !hasText(time) ? 'time' : null].filter(
        (value): value is string => Boolean(value)
      );
      return buildResult(
        missing,
        missing.length ? 'What date and time should this event be scheduled for?' : null
      );
    }
    case 'update_event': {
      const missing = !hasText(fieldsProvided.targetRef) ? ['targetRef'] : [];
      return buildResult(missing, missing.length ? 'Which event would you like me to update?' : null);
    }
    case 'create_message': {
      const recipients = preview?.kind === 'message' ? preview.recipients : fieldsProvided.recipients;
      const missing = !hasRecipients(recipients) ? ['recipients'] : [];
      return buildResult(missing, missing.length ? 'Who should receive this message?' : null);
    }
    default:
      return buildResult([], null);
  }
}
