import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { normalizeGroupRole, canEditGroupContent } from '@/lib/group-permissions';
import type { AgentContext } from '@/lib/assistant/agent/types';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';

export async function getAgentContext(
  userId: string,
  orgId: string,
  groupId: string
): Promise<AgentContext | null> {
  const admin = createSupabaseAdmin();
  const accessResult = await ensureOrgOwnerGroupMembership({
    admin,
    orgId,
    groupId,
    userId,
  });

  if (!accessResult.ok) {
    return null;
  }

  const role = normalizeGroupRole(accessResult.role);
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
      canUpdateEmails: canEdit,
    },
  };
}
