import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err, ok, type Result } from '@/lib/result';

export const requireUser = async () => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return err({
      code: 'VALIDATION',
      message: 'Unauthorized.',
      source: 'app',
    });
  }
  return ok(data.user);
};

export const requireOrgRole = async (
  orgId: string,
  roles: Array<'admin' | 'moderator' | 'member'>
) => {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return err({
      code: 'VALIDATION',
      message: 'Unauthorized.',
      source: 'app',
    });
  }
  const { data, error } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.role) {
    return err({
      code: 'VALIDATION',
      message: 'Access denied.',
      source: 'app',
    });
  }
  if (!roles.includes(data.role as 'admin' | 'moderator' | 'member')) {
    return err({
      code: 'VALIDATION',
      message: 'Insufficient permissions.',
      source: 'app',
    });
  }
  return ok(data.role);
};
