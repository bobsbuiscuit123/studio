"use client";

import { useEffect } from 'react';
import { Browser } from '@capacitor/browser';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const handle = async () => {
      await supabase.auth.getSession();
      await Browser.close();

      const next = searchParams.get('next');
      const redirectPath = next && next.startsWith('/') ? next : '/';
      router.replace(redirectPath);
    };

    void handle();
  }, [router, searchParams]);

  return <p>Signing you in...</p>;
}
