import { describe, expect, it } from 'vitest';
import { readBalance } from '@/lib/org-balance';

describe('org balance resolution', () => {
  it('prefers token_balance when it is positive', () => {
    expect(readBalance({ token_balance: 2200, credit_balance: 9000 })).toMatchObject({
      balance: 2200,
      source: 'token',
      tokenBalance: 2200,
      creditBalance: 9000,
    });
  });

  it('falls back to legacy credit_balance when token_balance is zero', () => {
    expect(readBalance({ token_balance: 0, credit_balance: 1200 })).toMatchObject({
      balance: 1200,
      source: 'credit',
      tokenBalance: 0,
      creditBalance: 1200,
    });
  });

  it('reports zero when both balances are empty', () => {
    expect(readBalance({ token_balance: 0, credit_balance: 0 })).toMatchObject({
      balance: 0,
      source: 'token',
      tokenBalance: 0,
      creditBalance: 0,
    });
  });
});
