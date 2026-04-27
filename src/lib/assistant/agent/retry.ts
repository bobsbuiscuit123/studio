import { addBreadcrumb } from '@/lib/telemetry';

export const MAX_RETRIES = 2;
const STEP_RETRY_POLICY = {
  planner: {
    maxRetries: MAX_RETRIES,
    delaysMs: [800, 1800] as const,
  },
  draft: {
    maxRetries: MAX_RETRIES,
    delaysMs: [800, 1800] as const,
  },
  // Authoritative field generation: retry when Gemini returns unusable generated fields.
  field_validator: {
    maxRetries: MAX_RETRIES,
    delaysMs: [800, 1800] as const,
  },
} as const;

type LlmRetryStep = keyof typeof STEP_RETRY_POLICY;

const isTransientFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|network|fetch failed|5\d\d|provider error|temporarily unavailable|Gemini field validator did not return final generated fields/i.test(
    message
  );
};

export async function runLlmStepWithRetry<T>({
  step,
  fn,
}: {
  step: LlmRetryStep;
  fn: () => Promise<T>;
}): Promise<
  | { ok: true; value: T; retryCount: number; timeoutFlag: boolean }
  | { ok: false; retryCount: number; timeoutFlag: boolean; lastErrorMessage?: string }
> {
  const policy = STEP_RETRY_POLICY[step];
  let retryCount = 0;
  let timeoutFlag = false;
  let lastErrorMessage: string | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    try {
      const value = await fn();
      return { ok: true, value, retryCount, timeoutFlag };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      lastErrorMessage = message;
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

      if (attempt === policy.maxRetries || !isTransientFailure(error)) {
        return { ok: false, retryCount, timeoutFlag, lastErrorMessage };
      }

      retryCount += 1;
      const delayMs =
        policy.delaysMs[Math.min(attempt, policy.delaysMs.length - 1)] ?? 1800;
      await addBreadcrumb('assistant.llm_step_retry', {
        step,
        retryCount,
        delayMs,
      });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { ok: false, retryCount, timeoutFlag, lastErrorMessage };
}
