export type CreditUsageEstimate = {
  maxUsers: number;
  dailyAiLimitPerUser: number;
  estimatedMonthlyCredits: number;
  estimatedDailyCredits: number;
};

export const CREDIT_VALUE_ANCHOR = 0.01;
const AI_REQUEST_COST = 0.00026;
const RETAIL_MULTIPLIER = 1.2;
const BASE_CREDIT_COST_PER_REQUEST = 0.03;
const MIN_CREDIT_COST_PER_REQUEST = 0.03;
const MAX_CREDIT_COST_PER_REQUEST = 0.12;

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const calculateMonthlyRetailAnchor = (maxUsers: number, dailyAiLimitPerUser: number) =>
  maxUsers * (dailyAiLimitPerUser + 2) * 30 * AI_REQUEST_COST * RETAIL_MULTIPLIER;

export const calculateEstimatedMonthlyCredits = (maxUsers: number, dailyAiLimitPerUser: number) =>
  Math.ceil(calculateMonthlyRetailAnchor(maxUsers, dailyAiLimitPerUser) / CREDIT_VALUE_ANCHOR);

export const calculateEstimatedDailyCredits = (maxUsers: number, dailyAiLimitPerUser: number) =>
  Math.ceil(calculateEstimatedMonthlyCredits(maxUsers, dailyAiLimitPerUser) / 30);

export const calculateCreditCostPerRequest = (maxUsers: number) =>
  roundTo(
    clamp(
      BASE_CREDIT_COST_PER_REQUEST * (1 + maxUsers / 500),
      MIN_CREDIT_COST_PER_REQUEST,
      MAX_CREDIT_COST_PER_REQUEST
    ),
    3
  );

export const calculateEstimatedDaysRemaining = (
  balance: number,
  estimatedMonthlyCredits: number
) => {
  if (balance <= 0 || estimatedMonthlyCredits <= 0) return 0;
  return Math.floor(balance / Math.ceil(estimatedMonthlyCredits / 30));
};

export const getCreditHealth = (daysRemaining: number): 'healthy' | 'low' | 'urgent' | 'depleted' => {
  if (daysRemaining <= 0) return 'depleted';
  if (daysRemaining <= 3) return 'urgent';
  if (daysRemaining <= 14) return 'low';
  return 'healthy';
};

export const getAiAvailability = (
  balance: number,
  estimatedMonthlyCredits: number
): 'available' | 'limited' | 'paused' => {
  if (balance <= 0) return 'paused';
  const daysRemaining = calculateEstimatedDaysRemaining(balance, estimatedMonthlyCredits);
  if (daysRemaining <= 3) return 'limited';
  return 'available';
};

export const calculateCreditUsageEstimate = (
  maxUsers: number,
  dailyAiLimitPerUser: number
): CreditUsageEstimate => {
  const estimatedMonthlyCredits = calculateEstimatedMonthlyCredits(maxUsers, dailyAiLimitPerUser);
  return {
    maxUsers,
    dailyAiLimitPerUser,
    estimatedMonthlyCredits,
    estimatedDailyCredits: Math.ceil(estimatedMonthlyCredits / 30),
  };
};
