import type { AgentActionType, DraftPreview } from '@/lib/assistant/agent/types';

type RequirementsEvaluation = {
  missingFields: string[];
  clarificationMessage: string | null;
};

const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const hasRecipients = (value: unknown) => Array.isArray(value) && value.length > 0;
const hasAnyText = (...values: unknown[]) => values.some(hasText);

const buildResult = (missingFields: string[], clarificationMessage: string | null): RequirementsEvaluation => ({
  missingFields,
  clarificationMessage,
});

const getAnnouncementFields = (fieldsProvided: Record<string, unknown>, preview?: DraftPreview | null) =>
  preview?.kind === 'announcement'
    ? { title: preview.title, body: preview.body }
    : { title: fieldsProvided.title, body: fieldsProvided.body };

const getEventFields = (fieldsProvided: Record<string, unknown>, preview?: DraftPreview | null) =>
  preview?.kind === 'event'
    ? {
        title: preview.title,
        description: preview.description,
        date: preview.date,
        time: preview.time,
        location: preview.location,
      }
    : {
        title: fieldsProvided.title,
        description: fieldsProvided.description,
        date: fieldsProvided.date,
        time: fieldsProvided.time,
        location: fieldsProvided.location,
      };

const getMessageFields = (fieldsProvided: Record<string, unknown>, preview?: DraftPreview | null) =>
  preview?.kind === 'message'
    ? { recipients: preview.recipients, body: preview.body }
    : { recipients: fieldsProvided.recipients, body: fieldsProvided.body };

const getEmailFields = (fieldsProvided: Record<string, unknown>, preview?: DraftPreview | null) =>
  preview?.kind === 'email'
    ? { subject: preview.subject, body: preview.body }
    : { subject: fieldsProvided.subject, body: fieldsProvided.body };

export function evaluateStructuralRequiredFields(
  actionType: AgentActionType,
  fieldsProvided: Record<string, unknown>
): RequirementsEvaluation {
  switch (actionType) {
    case 'update_announcement': {
      const missing = !hasText(fieldsProvided.targetRef) ? ['targetRef'] : [];
      return buildResult(
        missing,
        missing.length ? 'Missing announcement target.' : null
      );
    }
    case 'update_event': {
      const missing = !hasText(fieldsProvided.targetRef) ? ['targetRef'] : [];
      return buildResult(missing, missing.length ? 'Missing event target.' : null);
    }
    case 'create_message': {
      const missing = !hasRecipients(fieldsProvided.recipients) ? ['recipients'] : [];
      return buildResult(missing, missing.length ? 'Missing message recipients.' : null);
    }
    case 'update_message': {
      const missing = !hasRecipients(fieldsProvided.recipients) ? ['recipients'] : [];
      return buildResult(missing, missing.length ? 'Missing message recipients.' : null);
    }
    default:
      return buildResult([], null);
  }
}

export function evaluateRequiredFields(
  actionType: AgentActionType,
  fieldsProvided: Record<string, unknown>,
  preview?: DraftPreview | null
): RequirementsEvaluation {
  switch (actionType) {
    case 'create_announcement': {
      const { title, body } = getAnnouncementFields(fieldsProvided, preview);
      const missing = [!hasText(title) ? 'title' : null, !hasText(body) ? 'body' : null].filter(
        (value): value is string => Boolean(value)
      );
      if (missing.length === 0) {
        return buildResult([], null);
      }
      if (missing.length === 2) {
        return buildResult(missing, 'Missing announcement title and body.');
      }
      return buildResult(
        missing,
        missing[0] === 'title'
          ? 'Missing announcement title.'
          : 'Missing announcement body.'
      );
    }
    case 'update_announcement': {
      if (!hasText(fieldsProvided.targetRef)) {
        return buildResult(['targetRef'], 'Missing announcement target.');
      }
      const { title, body } = getAnnouncementFields(fieldsProvided, preview);
      const missing = !hasText(title) && !hasText(body) ? ['title', 'body'] : [];
      return buildResult(missing, missing.length ? 'Missing announcement update content.' : null);
    }
    case 'create_event': {
      const { date, time } = getEventFields(fieldsProvided, preview);
      const missing = [!hasText(date) ? 'date' : null, !hasText(time) ? 'time' : null].filter(
        (value): value is string => Boolean(value)
      );
      return buildResult(
        missing,
        missing.length ? 'Missing event date and time.' : null
      );
    }
    case 'update_event': {
      if (!hasText(fieldsProvided.targetRef)) {
        return buildResult(['targetRef'], 'Missing event target.');
      }
      const { title, description, date, time, location } = getEventFields(fieldsProvided, preview);
      const missing = !hasAnyText(title, description, date, time, location)
        ? ['title', 'description', 'date', 'time', 'location']
        : [];
      return buildResult(missing, missing.length ? 'Missing event update content.' : null);
    }
    case 'create_message': {
      const { recipients, body } = getMessageFields(fieldsProvided, preview);
      const missing = [
        !hasRecipients(recipients) ? 'recipients' : null,
        !hasText(body) ? 'body' : null,
      ].filter((value): value is string => Boolean(value));
      if (missing.length === 0) {
        return buildResult([], null);
      }
      if (missing.length === 2) {
        return buildResult(missing, 'Missing message recipients and body.');
      }
      return buildResult(missing, missing[0] === 'recipients'
        ? 'Missing message recipients.'
        : 'Missing message body.');
    }
    case 'update_message': {
      const { recipients, body } = getMessageFields(fieldsProvided, preview);
      const missing =
        !hasRecipients(recipients) && !hasText(body)
          ? ['recipients', 'body']
          : [];
      return buildResult(
        missing,
        missing.length ? 'Missing message update content.' : null
      );
    }
    case 'create_email': {
      const { subject, body } = getEmailFields(fieldsProvided, preview);
      const missing = [
        !hasText(subject) ? 'subject' : null,
        !hasText(body) ? 'body' : null,
      ].filter((value): value is string => Boolean(value));
      if (missing.length === 0) {
        return buildResult([], null);
      }
      if (missing.length === 2) {
        return buildResult(missing, 'Missing email subject and body.');
      }
      return buildResult(
        missing,
        missing[0] === 'subject'
          ? 'Missing email subject.'
          : 'Missing email body.'
      );
    }
    case 'update_email': {
      const { subject, body } = getEmailFields(fieldsProvided, preview);
      const missing = !hasAnyText(subject, body) ? ['subject', 'body'] : [];
      return buildResult(
        missing,
        missing.length ? 'Missing email update content.' : null
      );
    }
    default:
      return buildResult([], null);
  }
}
