export type TelemetryContext = Record<string, unknown>;

type SentryModule = typeof import('@sentry/nextjs');

let sentryPromise: Promise<SentryModule | null> | null = null;

const loadSentry = async () => {
  if (sentryPromise) return sentryPromise;
  sentryPromise = import('@sentry/nextjs')
    .then(mod => mod)
    .catch(() => null);
  return sentryPromise;
};

export async function captureException(
  error: unknown,
  context?: TelemetryContext
) {
  try {
    const Sentry = await loadSentry();
    if (!Sentry) {
      console.error('Telemetry unavailable', error);
      return;
    }
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    console.error('Telemetry capture failed', error);
  }
}

export async function addBreadcrumb(message: string, data?: TelemetryContext) {
  try {
    const Sentry = await loadSentry();
    if (!Sentry) return;
    Sentry.addBreadcrumb({ message, data });
  } catch {
    // Ignore breadcrumb failures.
  }
}

export async function withSpan<T>(
  name: string,
  op: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const Sentry = await loadSentry();
    const startSpan = Sentry?.startSpan as
      | (<R>(
          config: { name: string; op?: string },
          callback: () => Promise<R>
        ) => Promise<R>)
      | undefined;
    if (startSpan) {
      return await startSpan({ name, op }, fn);
    }
  } catch {
    // Ignore tracing failures.
  }
  return fn();
}

