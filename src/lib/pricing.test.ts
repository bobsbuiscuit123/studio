import { describe, expect, it } from 'vitest';
import {
  TRIAL_TOKENS,
  calculateDailyTokenEstimate,
  calculateEstimatedDaysRemaining,
  calculateMonthlyTokenEstimate,
  calculateTokenUsageEstimate,
  calculateTrialDaysCovered,
} from '@/lib/pricing';

describe('token billing helpers', () => {
  it('calculates monthly and daily token estimates', () => {
    expect(calculateMonthlyTokenEstimate(200, 2)).toBe(12_000);
    expect(calculateDailyTokenEstimate(200, 2)).toBe(400);
  });

  it('calculates trial coverage in days', () => {
    expect(calculateTrialDaysCovered(200, 2)).toBe(Math.floor(TRIAL_TOKENS / 400));
    expect(calculateTrialDaysCovered(0, 2)).toBe(0);
    expect(calculateTrialDaysCovered(200, 0)).toBe(0);
  });

  it('builds a combined usage estimate', () => {
    expect(calculateTokenUsageEstimate(25, 4)).toEqual({
      memberCap: 25,
      dailyAiLimitPerUser: 4,
      estimatedMonthlyTokens: 3000,
      estimatedDailyTokens: 100,
      trialTokens: 2500,
      daysCovered: 25,
    });
  });

  it('estimates days remaining from balance and monthly usage', () => {
    expect(calculateEstimatedDaysRemaining(0, 3000)).toBe(0);
    expect(calculateEstimatedDaysRemaining(2500, 12_000)).toBe(6);
  });
});
