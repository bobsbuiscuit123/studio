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

export const HOPELINK_DONORS_HREF = '/donors';
