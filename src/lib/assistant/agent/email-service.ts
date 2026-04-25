import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { canEditGroupContent, normalizeGroupRole } from '@/lib/group-permissions';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';

type CreateEmailDraftInput = {
  userId: string;
  orgId: string;
  groupId: string;
  pendingActionId: string;
  subject: string;
  body: string;
};

const ensureEmailPermission = async (input: {
  userId: string;
  orgId: string;
  groupId: string;
}) => {
  const admin = createSupabaseAdmin();
  const { data: membership, error: membershipError } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', input.orgId)
    .eq('group_id', input.groupId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }
  if (!membership?.role || !canEditGroupContent(normalizeGroupRole(membership.role))) {
    throw new Error('Only group admins or officers can create group emails.');
  }
};

export async function createEmailDraft(input: CreateEmailDraftInput) {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || !body) {
    throw new Error('Email subject and body are required.');
  }

  await ensureEmailPermission(input);

  const violation = findPolicyViolation({ subject, body });
  if (violation) {
    throw new Error(policyErrorMessage);
  }

  return {
    entityId: input.pendingActionId,
    entityType: 'email' as const,
    message: 'Email draft added to the email composer.',
    draft: {
      subject,
      body,
    },
  };
}
