export type PerformanceGuardContext = Record<string, unknown>;

const isPerformanceGuardEnabled = process.env.NODE_ENV !== 'production';

export const warnForSlowPath = (
  name: string,
  durationMs: number,
  thresholdMs: number,
  context: PerformanceGuardContext = {}
) => {
  if (!isPerformanceGuardEnabled || durationMs < thresholdMs) {
    return false;
  }

  console.warn(`[perf] Slow ${name}`, {
    durationMs,
    thresholdMs,
    ...context,
  });
  return true;
};

export const startPerformanceTimer = (
  name: string,
  thresholdMs: number,
  context: PerformanceGuardContext = {}
) => {
  const startedAt = Date.now();

  return {
    stop(extraContext: PerformanceGuardContext = {}) {
      const durationMs = Date.now() - startedAt;
      warnForSlowPath(name, durationMs, thresholdMs, {
        ...context,
        ...extraContext,
      });
      return durationMs;
    },
  };
};
