import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { normalizeGroupRole, canEditGroupContent } from '@/lib/group-permissions';
import type { AgentContext } from '@/lib/assistant/agent/types';

export async function getAgentContext(
  userId: string,
  orgId: string,
  groupId: string
): Promise<AgentContext | null> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.role) {
    return null;
  }

  const role = normalizeGroupRole(data.role);
  const canEdit = canEditGroupContent(role);

  return {
    role,
    permissions: {
      canCreateAnnouncements: canEdit,
      canUpdateAnnouncements: canEdit,
      canCreateEvents: canEdit,
      canUpdateEvents: canEdit,
      canMessageMembers: true,
      canCreateEmails: canEdit,
    },
  };
}
