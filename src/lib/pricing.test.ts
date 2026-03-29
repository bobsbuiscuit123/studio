import { describe, expect, it } from 'vitest';

import {
  FREE_PLAN_ID,
  calculateUsageEstimate,
  getEffectiveAvailableTokens,
  getPaidPlanByPackageId,
  getPaidPlanByProductId,
  getPlanById,
  getPlanRecommendation,
  planSupportsAi,
} from '@/lib/pricing';

describe('subscription pricing helpers', () => {
  it('maps paid products and package identifiers to the correct plans', () => {
    expect(getPaidPlanByProductId('starter_org')?.monthlyTokenLimit).toBe(2_200);
    expect(getPaidPlanByProductId('elite_org')?.monthlyTokenLimit).toBe(65_000);
    expect(getPaidPlanByPackageId('growth')?.id).toBe('growth_org');
    expect(getPaidPlanByPackageId('free')).toBeNull();
  });

  it('keeps free plan at zero recurring tokens', () => {
    expect(getPlanById(FREE_PLAN_ID)).toMatchObject({
      monthlyTokenLimit: 0,
      isFree: true,
    });
  });

  it('calculates usage estimates from the setup sliders', () => {
    expect(calculateUsageEstimate(25, 4)).toEqual({
      members: 25,
      requestsPerMemberPerDay: 4,
      estimatedDailyTokens: 100,
      estimatedMonthlyTokens: 3_000,
    });
  });

  it('calculates effective availability using monthly limit plus bonus tokens', () => {
    expect(
      getEffectiveAvailableTokens({
        monthlyTokenLimit: 0,
        bonusTokensThisPeriod: 0,
        tokensUsedThisPeriod: 0,
      })
    ).toBe(0);

    expect(
      getEffectiveAvailableTokens({
        monthlyTokenLimit: 0,
        bonusTokensThisPeriod: 0,
        tokensUsedThisPeriod: 10,
      })
    ).toBe(0);

    expect(
      getEffectiveAvailableTokens({
        monthlyTokenLimit: 2_200,
        bonusTokensThisPeriod: 0,
        tokensUsedThisPeriod: 200,
      })
    ).toBe(2_000);
  });

  it('derives AI availability from remaining effective tokens', () => {
    expect(
      planSupportsAi({
        monthlyTokenLimit: 0,
        bonusTokensThisPeriod: 0,
        tokensUsedThisPeriod: 0,
      })
    ).toBe(false);

    expect(
      planSupportsAi({
        monthlyTokenLimit: 0,
        bonusTokensThisPeriod: 0,
        tokensUsedThisPeriod: 0,
      })
    ).toBe(false);
  });

  it('recommends the smallest paid plan that covers the estimate', () => {
    expect(getPlanRecommendation(0).id).toBe('starter_org');
    expect(getPlanRecommendation(6_001).id).toBe('growth_org');
    expect(getPlanRecommendation(90_000).id).toBe('elite_org');
  });
});
