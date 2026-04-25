export const ASSISTANT_EMAIL_DRAFT_STORAGE_KEY = 'assistantEmailDraft';
export const ASSISTANT_EMAIL_DRAFT_EVENT = 'caspo:assistant-email-draft';

export type AssistantEmailDraft = {
  subject: string;
  body: string;
};

type AssistantEmailDraftEventDetail = {
  draft: AssistantEmailDraft;
};

const normalizeAssistantEmailDraft = (value: unknown): AssistantEmailDraft | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const subject = typeof (value as { subject?: unknown }).subject === 'string'
    ? (value as { subject: string }).subject.trim()
    : '';
  const body = typeof (value as { body?: unknown }).body === 'string'
    ? (value as { body: string }).body.trim()
    : '';

  return subject && body ? { subject, body } : null;
};

export const readAssistantEmailDraft = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return normalizeAssistantEmailDraft(
      JSON.parse(sessionStorage.getItem(ASSISTANT_EMAIL_DRAFT_STORAGE_KEY) ?? 'null')
    );
  } catch {
    return null;
  }
};

export const clearAssistantEmailDraft = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    sessionStorage.removeItem(ASSISTANT_EMAIL_DRAFT_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
};

export const publishAssistantEmailDraft = (draft: AssistantEmailDraft) => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedDraft = normalizeAssistantEmailDraft(draft);
  if (!normalizedDraft) {
    return;
  }

  try {
    sessionStorage.setItem(
      ASSISTANT_EMAIL_DRAFT_STORAGE_KEY,
      JSON.stringify(normalizedDraft)
    );
  } catch {
    // ignore storage failures
  }

  window.dispatchEvent(
    new CustomEvent<AssistantEmailDraftEventDetail>(ASSISTANT_EMAIL_DRAFT_EVENT, {
      detail: { draft: normalizedDraft },
    })
  );
};
