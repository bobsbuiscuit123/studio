import { describe, expect, it } from 'vitest';
import { computeOrgPricing } from '@/lib/pricing';

describe('computeOrgPricing', () => {
  it('computes pricing with rounding and cents', () => {
    const result = computeOrgPricing(25, 40);
    const staticCost = 0;
    const variableCost = 25 * (40 + 2) * 30 * 0.00026;
    const rawRetail = variableCost * 1.2;
    expect(result.staticCost).toBeCloseTo(staticCost, 6);
    expect(result.variableCost).toBeCloseTo(variableCost, 6);
    expect(result.retailPrice).toBe(Number(rawRetail.toFixed(2)));
    expect(result.retailCents).toBe(Math.round(rawRetail * 100));
  });
});
