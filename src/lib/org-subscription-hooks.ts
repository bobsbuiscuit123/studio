import { useCallback, useEffect, useState } from 'react';

import { safeFetchJson } from '@/lib/network';
import type { OrgSubscriptionStatus } from '@/lib/org-subscription';
import { getSelectedOrgId } from '@/lib/selection';

const ORG_STATUS_REFRESH_TTL_MS = 60_000;
const orgStatusCache = new Map<string, OrgSubscriptionStatus>();
const orgStatusLoadedAt = new Map<string, number>();
const orgStatusRequestCache = new Map<string, Promise<OrgSubscriptionStatus | null>>();

const getOrgStatusRequestKey = (orgId: string, force: boolean) =>
  `${orgId}:${force ? 'force' : 'cached'}`;

export function useOrgSubscriptionStatus(orgIdOverride?: string | null) {
  const [status, setStatus] = useState<OrgSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const orgId = orgIdOverride ?? getSelectedOrgId();

  const refresh = useCallback(
    async (options?: { force?: boolean; silent?: boolean }) => {
      if (!orgId) {
        setStatus(null);
        setLoading(false);
        return null;
      }

      const cached = orgStatusCache.get(orgId) ?? null;
      const loadedAt = orgStatusLoadedAt.get(orgId) ?? 0;
      const freshEnough =
        !options?.force && cached && Date.now() - loadedAt < ORG_STATUS_REFRESH_TTL_MS;

      if (freshEnough) {
        setStatus(cached);
        setLoading(false);
        return cached;
      }

      if (!options?.silent) {
        setLoading(true);
      }

      const requestKey = getOrgStatusRequestKey(orgId, Boolean(options?.force));
      const pending = orgStatusRequestCache.get(requestKey);
      const request =
        pending ??
        (async () => {
          const response = await safeFetchJson<{ ok: true; data: OrgSubscriptionStatus }>(
            `/api/orgs/${orgId}/status`,
            { method: 'GET' }
          );

          if (!response.ok) {
            return null;
          }

          orgStatusCache.set(orgId, response.data.data);
          orgStatusLoadedAt.set(orgId, Date.now());
          return response.data.data;
        })();

      if (!pending) {
        orgStatusRequestCache.set(requestKey, request);
      }

      const nextStatus = await request;
      if (!pending && orgStatusRequestCache.get(requestKey) === request) {
        orgStatusRequestCache.delete(requestKey);
      }

      if (nextStatus) {
        setStatus(nextStatus);
        setLoading(false);
        return nextStatus;
      }

      setStatus(cached);
      setLoading(false);
      return cached;
    },
    [orgId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleRefresh = () => {
      void refresh({ force: true, silent: true });
    };

    window.addEventListener('online', handleRefresh);
    window.addEventListener('org-subscription-changed', handleRefresh);

    return () => {
      window.removeEventListener('online', handleRefresh);
      window.removeEventListener('org-subscription-changed', handleRefresh);
    };
  }, [refresh]);

  const used = status?.tokensUsedThisPeriod ?? 0;
  const limit = (status?.monthlyTokenLimit ?? 0) + (status?.bonusTokensThisPeriod ?? 0);
  const remaining = status?.effectiveAvailableTokens ?? 0;
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return { status, loading, refresh, used, limit, remaining, percent };
}

export const notifyOrgSubscriptionChanged = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent('org-subscription-changed'));
};
