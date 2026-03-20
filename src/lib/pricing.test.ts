import { describe, expect, it } from 'vitest';
import {
  calculateCreditCostPerRequest,
  calculateEstimatedDailyCredits,
  calculateEstimatedDaysRemaining,
  calculateEstimatedMonthlyCredits,
} from '@/lib/pricing';

describe('pricing helpers', () => {
  it('calculates estimated monthly and daily credits from the old retail anchor', () => {
    const monthlyRetail = 25 * (40 + 2) * 30 * 0.00026 * 1.2;
    expect(calculateEstimatedMonthlyCredits(25, 40)).toBe(Math.ceil(monthlyRetail / 0.01));
    expect(calculateEstimatedDailyCredits(25, 40)).toBe(
      Math.ceil(Math.ceil(monthlyRetail / 0.01) / 30)
    );
  });

  it('scales per-request burn and clamps it', () => {
    expect(calculateCreditCostPerRequest(25)).toBe(0.032);
    expect(calculateCreditCostPerRequest(100)).toBe(0.036);
    expect(calculateCreditCostPerRequest(500)).toBe(0.06);
    expect(calculateCreditCostPerRequest(10_000)).toBe(0.12);
  });

  it('estimates days remaining from balance and monthly usage', () => {
    expect(calculateEstimatedDaysRemaining(0, 300)).toBe(0);
    expect(calculateEstimatedDaysRemaining(150, 300)).toBe(15);
  });
});
