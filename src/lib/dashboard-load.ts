export const DASHBOARD_TIMEOUT_MS = 8_000;
export const DASHBOARD_SLOW_LOAD_MS = 3_000;
export const DASHBOARD_WATCHDOG_MS = 10_000;
export const DASHBOARD_RETRY_DELAYS_MS = [500, 1_000] as const;

export type DashboardAsyncStatus = 'loading' | 'retrying' | 'success' | 'empty' | 'error';

type DashboardLogDetails = Record<string, unknown>;

type RetryOptions = {
  retries?: number;
  delaysMs?: readonly number[];
  label?: string;
  logger?: ReturnType<typeof createDashboardLogger>;
  requestId?: string | null;
};

type TimeoutOptions = {
  label?: string;
  signal?: AbortSignal;
  onTimeout?: () => void;
};

const getErrorName = (error: unknown) =>
  error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return 'Unknown error';
};

export const isAbortError = (error: unknown) => getErrorName(error) === 'AbortError';

export const serializeDashboardError = (error: unknown) => ({
  name: getErrorName(error) || 'Error',
  message: getErrorMessage(error),
});

export const createDashboardRequestId = (prefix = 'dashboard') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createDashboardLogger = (scope = '[Dashboard]') => ({
  log(message: string, details?: DashboardLogDetails) {
    console.log(`${scope} ${message}`, details ?? {});
  },
  warn(message: string, details?: DashboardLogDetails) {
    console.warn(`${scope} ${message}`, details ?? {});
  },
  error(message: string, error?: unknown, details?: DashboardLogDetails) {
    console.error(`${scope} ${message}`, {
      ...(details ?? {}),
      error: error ? serializeDashboardError(error) : undefined,
    });
  },
});

export const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

const createAbortError = () => {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
};

const createTimeoutError = (label: string, ms: number) => {
  const error = new Error(`${label} timed out after ${ms}ms`);
  error.name = 'TimeoutError';
  return error;
};

export async function withTimeout<T>(
  promiseOrFactory: PromiseLike<T> | (() => PromiseLike<T>),
  ms: number = DASHBOARD_TIMEOUT_MS,
  options: TimeoutOptions = {}
) {
  const label = options.label ?? 'Operation';
  const runPromise =
    typeof promiseOrFactory === 'function'
      ? (promiseOrFactory as () => PromiseLike<T>)()
      : promiseOrFactory;

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      if (settled) return;
      cleanup();
      reject(createAbortError());
    };

    if (options.signal?.aborted) {
      reject(createAbortError());
      return;
    }

    if (options.signal) {
      options.signal.addEventListener('abort', handleAbort, { once: true });
    }

    timeoutId = setTimeout(() => {
      if (settled) return;
      options.onTimeout?.();
      cleanup();
      reject(createTimeoutError(label, ms));
    }, ms);

    runPromise.then(
      value => {
        if (settled) return;
        cleanup();
        resolve(value);
      },
      error => {
        if (settled) return;
        cleanup();
        reject(error);
      }
    );
  });
}

export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
) {
  const retries = options.retries ?? DASHBOARD_RETRY_DELAYS_MS.length;
  const delays = options.delaysMs ?? DASHBOARD_RETRY_DELAYS_MS;
  const logger = options.logger;
  const label = options.label ?? 'Operation';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (isAbortError(error) || attempt >= retries) {
        throw error;
      }
      const delayMs = delays[Math.min(attempt, delays.length - 1)] ?? delays[delays.length - 1] ?? 0;
      logger?.warn(`${label} retry scheduled`, {
        attempt: attempt + 1,
        delayMs,
        requestId: options.requestId ?? null,
        error: serializeDashboardError(error),
      });
      await sleep(delayMs);
    }
  }

  throw new Error(`${label} failed`);
}
