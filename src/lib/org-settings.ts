export type OrgSettings = {
  joinCode: string | null;
  logoUrl: string | null;
  memberLimitOverride: number | null;
  aiTokenLimitOverride: number | null;
};

export const parseOptionalPositiveInt = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.trunc(value);
  return normalized >= 1 ? normalized : null;
};

export const getEffectiveOrgAiAllowance = ({
  monthlyTokenLimit,
  bonusTokensThisPeriod,
  aiTokenLimitOverride,
}: {
  monthlyTokenLimit: number;
  bonusTokensThisPeriod: number;
  aiTokenLimitOverride: number | null;
}) => {
  const baseAllowance = Math.max(0, monthlyTokenLimit) + Math.max(0, bonusTokensThisPeriod);
  if (!aiTokenLimitOverride) {
    return baseAllowance;
  }
  return Math.min(baseAllowance, Math.max(1, aiTokenLimitOverride));
};
