import { err, ok, type AppError, type Result } from '@/lib/result';
import { getClientTimeZoneHeaderName } from '@/lib/day-key';
import { startPerformanceTimer } from '@/lib/performance-guard';

type RetryOptions = {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type FetchJsonOptions = RequestInit & {
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  idempotencyKey?: string;
  treatOfflineAsError?: boolean;
  requestId?: string;
};

const defaultRetry: RetryOptions = {
  retries: 0,
  baseDelayMs: 300,
  maxDelayMs: 2_000,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const backoffDelay = (attempt: number, retry: RetryOptions) => {
  const exp = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  const jitter = Math.random() * 100;
  return exp + jitter;
};

const isBrowser = () => typeof window !== 'undefined';

const getBrowserTimeZone = () => {
  if (!isBrowser()) return null;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
};

const getRequestPathLabel = (url: string) => {
  try {
    return new URL(url, 'https://caspo.local').pathname;
  } catch {
    return url;
  }
};

const mergeAbortSignals = (signals: Array<AbortSignal | null | undefined>) => {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  activeSignals.forEach(signal => {
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });

  return {
    signal: controller.signal,
    cleanup: () => {
      activeSignals.forEach(signal => {
        signal.removeEventListener('abort', abort);
      });
    },
  };
};

const normalizeFetchError = (error: unknown): AppError => {
  const message =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: string }).name)
      : '';
  if (message === 'AbortError') {
    return {
      code: 'NETWORK_TIMEOUT',
      message: 'Request timed out. Please try again.',
      retryable: true,
      source: 'network',
    };
  }
  return {
    code: 'NETWORK_HTTP_ERROR',
    message: 'Network request failed. Please try again.',
    retryable: true,
    source: 'network',
  };
};

export async function safeFetchJson<T>(
  url: string,
  options: FetchJsonOptions = {}
): Promise<Result<T>> {
  const method = (options.method || 'GET').toUpperCase();
  const retry: RetryOptions = { ...defaultRetry, ...options.retry };
  const shouldRetry =
    retry.retries > 0 && (method === 'GET' || Boolean(options.idempotencyKey));

  if (options.treatOfflineAsError !== false && isBrowser() && !navigator.onLine) {
    return err({
      code: 'NETWORK_OFFLINE',
      message: 'You appear to be offline. Please reconnect and try again.',
      retryable: true,
      source: 'network',
    });
  }

  for (let attempt = 0; attempt <= retry.retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : 12_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const mergedSignal = mergeAbortSignals([controller.signal, options.signal]);
    const performanceTimer = startPerformanceTimer('fetch json', 1_500, {
      method,
      path: getRequestPathLabel(url),
      attempt: attempt + 1,
    });
    let status: number | 'error' = 'error';
    try {
      const headers = new Headers(options.headers || {});
      const timeZone = getBrowserTimeZone();
      if (timeZone) {
        headers.set(getClientTimeZoneHeaderName(), timeZone);
      }
      if (options.idempotencyKey && method !== 'GET') {
        headers.set('X-Idempotency-Key', options.idempotencyKey);
      }
      if (options.requestId) {
        headers.set('X-Request-Id', options.requestId);
      }
      const response = await fetch(url, {
        ...options,
        headers,
        signal: mergedSignal.signal,
      });
      status = response.status;
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        let message = response.status >= 500
          ? 'Server error. Please try again.'
          : 'Request failed. Please try again.';
        try {
          const parsed = JSON.parse(bodyText) as {
            error?: { message?: string } | string;
            message?: string;
          };
          if (typeof parsed?.error === 'string' && parsed.error) {
            message = parsed.error;
          } else if (parsed?.error && typeof parsed.error === 'object' && parsed.error.message) {
            message = parsed.error.message;
          } else if (parsed?.message) {
            message = parsed.message;
          }
        } catch {
          // ignore JSON parse errors
        }
        return err({
          code: 'NETWORK_HTTP_ERROR',
          message,
          retryable: response.status >= 500,
          detail: bodyText.slice(0, 400),
          source: 'network',
        });
      }
      try {
        const json = (await response.json()) as T;
        return ok(json);
      } catch (parseError) {
        return err({
          code: 'NETWORK_PARSE_ERROR',
          message: 'Invalid server response. Please try again.',
          retryable: true,
          detail: String(parseError),
          source: 'network',
        });
      }
    } catch (error) {
      const normalized = normalizeFetchError(error);
      if (!shouldRetry || attempt >= retry.retries) {
        return err(normalized);
      }
      await sleep(backoffDelay(attempt, retry));
    } finally {
      performanceTimer.stop({ status });
      clearTimeout(timeout);
      mergedSignal.cleanup();
    }
  }

  return err({
    code: 'NETWORK_HTTP_ERROR',
    message: 'Request failed. Please try again.',
    retryable: true,
    source: 'network',
  });
}
