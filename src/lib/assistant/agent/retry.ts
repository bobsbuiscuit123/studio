import { addBreadcrumb } from '@/lib/telemetry';

export const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [300, 800] as const;

const isTransientFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|network|fetch failed|5\d\d|provider error|temporarily unavailable/i.test(message);
};

export async function runLlmStepWithRetry<T>({
  step,
  fn,
}: {
  step: 'planner' | 'draft';
  fn: () => Promise<T>;
}): Promise<{ ok: true; value: T; retryCount: number; timeoutFlag: boolean } | { ok: false; retryCount: number; timeoutFlag: boolean }> {
  let retryCount = 0;
  let timeoutFlag = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const value = await fn();
      return { ok: true, value, retryCount, timeoutFlag };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (/timeout/i.test(message)) {
        timeoutFlag = true;
      }

      await addBreadcrumb('assistant.llm_step_failure', {
        step,
        attempt,
        retryCount,
        timeoutFlag,
        message,
      });

      if (attempt === MAX_RETRIES || !isTransientFailure(error)) {
        return { ok: false, retryCount, timeoutFlag };
      }

      retryCount += 1;
      const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 800;
      await addBreadcrumb('assistant.llm_step_retry', {
        step,
        retryCount,
        delayMs,
      });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { ok: false, retryCount, timeoutFlag };
}
