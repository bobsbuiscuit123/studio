import { createBrowserClient } from '@supabase/ssr';
import type { Session } from '@supabase/supabase-js';

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
let warnedMissingEnvDuringBuild = false;

export const BROWSER_SESSION_TIMEOUT_MS = 2_000;

type BrowserSessionClient = {
  auth: {
    getSession: () => Promise<{
      data: {
        session: Session | null;
      };
    }>;
  };
};

const isBuildPhase =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.npm_lifecycle_event === 'build';

const createBuildSafeBrowserClientStub = () =>
  ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: new Error('Supabase browser auth is unavailable during build.'),
      }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe() {},
          },
        },
      }),
      exchangeCodeForSession: async () => ({
        data: { session: null, user: null },
        error: new Error('Supabase browser auth is unavailable during build.'),
      }),
      resetPasswordForEmail: async () => ({
        data: null,
        error: new Error('Supabase browser auth is unavailable during build.'),
      }),
      updateUser: async () => ({
        data: { user: null },
        error: new Error('Supabase browser auth is unavailable during build.'),
      }),
    },
  }) as ReturnType<typeof createBrowserClient>;

export const createSupabaseBrowserClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (typeof window === 'undefined' && isBuildPhase) {
      if (!warnedMissingEnvDuringBuild) {
        warnedMissingEnvDuringBuild = true;
        console.warn(
          '[supabase-browser-client] Missing public Supabase env vars during build; using inert browser client stub for prerender.'
        );
      }
      return createBuildSafeBrowserClientStub();
    }
    throw new Error('Missing Supabase env vars.');
  }

  if (typeof window !== 'undefined' && browserClient) {
    return browserClient;
  }

  const client = createBrowserClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  if (typeof window !== 'undefined') {
    browserClient = client;
  }

  return client;
};

export async function getBrowserSessionWithTimeout(
  supabase: BrowserSessionClient,
  timeoutMs: number = BROWSER_SESSION_TIMEOUT_MS
): Promise<{ session: Session | null; timedOut: boolean }> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      supabase.auth.getSession().then(({ data }) => ({
        session: data.session ?? null,
        timedOut: false,
      })),
      new Promise<{ session: Session | null; timedOut: boolean }>(resolve => {
        timeoutId = setTimeout(() => {
          resolve({ session: null, timedOut: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
