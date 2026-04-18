import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acquireAiSafetyPermit,
  resetAiSafetyStateForTests,
} from './ai-safety-guard';

describe('ai safety guard', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetAiSafetyStateForTests();
  });

  it('blocks once the process-wide window limit is reached', () => {
    vi.useFakeTimers();

    const config = {
      maxCallsPerWindow: 2,
      windowMs: 1_000,
      cooldownMs: 5_000,
      maxConcurrent: 3,
    };

    const first = acquireAiSafetyPermit(Date.now(), config);
    const second = acquireAiSafetyPermit(Date.now(), config);
    const third = acquireAiSafetyPermit(Date.now(), config);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.detail).toContain('Process-wide AI safety limit reached');
    }

    if (first.allowed) first.release();
    if (second.allowed) second.release();
  });

  it('blocks when concurrent requests exceed the cap', () => {
    const config = {
      maxCallsPerWindow: 10,
      windowMs: 60_000,
      cooldownMs: 5_000,
      maxConcurrent: 1,
    };

    const first = acquireAiSafetyPermit(Date.now(), config);
    const second = acquireAiSafetyPermit(Date.now(), config);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.detail).toContain('Too many concurrent AI requests');
    }

    if (first.allowed) first.release();
  });

  it('allows requests again after the window expires', () => {
    vi.useFakeTimers();

    const config = {
      maxCallsPerWindow: 1,
      windowMs: 1_000,
      cooldownMs: 500,
      maxConcurrent: 1,
    };

    const first = acquireAiSafetyPermit(Date.now(), config);
    expect(first.allowed).toBe(true);
    if (first.allowed) first.release();

    vi.advanceTimersByTime(1_001);
    const afterWindow = acquireAiSafetyPermit(Date.now(), config);
    expect(afterWindow.allowed).toBe(true);
    if (afterWindow.allowed) afterWindow.release();
  });
});
