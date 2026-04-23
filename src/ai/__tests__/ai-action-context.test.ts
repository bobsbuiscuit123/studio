import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ai-action-context pacing', () => {
  const originalMinInterval = process.env.AI_MIN_INTERVAL_MS;

  beforeEach(() => {
    process.env.AI_MIN_INTERVAL_MS = '25';
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalMinInterval === undefined) {
      delete process.env.AI_MIN_INTERVAL_MS;
    } else {
      process.env.AI_MIN_INTERVAL_MS = originalMinInterval;
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('paces back-to-back AI requests inside one action', async () => {
    const { recordAiActionRequest, runWithAiAction } = await import(
      '@/ai/ai-action-context'
    );

    const spacingMs = await runWithAiAction('pacing-test', async () => {
      await recordAiActionRequest('gemini', 'gemini-2.5-flash', true);
      const afterFirstRequest = Date.now();

      await recordAiActionRequest('gemini', 'gemini-2.5-flash', true);
      return Date.now() - afterFirstRequest;
    });

    expect(spacingMs).toBeGreaterThanOrEqual(20);
  }, 10_000);
});
