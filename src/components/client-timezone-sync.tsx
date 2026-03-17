'use client';

import { useEffect } from 'react';
import { getClientTimeZoneCookieName } from '@/lib/day-key';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function ClientTimeZoneSync() {
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) {
      return;
    }

    const cookieName = getClientTimeZoneCookieName();
    document.cookie = `${cookieName}=${encodeURIComponent(timeZone)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }, []);

  return null;
}
