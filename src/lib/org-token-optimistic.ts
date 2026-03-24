const PENDING_ORG_BALANCE_PREFIX = 'pending-org-balance:';
const PENDING_ORG_BALANCE_TTL_MS = 15 * 60 * 1000;

type PendingOrgBalanceState = {
  targetBalance: number;
  transactionIds: string[];
  updatedAt: number;
};

const getStorageKey = (orgId: string) => `${PENDING_ORG_BALANCE_PREFIX}${orgId}`;

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const readState = (orgId: string): PendingOrgBalanceState | null => {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOrgBalanceState;
    if (!parsed || !Number.isFinite(parsed.targetBalance) || !Number.isFinite(parsed.updatedAt)) {
      window.localStorage.removeItem(getStorageKey(orgId));
      return null;
    }
    if (Date.now() - parsed.updatedAt > PENDING_ORG_BALANCE_TTL_MS) {
      window.localStorage.removeItem(getStorageKey(orgId));
      return null;
    }
    return {
      targetBalance: Number(parsed.targetBalance),
      transactionIds: Array.isArray(parsed.transactionIds) ? parsed.transactionIds.map(String) : [],
      updatedAt: Number(parsed.updatedAt),
    };
  } catch {
    window.localStorage.removeItem(getStorageKey(orgId));
    return null;
  }
};

const writeState = (orgId: string, state: PendingOrgBalanceState) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(getStorageKey(orgId), JSON.stringify(state));
};

export const getPendingOrgTokenBalanceTarget = (orgId?: string | null) => {
  if (!orgId) return null;
  return readState(orgId)?.targetBalance ?? null;
};

export const wasOrgTokenPurchaseProcessed = (orgId: string, transactionId?: string | null) => {
  const normalizedTransactionId = String(transactionId ?? '').trim();
  if (!normalizedTransactionId) return false;
  return Boolean(readState(orgId)?.transactionIds.includes(normalizedTransactionId));
};

export const registerPendingOrgTokenBalance = ({
  orgId,
  transactionId,
  currentBalance,
  tokenBalance,
  tokensGranted,
}: {
  orgId: string;
  transactionId?: string | null;
  currentBalance?: number | null;
  tokenBalance?: number | null;
  tokensGranted?: number | null;
}) => {
  const existing = readState(orgId);
  const explicitBalance = Number(tokenBalance);
  const grantedTokens = Number(tokensGranted);
  const baseBalance = Number.isFinite(Number(currentBalance))
    ? Number(currentBalance)
    : Number(existing?.targetBalance ?? 0);
  const nextTarget = Number.isFinite(explicitBalance)
    ? explicitBalance
    : Number.isFinite(grantedTokens)
      ? baseBalance + grantedTokens
      : NaN;

  if (!Number.isFinite(nextTarget)) {
    return existing?.targetBalance ?? null;
  }

  const normalizedTransactionId = String(transactionId ?? '').trim();
  const transactionIds = Array.from(
    new Set([
      ...(existing?.transactionIds ?? []),
      ...(normalizedTransactionId ? [normalizedTransactionId] : []),
    ])
  );

  const targetBalance = Math.max(Number(existing?.targetBalance ?? 0), nextTarget);
  writeState(orgId, {
    targetBalance,
    transactionIds,
    updatedAt: Date.now(),
  });

  return targetBalance;
};

export const clearSatisfiedPendingOrgTokenBalance = (orgId?: string | null, actualBalance?: number | null) => {
  if (!orgId || !canUseStorage()) return;
  const existing = readState(orgId);
  if (!existing) return;
  const normalizedActualBalance = Number(actualBalance);
  if (Number.isFinite(normalizedActualBalance) && normalizedActualBalance >= existing.targetBalance) {
    window.localStorage.removeItem(getStorageKey(orgId));
  }
};
