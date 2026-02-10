export const ASSISTANT_PREFILL_QUERY_KEY = 'prefill';
export const ASSISTANT_PREFILL_STORAGE_KEY = 'assistantPrefill';

type SearchParamGetter = {
  get: (key: string) => string | null;
};

export const buildAssistantPrefill = (contextText: string) =>
  `Context: ${contextText}\nHelp me with recommended next steps. `;

export const getAssistantPrefill = (params?: SearchParamGetter | null) => {
  const fromQuery = params?.get(ASSISTANT_PREFILL_QUERY_KEY) ?? '';
  if (fromQuery.trim()) return fromQuery.trim();
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(ASSISTANT_PREFILL_STORAGE_KEY) ?? '';
    return stored.trim() ? stored.trim() : null;
  } catch {
    return null;
  }
};

export const clearAssistantPrefill = () => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(ASSISTANT_PREFILL_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
};

export const openAssistantWithContext = (contextText: string) => {
  if (typeof window === 'undefined') return;
  const prefill = buildAssistantPrefill(contextText);
  try {
    sessionStorage.setItem(ASSISTANT_PREFILL_STORAGE_KEY, prefill);
  } catch {
    // ignore storage failures
  }
  const url = new URL(window.location.href);
  url.pathname = '/assistant';
  url.search = '';
  url.searchParams.set(ASSISTANT_PREFILL_QUERY_KEY, prefill);
  window.location.assign(url.toString());
};
