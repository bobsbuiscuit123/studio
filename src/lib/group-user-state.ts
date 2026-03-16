import { useCallback, useEffect, useRef, useState } from 'react';
import { safeFetchJson } from '@/lib/network';
import { getSelectedGroupId, getSelectedOrgId } from '@/lib/selection';

export type GroupUserStateSection = 'mindmap' | 'assistant' | 'aiInsights' | 'dashboard';

type GroupUserStateResponse = {
  ok: boolean;
  data?: Record<string, unknown>;
};

const groupUserStateCache = new Map<string, Record<string, unknown>>();
const groupUserStateRequestCache = new Map<string, Promise<Record<string, unknown>>>();
const groupUserStatePersistedValueCache = new Map<string, string>();

const getGroupUserStateCacheKey = (orgId: string, groupId: string) => `${orgId}:${groupId}`;
const getGroupUserStatePersistKey = (
  orgId: string,
  groupId: string,
  section: GroupUserStateSection
) => `${orgId}:${groupId}:${section}`;
const isSameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function useGroupUserStateSection<T>(
  section: GroupUserStateSection,
  defaultValue: T
) {
  const defaultValueRef = useRef(defaultValue);
  const [orgId, setOrgId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getSelectedOrgId()
  );
  const [groupId, setGroupId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getSelectedGroupId()
  );
  const [data, setData] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(() =>
    typeof window !== 'undefined' && Boolean(getSelectedOrgId() && getSelectedGroupId())
  );
  const dataRef = useRef<T>(defaultValue);
  const writeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueuedSerializedRef = useRef<string | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncSelection = () => {
      setOrgId(getSelectedOrgId());
      setGroupId(getSelectedGroupId());
    };
    syncSelection();
    window.addEventListener('storage', syncSelection);
    window.addEventListener('focus', syncSelection);
    window.addEventListener('popstate', syncSelection);
    return () => {
      window.removeEventListener('storage', syncSelection);
      window.removeEventListener('focus', syncSelection);
      window.removeEventListener('popstate', syncSelection);
    };
  }, []);

  useEffect(() => {
    if (!orgId || !groupId) {
      setData(defaultValueRef.current);
      setLoading(false);
      return;
    }
    const cacheKey = getGroupUserStateCacheKey(orgId, groupId);
    let active = true;
    setLoading(true);
    const cached = groupUserStateCache.get(cacheKey);
    if (cached) {
      setData((cached[section] as T | undefined) ?? defaultValueRef.current);
      setLoading(false);
      return;
    }

    const pending = groupUserStateRequestCache.get(cacheKey) ?? safeFetchJson<GroupUserStateResponse>(
      `/api/group-user-state?orgId=${encodeURIComponent(orgId)}&groupId=${encodeURIComponent(groupId)}`
    ).then((result) => {
      if (!result.ok) {
        console.error(`Failed to load ${section} group user state`, result.error);
        throw result.error;
      }
      return (result.data.data ?? {}) as Record<string, unknown>;
    });

    if (!groupUserStateRequestCache.has(cacheKey)) {
      groupUserStateRequestCache.set(cacheKey, pending);
    }

    pending.then((payload) => {
      if (!active || !payload) return;
      groupUserStateCache.set(cacheKey, payload);
      const next = (payload[section] as T | undefined) ?? defaultValueRef.current;
      groupUserStatePersistedValueCache.set(
        getGroupUserStatePersistKey(orgId, groupId, section),
        JSON.stringify(next)
      );
      lastQueuedSerializedRef.current = JSON.stringify(next);
      setData(next);
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      console.error(`Failed to load ${section} group user state`, error);
      setData(defaultValueRef.current);
      setLoading(false);
    }).finally(() => {
      groupUserStateRequestCache.delete(cacheKey);
    });
    return () => {
      active = false;
    };
  }, [groupId, orgId, section]);

  const updateData = useCallback(
    async (nextValue: T | ((prev: T) => T)) => {
      if (!orgId || !groupId) return;
      const resolved =
        typeof nextValue === 'function'
          ? (nextValue as (prev: T) => T)(dataRef.current)
          : nextValue;
      const cacheKey = getGroupUserStateCacheKey(orgId, groupId);
      const persistKey = getGroupUserStatePersistKey(orgId, groupId, section);
      const existing = groupUserStateCache.get(cacheKey) ?? {};
      const currentSectionValue = (existing[section] as T | undefined) ?? dataRef.current;
      const serializedResolved = JSON.stringify(resolved);
      if (isSameValue(currentSectionValue, resolved)) {
        return;
      }
      if (lastQueuedSerializedRef.current === serializedResolved) {
        return;
      }
      if (groupUserStatePersistedValueCache.get(persistKey) === serializedResolved) {
        return;
      }
      dataRef.current = resolved;
      setData(resolved);
      groupUserStateCache.set(cacheKey, {
        ...existing,
        [section]: resolved,
      });
      lastQueuedSerializedRef.current = serializedResolved;
      if (writeTimeoutRef.current) {
        clearTimeout(writeTimeoutRef.current);
      }
      writeTimeoutRef.current = setTimeout(async () => {
        const response = await safeFetchJson<GroupUserStateResponse>('/api/group-user-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, groupId, section, value: resolved }),
        });
        if (!response.ok) {
          console.error(`Failed to persist ${section} group user state`, response.error);
          return;
        }
        groupUserStatePersistedValueCache.set(persistKey, serializedResolved);
      }, 250);
    },
    [groupId, orgId, section]
  );

  useEffect(() => {
    return () => {
      if (writeTimeoutRef.current) {
        clearTimeout(writeTimeoutRef.current);
      }
    };
  }, []);

  return { data, loading, updateData, orgId, groupId };
}
