'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { getSelectedOrgId } from '@/lib/selection';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type HopeLinkOrgSnapshot = {
  name?: string | null;
  join_code?: string | null;
};

const HOPELINK_JOIN_CODE = 'HPLINK';
const orgFeatureCache = new Map<string, boolean>();

const isHopeLinkSnapshot = (value?: HopeLinkOrgSnapshot | null) =>
  String(value?.join_code ?? '').trim().toUpperCase() === HOPELINK_JOIN_CODE ||
  String(value?.name ?? '').trim() === 'HopeLink';

export function useIsHopeLinkOrg() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const orgId = getSelectedOrgId();
    if (!orgId) {
      setEnabled(false);
      return;
    }

    const cached = orgFeatureCache.get(orgId);
    if (typeof cached === 'boolean') {
      setEnabled(cached);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase
          .from('orgs')
          .select('name, join_code')
          .eq('id', orgId)
          .maybeSingle();
        const nextEnabled = isHopeLinkSnapshot(data);
        orgFeatureCache.set(orgId, nextEnabled);
        if (!cancelled) {
          setEnabled(nextEnabled);
        }
      } catch {
        orgFeatureCache.set(orgId, false);
        if (!cancelled) {
          setEnabled(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return enabled;
}

export const isHopeLinkGroupData = (data: unknown) => {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.donors) && record.donors.length > 0) return true;

  const members = Array.isArray(record.members) ? record.members : [];
  const hasHopeLinkMembers = members.some(member => {
    if (!member || typeof member !== 'object') return false;
    const email = String((member as { email?: unknown }).email ?? '').toLowerCase();
    return email.includes('@hopelink.demo') || email.includes('.hopelink.demo');
  });
  if (hasHopeLinkMembers) return true;

  const events = Array.isArray(record.events) ? record.events : [];
  return events.some(event => {
    if (!event || typeof event !== 'object') return false;
    const title = String((event as { title?: unknown }).title ?? '').toLowerCase();
    const description = String((event as { description?: unknown }).description ?? '').toLowerCase();
    return title.includes('hopelink') || description.includes('dkms') || description.includes('nmdp');
  });
};

export const HOPELINK_DONORS_HREF = '/donors';
