import { describe, it, expect, vi } from 'vitest';
import { rateLimit } from './rate-limit';

describe('rateLimit', () => {
  it('blocks after limit within window and resets after window', () => {
    vi.useFakeTimers();
    const key = 'test-key';
    const limit = 2;
    const windowMs = 1000;

    const first = rateLimit(key, limit, windowMs);
    const second = rateLimit(key, limit, windowMs);
    const third = rateLimit(key, limit, windowMs);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);

    vi.advanceTimersByTime(windowMs + 1);
    const afterReset = rateLimit(key, limit, windowMs);
    expect(afterReset.allowed).toBe(true);

    vi.useRealTimers();
  });
});
