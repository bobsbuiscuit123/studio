import type { OrgSubscriptionStatus } from '@/lib/org-subscription';

export type OrgAiBadgePresentation = {
  label: 'AI unavailable' | 'AI low' | 'AI available';
  variant: 'default' | 'secondary' | 'destructive';
};

const LOW_AI_TOKEN_THRESHOLD = 100;

const getRemainingTokens = (status: OrgSubscriptionStatus) => {
  const remainingTokens = Number(status.effectiveAvailableTokens ?? 0);
  return Number.isFinite(remainingTokens) ? Math.max(0, remainingTokens) : 0;
};

export const getOrgAiBadgePresentation = (
  status: OrgSubscriptionStatus | null
): OrgAiBadgePresentation => {
  if (!status) {
    return { label: 'AI unavailable', variant: 'destructive' };
  }

  const remainingTokens = getRemainingTokens(status);
  if (!status.aiAvailable || remainingTokens <= 0) {
    return { label: 'AI unavailable', variant: 'destructive' };
  }

  if (remainingTokens <= LOW_AI_TOKEN_THRESHOLD) {
    return { label: 'AI low', variant: 'secondary' };
  }

  return { label: 'AI available', variant: 'default' };
};
