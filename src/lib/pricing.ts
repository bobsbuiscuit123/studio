export type PricingBreakdown = {
  maxUserLimit: number;
  dailyCreditPerUser: number;
  staticCost: number;
  variableCost: number;
  multiplier: number;
  retailPrice: number;
  retailCents: number;
};

const AI_REQUEST_COST = 0.00026;

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const computeOrgPricing = (
  maxUserLimit: number,
  dailyCreditPerUser: number
): PricingBreakdown => {
  const multiplier = 1.2;
  const staticCost = 0;
  const variableCost = maxUserLimit * (dailyCreditPerUser + 2) * 30 * AI_REQUEST_COST;
  const rawRetail = variableCost * multiplier;
  const retailPrice = roundTo(rawRetail, 2);
  const retailCents = Math.round(rawRetail * 100);
  return {
    maxUserLimit,
    dailyCreditPerUser,
    staticCost,
    variableCost,
    multiplier,
    retailPrice,
    retailCents,
  };
};
