import { displayGroupRole, normalizeGroupRole, type GroupRole } from '@/lib/group-permissions';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

type UserProfileSnapshot = {
  email: string;
  name: string;
  avatar: string;
};

type GroupAccessResult =
  | {
      ok: true;
      role: GroupRole;
      isOrgOwner: boolean;
      createdMembership: boolean;
    }
  | {
      ok: false;
      reason: 'org' | 'group';
    };

const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();

const loadUserProfileSnapshot = async (
  admin: SupabaseAdmin,
  userId: string
): Promise<UserProfileSnapshot> => {
  const { data } = await admin
    .from('profiles')
    .select('email, display_name, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  const email = normalizeEmail(data?.email);
  const name = String(data?.display_name || data?.email || 'Member').trim();
  return {
    email,
    name,
    avatar:
      typeof data?.avatar_url === 'string' && data.avatar_url.trim()
        ? data.avatar_url
        : getPlaceholderImageUrl({ label: name.charAt(0) }),
  };
};

const ensureGroupStateMember = async ({
  admin,
  orgId,
  groupId,
  userId,
  profile,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  groupId: string;
  userId: string;
  profile: UserProfileSnapshot;
}) => {
  const { data: stateRow, error } = await admin
    .from('group_state')
    .select('data')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .maybeSingle();

  if (error || !stateRow?.data) {
    if (error) throw error;
    return;
  }

  const data = stateRow.data as Record<string, any>;
  const members = Array.isArray(data.members) ? data.members : [];
  const normalizedProfileEmail = normalizeEmail(profile.email);
  const exists = members.some((member: unknown) => {
    if (!member || typeof member !== 'object') return false;
    const record = member as Record<string, unknown>;
    return (
      record.id === userId ||
      (normalizedProfileEmail && normalizeEmail(record.email) === normalizedProfileEmail)
    );
  });

  if (exists) {
    return;
  }

  const { error: updateError } = await admin
    .from('group_state')
    .update({
      data: {
        ...data,
        members: [
          ...members,
          {
            id: userId,
            name: profile.name,
            email: profile.email,
            role: displayGroupRole('member'),
            avatar: profile.avatar,
          },
        ],
      },
    })
    .eq('org_id', orgId)
    .eq('group_id', groupId);
  if (updateError) throw updateError;
};

export const ensureOrgOwnerGroupMembership = async ({
  admin,
  orgId,
  groupId,
  userId,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  groupId: string;
  userId: string;
}): Promise<GroupAccessResult> => {
  const [
    { data: orgMembership, error: orgMembershipError },
    { data: orgRow, error: orgError },
    { data: groupMembership, error: groupMembershipError },
  ] = await Promise.all([
    admin
      .from('memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('orgs')
      .select('owner_id')
      .eq('id', orgId)
      .maybeSingle(),
    admin
      .from('group_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (orgMembershipError) throw orgMembershipError;
  if (orgError) throw orgError;
  if (groupMembershipError) throw groupMembershipError;
  if (!orgMembership) {
    return { ok: false, reason: 'org' };
  }

  const isOrgOwner = orgMembership.role === 'owner' || orgRow?.owner_id === userId;
  if (groupMembership?.role) {
    return {
      ok: true,
      role: normalizeGroupRole(groupMembership.role),
      isOrgOwner,
      createdMembership: false,
    };
  }

  if (!isOrgOwner) {
    return { ok: false, reason: 'group' };
  }

  const { data: groupRow, error: groupError } = await admin
    .from('groups')
    .select('id')
    .eq('org_id', orgId)
    .eq('id', groupId)
    .maybeSingle();
  if (groupError) throw groupError;
  if (!groupRow?.id) {
    return { ok: false, reason: 'group' };
  }

  const { error: insertError } = await admin
    .from('group_memberships')
    .upsert(
      { org_id: orgId, group_id: groupId, user_id: userId, role: 'member' },
      { onConflict: 'user_id,group_id', ignoreDuplicates: true }
    );
  if (insertError) throw insertError;

  const profile = await loadUserProfileSnapshot(admin, userId);
  await ensureGroupStateMember({ admin, orgId, groupId, userId, profile });

  return {
    ok: true,
    role: 'member',
    isOrgOwner,
    createdMembership: true,
  };
};

export const ensureOrgOwnerMembershipsForGroups = async ({
  admin,
  orgId,
  userId,
  groupIds,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  userId: string;
  groupIds: string[];
}) => {
  const uniqueGroupIds = Array.from(new Set(groupIds.filter(Boolean)));
  if (uniqueGroupIds.length === 0) {
    return;
  }

  const { data: existingRows, error } = await admin
    .from('group_memberships')
    .select('group_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .in('group_id', uniqueGroupIds);
  if (error) throw error;

  const existingGroupIds = new Set(
    (existingRows ?? [])
      .map(row => row.group_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );
  const missingGroupIds = uniqueGroupIds.filter(groupId => !existingGroupIds.has(groupId));
  if (missingGroupIds.length === 0) {
    return;
  }

  const { error: insertError } = await admin
    .from('group_memberships')
    .upsert(
      missingGroupIds.map(groupId => ({
        org_id: orgId,
        group_id: groupId,
        user_id: userId,
        role: 'member',
      })),
      { onConflict: 'user_id,group_id', ignoreDuplicates: true }
    );
  if (insertError) throw insertError;

  const profile = await loadUserProfileSnapshot(admin, userId);
  for (const groupId of missingGroupIds) {
    await ensureGroupStateMember({ admin, orgId, groupId, userId, profile });
  }
};
