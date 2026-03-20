export type AppErrorCode =
  | 'UNKNOWN'
  | 'ADMIN_REQUIRED'
  | 'AI_DISABLED'
  | 'AI_TIMEOUT'
  | 'AI_QUOTA'
  | 'DAILY_LIMIT_REACHED'
  | 'BILLING_INACTIVE'
  | 'AI_CREDITS_DEPLETED'
  | 'AI_BAD_RESPONSE'
  | 'AI_SCHEMA_INVALID'
  | 'AI_PROVIDER_ERROR'
  | 'NETWORK_OFFLINE'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_ABORTED'
  | 'NETWORK_HTTP_ERROR'
  | 'NETWORK_PARSE_ERROR'
  | 'VALIDATION'
  | 'ORG_FULL';

export type AppError = {
  code: AppErrorCode;
  message: string;
  retryable?: boolean;
  detail?: string;
  source?: 'ai' | 'network' | 'app';
};

export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <E extends AppError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

export const isResult = <T>(value: unknown): value is Result<T> =>
  Boolean(
    value &&
      typeof value === 'object' &&
      ('ok' in value ||
        ('error' in value &&
          typeof (value as { error?: { message?: string } }).error?.message ===
            'string'))
  );

export const normalizeErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'string') return error;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: string }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
};
