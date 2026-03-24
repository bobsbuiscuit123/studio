export type UserTokenWallet = {
  tokenBalance: number;
  hasUsedTrial: boolean;
};

export type OrgTokenEstimate = {
  memberCap: number;
  dailyAiLimitPerUser: number;
  estimatedMonthlyTokens: number;
  estimatedDailyTokens: number;
  trialTokens: number;
  daysCovered: number;
};

export type TokenHealth = 'healthy' | 'low' | 'urgent' | 'depleted';
export type AiAvailability = 'available' | 'limited' | 'paused';

export type TokenPackage = {
  productId: string;
  tokens: number;
  priceLabel: string;
  displayName: string;
  displayLabel: string;
};

export const normalizeTokenProductId = (productId?: string | null) => {
  if (!productId) return '';
  return productId.trim().toLowerCase().replace('com.caspo.', '').replace(/\./g, '_');
};

export const TOKEN_VALUE_ANCHOR = 0.0011;
export const TRIAL_TOKENS = 2500;

export const TOKEN_PACKAGES: TokenPackage[] = [
  {
    productId: 'tokens_basic',
    tokens: 2200,
    priceLabel: '$2.99',
    displayName: 'Basic',
    displayLabel: '2,200 tokens',
  },
  {
    productId: 'tokens_growth',
    tokens: 6000,
    priceLabel: '$6.99',
    displayName: 'Growth',
    displayLabel: '6,000 tokens',
  },
  {
    productId: 'tokens_pro',
    tokens: 12500,
    priceLabel: '$12.99',
    displayName: 'Pro',
    displayLabel: '12,500 tokens',
  },
  {
    productId: 'tokens_scale',
    tokens: 28000,
    priceLabel: '$24.99',
    displayName: 'Scale',
    displayLabel: '28,000 tokens',
  },
  {
    productId: 'tokens_enterprise',
    tokens: 65000,
    priceLabel: '$49.99',
    displayName: 'Enterprise',
    displayLabel: '65,000 tokens',
  },
];

export const calculateMonthlyTokenEstimate = (memberCap: number, dailyAiLimitPerUser: number) =>
  Math.max(0, memberCap) * Math.max(0, dailyAiLimitPerUser) * 30;

export const calculateDailyTokenEstimate = (memberCap: number, dailyAiLimitPerUser: number) =>
  Math.max(0, memberCap) * Math.max(0, dailyAiLimitPerUser);

export const calculateTrialDaysCovered = (
  memberCap: number,
  dailyAiLimitPerUser: number,
  trialTokens: number = TRIAL_TOKENS
) => {
  const dailyUsage = calculateDailyTokenEstimate(memberCap, dailyAiLimitPerUser);
  if (dailyUsage <= 0) return 0;
  return Math.floor(trialTokens / dailyUsage);
};

export const calculateEstimatedDaysRemaining = (
  tokenBalance: number,
  estimatedMonthlyTokens: number
) => {
  if (tokenBalance <= 0 || estimatedMonthlyTokens <= 0) return 0;
  return Math.floor(tokenBalance / Math.ceil(estimatedMonthlyTokens / 30));
};

export const getTokenHealth = (daysRemaining: number): TokenHealth => {
  if (daysRemaining <= 0) return 'depleted';
  if (daysRemaining <= 3) return 'urgent';
  if (daysRemaining <= 14) return 'low';
  return 'healthy';
};

export const getAiAvailability = (
  tokenBalance: number,
  estimatedMonthlyTokens: number
): AiAvailability => {
  if (tokenBalance <= 0) return 'paused';
  const daysRemaining = calculateEstimatedDaysRemaining(tokenBalance, estimatedMonthlyTokens);
  if (daysRemaining <= 3) return 'limited';
  return 'available';
};

export const calculateTokenUsageEstimate = (
  memberCap: number,
  dailyAiLimitPerUser: number,
  trialTokens: number = TRIAL_TOKENS
): OrgTokenEstimate => ({
  memberCap,
  dailyAiLimitPerUser,
  estimatedMonthlyTokens: calculateMonthlyTokenEstimate(memberCap, dailyAiLimitPerUser),
  estimatedDailyTokens: calculateDailyTokenEstimate(memberCap, dailyAiLimitPerUser),
  trialTokens,
  daysCovered: calculateTrialDaysCovered(memberCap, dailyAiLimitPerUser, trialTokens),
});
