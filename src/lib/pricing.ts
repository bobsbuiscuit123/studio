export const FREE_PLAN_ID = 'free' as const;
export const REVENUECAT_OFFERING_ID = 'default' as const;
export const REVENUECAT_ENTITLEMENT_ID = 'org_subscription' as const;
export const ONE_TIME_FREE_TRIAL_TOKENS = 30;

export const PAID_PRODUCT_IDS = [
  'starter_org',
  'basic_org',
  'growth_org',
  'pro_org',
  'elite_org',
] as const;

export type PaidPlanId = (typeof PAID_PRODUCT_IDS)[number];
export type PlanId = typeof FREE_PLAN_ID | PaidPlanId;

export type SubscriptionPlan = {
  id: PlanId;
  name: string;
  description: string;
  priceLabel: string;
  monthlyTokenLimit: number;
  packageId: string | null;
  isFree: boolean;
  highlightedMessage?: string;
};

export type PaidSubscriptionPlan = SubscriptionPlan & {
  id: PaidPlanId;
  packageId: string;
  isFree: false;
};

export type UsageEstimate = {
  members: number;
  requestsPerMemberPerDay: number;
  estimatedDailyTokens: number;
  estimatedMonthlyTokens: number;
};

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: FREE_PLAN_ID,
    name: 'Free',
    description: 'Includes a one-time 30 token trial for your first organization.',
    priceLabel: '$0/month',
    monthlyTokenLimit: 0,
    packageId: null,
    isFree: true,
    highlightedMessage: 'No AI usage available on free plan after the first period.',
  },
  {
    id: 'starter_org',
    name: 'Starter',
    description: 'Monthly subscription for small organizations.',
    priceLabel: '$2.99/month',
    monthlyTokenLimit: 2_200,
    packageId: 'starter',
    isFree: false,
  },
  {
    id: 'basic_org',
    name: 'Basic',
    description: 'Monthly subscription for growing teams.',
    priceLabel: '$6.99/month',
    monthlyTokenLimit: 6_000,
    packageId: 'basic',
    isFree: false,
  },
  {
    id: 'growth_org',
    name: 'Growth',
    description: 'Monthly subscription for active organizations.',
    priceLabel: '$12.99/month',
    monthlyTokenLimit: 12_500,
    packageId: 'growth',
    isFree: false,
  },
  {
    id: 'pro_org',
    name: 'Pro',
    description: 'Monthly subscription for advanced organizations.',
    priceLabel: '$24.99/month',
    monthlyTokenLimit: 28_000,
    packageId: 'pro',
    isFree: false,
  },
  {
    id: 'elite_org',
    name: 'Elite',
    description: 'Monthly subscription for the largest organizations.',
    priceLabel: '$49.99/month',
    monthlyTokenLimit: 65_000,
    packageId: 'elite',
    isFree: false,
  },
];

const PLAN_BY_ID = new Map<PlanId, SubscriptionPlan>(
  SUBSCRIPTION_PLANS.map((plan) => [plan.id, plan])
);

const PLAN_BY_PACKAGE_ID = new Map<string, SubscriptionPlan>(
  SUBSCRIPTION_PLANS.filter((plan) => plan.packageId).map((plan) => [plan.packageId as string, plan])
);

export const normalizePlanId = (value?: string | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace('com.caspo.', '')
    .replace(/\./g, '_');

export const getPlanById = (planId?: string | null): SubscriptionPlan =>
  PLAN_BY_ID.get((normalizePlanId(planId) || FREE_PLAN_ID) as PlanId) ?? PLAN_BY_ID.get(FREE_PLAN_ID)!;

export const getPaidPlanByProductId = (productId?: string | null): PaidSubscriptionPlan | null => {
  const normalized = normalizePlanId(productId);
  if (!normalized || normalized === FREE_PLAN_ID) {
    return null;
  }
  const plan = PLAN_BY_ID.get(normalized as PlanId);
  return plan && !plan.isFree ? (plan as PaidSubscriptionPlan) : null;
};

export const getPaidPlanByPackageId = (packageId?: string | null): PaidSubscriptionPlan | null => {
  const normalized = normalizePlanId(packageId);
  return (PLAN_BY_PACKAGE_ID.get(normalized) as PaidSubscriptionPlan | undefined) ?? null;
};

export const calculateDailyUsageEstimate = (
  members: number,
  requestsPerMemberPerDay: number
): number => Math.max(0, Math.round(members)) * Math.max(0, Math.round(requestsPerMemberPerDay));

export const calculateMonthlyUsageEstimate = (
  members: number,
  requestsPerMemberPerDay: number
): number => calculateDailyUsageEstimate(members, requestsPerMemberPerDay) * 30;

export const calculateUsageEstimate = (
  members: number,
  requestsPerMemberPerDay: number
): UsageEstimate => ({
  members: Math.max(0, Math.round(members)),
  requestsPerMemberPerDay: Math.max(0, Math.round(requestsPerMemberPerDay)),
  estimatedDailyTokens: calculateDailyUsageEstimate(members, requestsPerMemberPerDay),
  estimatedMonthlyTokens: calculateMonthlyUsageEstimate(members, requestsPerMemberPerDay),
});

export const getEffectiveAvailableTokens = ({
  monthlyTokenLimit,
  bonusTokensThisPeriod,
  tokensUsedThisPeriod,
}: {
  monthlyTokenLimit: number;
  bonusTokensThisPeriod: number;
  tokensUsedThisPeriod: number;
}) =>
  Math.max(
    0,
    Math.max(0, monthlyTokenLimit) +
      Math.max(0, bonusTokensThisPeriod) -
      Math.max(0, tokensUsedThisPeriod)
  );

export const planSupportsAi = ({
  monthlyTokenLimit,
  bonusTokensThisPeriod,
  tokensUsedThisPeriod,
}: {
  monthlyTokenLimit: number;
  bonusTokensThisPeriod: number;
  tokensUsedThisPeriod: number;
}) =>
  getEffectiveAvailableTokens({
    monthlyTokenLimit,
    bonusTokensThisPeriod,
    tokensUsedThisPeriod,
  }) > 0;

export const getPlanRecommendation = (estimatedMonthlyTokens: number): SubscriptionPlan => {
  const positiveEstimate = Math.max(0, estimatedMonthlyTokens);
  const paidPlans = SUBSCRIPTION_PLANS.filter((plan) => !plan.isFree);
  return (
    paidPlans.find((plan) => plan.monthlyTokenLimit >= positiveEstimate) ??
    paidPlans[paidPlans.length - 1]
  );
};
