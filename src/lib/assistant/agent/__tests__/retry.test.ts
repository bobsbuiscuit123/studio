import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/telemetry', () => ({
  addBreadcrumb: vi.fn().mockResolvedValue(undefined),
}));

import { runLlmStepWithRetry } from '@/lib/assistant/agent/retry';

describe('runLlmStepWithRetry', () => {
  it('retries transient failures and succeeds', async () => {
    let attempts = 0;

    const result = await runLlmStepWithRetry({
      step: 'planner',
      fn: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('timeout from provider');
        }
        return { ok: true };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.retryCount).toBe(2);
    expect(result.timeoutFlag).toBe(true);
  }, 10_000);

  it('falls back after max retries', async () => {
    const result = await runLlmStepWithRetry({
      step: 'draft',
      fn: async () => {
        throw new Error('network timeout');
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected retry exhaustion.');
    }
    expect(result.retryCount).toBe(2);
    expect(result.timeoutFlag).toBe(true);
    expect(result.lastErrorMessage).toBe('network timeout');
  }, 10_000);

  it('retries unusable generated field failures from the field validator', async () => {
    let attempts = 0;

    const result = await runLlmStepWithRetry({
      step: 'field_validator',
      fn: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(
            'Gemini field validator did not return final generated fields (missing: title).'
          );
        }
        return { ok: true };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.retryCount).toBe(2);
    expect(result.timeoutFlag).toBe(false);
    expect(attempts).toBe(3);
  }, 10_000);
});
