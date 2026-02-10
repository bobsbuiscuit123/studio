import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err, ok, type Result } from '@/lib/result';
import { headers } from 'next/headers';

const DEFAULT_DAILY_QUOTA = 50;

const DEMO_PATH_REGEX = /\/demo(?:\/|$)/i;

const isDemoAiRequest = async () => {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return false;
  try {
    const headerList = await headers();
    const referer = headerList.get('referer') ?? '';
    const nextUrl = headerList.get('next-url') ?? '';
    return DEMO_PATH_REGEX.test(referer) || DEMO_PATH_REGEX.test(nextUrl);
  } catch {
    return false;
  }
};

export const enforceAiQuota = async (
  limit = DEFAULT_DAILY_QUOTA
): Promise<Result<{ remaining: number }>> => {
  if (await isDemoAiRequest()) {
    return ok({ remaining: Number.MAX_SAFE_INTEGER });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) {
    return err({
      code: 'VALIDATION',
      message: 'Unauthorized.',
      source: 'app',
    });
  }
  const userId = userData.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const admin = createSupabaseAdmin();
  const { data: existing } = await admin
    .from('ai_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();
  const currentCount = existing?.count ?? 0;
  if (currentCount >= limit) {
    return err({
      code: 'AI_QUOTA',
      message: 'Daily AI quota reached. Please try again tomorrow.',
      source: 'ai',
    });
  }
  const nextCount = currentCount + 1;
  await admin
    .from('ai_usage')
    .upsert({ user_id: userId, day: today, count: nextCount });
  return ok({ remaining: Math.max(0, limit - nextCount) });
};
