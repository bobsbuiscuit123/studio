import {
  FREE_PLAN_ID,
  type PaidPlanId,
  type PlanId,
  getEffectiveAvailableTokens,
  getPlanById,
} from '@/lib/pricing';

export type SubscriptionLifecycleStatus =
  | 'free'
  | 'purchase_pending'
  | 'active'
  | 'grace_period'
  | 'billing_retry'
  | 'unassigned'
  | 'expired'
  | 'cancelled';

export type OrgBillingMode =
  | 'free'
  | 'purchase'
  | 'keep_current_paid'
  | 'transfer_subscription';

export type OrgSubscriptionStatus = {
  orgId: string;
  orgName: string;
  role: string;
  joinCode?: string | null;
  activeUsers: number;
  createdAt: string | null;
  updatedAt: string | null;
  planId: PlanId;
  planName: string;
  subscriptionStatus: SubscriptionLifecycleStatus;
  subscriptionProductId: PaidPlanId | null;
  monthlyTokenLimit: number;
  bonusTokensThisPeriod: number;
  tokensUsedThisPeriod: number;
  effectiveAvailableTokens: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  aiAvailable: boolean;
  canManageBilling: boolean;
  isSubscribedOrg: boolean;
  ownerHasActiveSubscription: boolean;
  subscribedOrgId: string | null;
  usageEstimateMembers: number;
  usageEstimateRequestsPerMember: number;
  usageEstimateMonthlyTokens: number;
  managementUrl?: string | null;
};

export type UserSubscriptionSummary = {
  activeProductId: PaidPlanId | null;
  subscribedOrgId: string | null;
  subscriptionStatus: SubscriptionLifecycleStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  willRenew: boolean;
  hasReceivedOrgCreationBonus: boolean;
  bonusGrantedAt: string | null;
};

export const resolvePlanId = (productId?: string | null): PlanId => {
  const normalized = String(productId ?? '').trim().toLowerCase();
  return normalized ? (normalized as PaidPlanId) : FREE_PLAN_ID;
};

export const buildEffectiveAvailability = ({
  monthlyTokenLimit,
  bonusTokensThisPeriod,
  tokensUsedThisPeriod,
}: Pick<
  OrgSubscriptionStatus,
  'monthlyTokenLimit' | 'bonusTokensThisPeriod' | 'tokensUsedThisPeriod'
>) =>
  getEffectiveAvailableTokens({
    monthlyTokenLimit,
    bonusTokensThisPeriod,
    tokensUsedThisPeriod,
  });

export const getPlanName = (planId?: string | null) => getPlanById(planId).name;

export const isPaidSubscriptionStatus = (status?: string | null) =>
  status === 'active' || status === 'grace_period' || status === 'billing_retry';

export const isPaidPlan = (planId?: string | null) => resolvePlanId(planId) !== FREE_PLAN_ID;
