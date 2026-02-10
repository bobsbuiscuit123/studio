import { createClient } from '@supabase/supabase-js';

export const createSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase admin env vars.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
};
