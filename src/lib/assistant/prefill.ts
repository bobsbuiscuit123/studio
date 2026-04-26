import { Capacitor } from '@capacitor/core';

export const ASSISTANT_PREFILL_QUERY_KEY = 'prefill';
export const ASSISTANT_PREFILL_STORAGE_KEY = 'assistantPrefill';
export const ASSISTANT_OPEN_EVENT = 'caspo:open-assistant';

type SearchParamGetter = {
  get: (key: string) => string | null;
};

export const buildAssistantPrefill = (contextText: string) => contextText.trim();

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
  const isDesktopWeb =
    window.matchMedia('(min-width: 768px)').matches && !Capacitor.isNativePlatform();

  if (isDesktopWeb) {
    window.dispatchEvent(
      new CustomEvent(ASSISTANT_OPEN_EVENT, {
        detail: { prefill },
      })
    );
    return;
  }

  const url = new URL(window.location.href);
  url.pathname = '/assistant';
  url.search = '';
  url.searchParams.set(ASSISTANT_PREFILL_QUERY_KEY, prefill);
  window.location.assign(url.toString());
};
