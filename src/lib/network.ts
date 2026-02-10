import { err, ok, type AppError, type Result } from '@/lib/result';

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
    try {
      const headers = new Headers(options.headers || {});
      if (options.idempotencyKey && method !== 'GET') {
        headers.set('X-Idempotency-Key', options.idempotencyKey);
      }
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        return err({
          code: 'NETWORK_HTTP_ERROR',
          message:
            response.status >= 500
              ? 'Server error. Please try again.'
              : 'Request failed. Please try again.',
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
      clearTimeout(timeout);
    }
  }

  return err({
    code: 'NETWORK_HTTP_ERROR',
    message: 'Request failed. Please try again.',
    retryable: true,
    source: 'network',
  });
}

