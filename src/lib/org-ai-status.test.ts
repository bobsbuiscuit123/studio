import { describe, expect, it } from 'vitest';

import { getOrgAiBadgePresentation } from '@/lib/org-ai-status';
import type { OrgSubscriptionStatus } from '@/lib/org-subscription';

const makeStatus = (
  overrides: Partial<OrgSubscriptionStatus> = {}
): OrgSubscriptionStatus => ({
  orgId: 'org-1',
  orgName: 'Test Org',
  role: 'member',
  joinCode: null,
  activeUsers: 1,
  createdAt: null,
  updatedAt: null,
  planId: 'free',
  planName: 'Free',
  subscriptionStatus: 'free',
  subscriptionProductId: null,
  scheduledProductId: null,
  monthlyTokenLimit: 0,
  bonusTokensThisPeriod: 0,
  tokensUsedThisPeriod: 0,
  effectiveAvailableTokens: 0,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  aiAvailable: false,
  canManageBilling: false,
  isSubscribedOrg: false,
  ownerHasActiveSubscription: false,
  subscribedOrgId: null,
  usageEstimateMembers: 0,
  usageEstimateRequestsPerMember: 0,
  usageEstimateMonthlyTokens: 0,
  managementUrl: null,
  ...overrides,
});

describe('org AI badge presentation', () => {
  it('treats zero remaining tokens as unavailable even if cached status says AI is available', () => {
    expect(
      getOrgAiBadgePresentation(
        makeStatus({
          aiAvailable: true,
          effectiveAvailableTokens: 0,
        })
      )
    ).toEqual({ label: 'AI unavailable', variant: 'destructive' });
  });

  it('shows low AI only when some tokens remain under the low threshold', () => {
    expect(
      getOrgAiBadgePresentation(
        makeStatus({
          aiAvailable: true,
          monthlyTokenLimit: 100,
          effectiveAvailableTokens: 100,
        })
      )
    ).toEqual({ label: 'AI low', variant: 'secondary' });
  });

  it('shows available AI when remaining tokens are above the low threshold', () => {
    expect(
      getOrgAiBadgePresentation(
        makeStatus({
          aiAvailable: true,
          monthlyTokenLimit: 500,
          effectiveAvailableTokens: 500,
        })
      )
    ).toEqual({ label: 'AI available', variant: 'default' });
  });
});
