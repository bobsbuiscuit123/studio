export type GroupRole = 'admin' | 'officer' | 'member';

type GroupStateMember = {
  id?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
};

type GroupStateData = {
  members?: GroupStateMember[];
  [key: string]: unknown;
};

export const GROUP_ROLES: GroupRole[] = ['admin', 'officer', 'member'];

export const isGroupRole = (value: unknown): value is GroupRole =>
  typeof value === 'string' && GROUP_ROLES.includes(value as GroupRole);

export const isGroupAdminRole = (role?: string | null) => role === 'admin';

export const canManageGroupRoles = (role?: string | null) => role === 'admin';

export const canEditGroupContent = (role?: string | null) =>
  role === 'admin' || role === 'officer';

export const displayGroupRole = (role?: string | null) => {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'officer':
      return 'Officer';
    default:
      return 'Member';
  }
};

export const normalizeGroupRole = (role?: string | null): GroupRole => {
  switch ((role ?? '').toLowerCase()) {
    case 'admin':
    case 'owner':
      return 'admin';
    case 'officer':
      return 'officer';
    default:
      return 'member';
  }
};

export const updateGroupStateMemberRole = (
  data: GroupStateData | null | undefined,
  userId: string,
  role: GroupRole
) => {
  if (!data || !Array.isArray(data.members)) return data;
  return {
    ...data,
    members: data.members.map((member) =>
      member?.id === userId
        ? {
            ...member,
            role: displayGroupRole(role),
          }
        : member
    ),
  };
};

export const removeGroupStateMember = (
  data: GroupStateData | null | undefined,
  userId: string,
  userEmail?: string | null
) => {
  if (!data || !Array.isArray(data.members)) return data;
  const normalizedEmail = userEmail?.toLowerCase() ?? '';
  return {
    ...data,
    members: data.members.filter((member) => {
      if (member?.id === userId) return false;
      if (normalizedEmail && String(member?.email ?? '').toLowerCase() === normalizedEmail) {
        return false;
      }
      return true;
    }),
  };
};
