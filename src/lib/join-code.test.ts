import { describe, expect, it } from 'vitest';

import { normalizeJoinCode } from '@/lib/join-code';

describe('join code normalization', () => {
  it('uppercases and strips separators', () => {
    expect(normalizeJoinCode(' ab-c 123 ')).toBe('ABC123');
  });

  it('removes unsupported characters', () => {
    expect(normalizeJoinCode('a!b@c#1$2%3')).toBe('ABC123');
  });
});
