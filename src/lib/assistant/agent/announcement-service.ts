import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { canEditGroupContent, normalizeGroupRole } from '@/lib/group-permissions';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import type { Announcement } from '@/lib/mock-data';

type CreateAnnouncementInput = {
  userId: string;
  userEmail: string;
  orgId: string;
  groupId: string;
  title: string;
  body: string;
};

type UpdateAnnouncementInput = {
  userId: string;
  userEmail: string;
  orgId: string;
  groupId: string;
  targetRef: string;
  title?: string;
  body?: string;
};

const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();

const ensureAnnouncementPermission = async (input: {
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
    throw new Error('Only group admins or officers can manage announcements.');
  }

  return admin;
};

const loadAnnouncementsState = async (input: {
  orgId: string;
  groupId: string;
}) => {
  const admin = createSupabaseAdmin();
  const { data: stateRow, error: stateError } = await admin
    .from('group_state')
    .select('data')
    .eq('org_id', input.orgId)
    .eq('group_id', input.groupId)
    .maybeSingle();

  if (stateError) {
    throw new Error(stateError.message);
  }

  const currentData = ((stateRow?.data as Record<string, unknown> | null) ?? {}) as Record<string, any>;
  const announcements = Array.isArray(currentData.announcements) ? currentData.announcements : [];

  return {
    currentData,
    announcements,
  };
};

const resolveAuthorName = async (input: {
  userId: string;
  userEmail: string;
  currentData: Record<string, any>;
}) => {
  const normalizedEmail = normalizeEmail(input.userEmail);
  const members = Array.isArray(input.currentData.members) ? input.currentData.members : [];
  const matchingMember = members.find((member: unknown) => {
    if (!member || typeof member !== 'object') return false;
    const record = member as Record<string, unknown>;
    return record.id === input.userId || normalizeEmail(record.email) === normalizedEmail;
  });
  const memberName =
    matchingMember && typeof matchingMember === 'object'
      ? String((matchingMember as Record<string, unknown>).name ?? '').trim()
      : '';
  if (memberName) {
    return memberName;
  }

  try {
    const admin = createSupabaseAdmin();
    const { data } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', input.userId)
      .maybeSingle();
    const profileName = String(data?.display_name ?? '').trim();
    if (profileName) {
      return profileName;
    }
  } catch {
    // Author display is cosmetic; keep announcement creation working if profile lookup is unavailable.
  }

  return 'Group Member';
};

const persistAnnouncementsState = async (input: {
  orgId: string;
  groupId: string;
  data: Record<string, unknown>;
}) => {
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from('group_state')
    .upsert(
      {
        org_id: input.orgId,
        group_id: input.groupId,
        data: input.data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );

  if (error) {
    throw new Error(error.message);
  }
};

const resolveAnnouncementIndex = (announcements: Announcement[], targetRef: string) => {
  const normalizedTarget = targetRef.trim().toLowerCase();
  if (!normalizedTarget) {
    return -1;
  }

  const byId = announcements.findIndex(item => String(item.id) === normalizedTarget);
  if (byId >= 0) {
    return byId;
  }

  const titleMatches = announcements
    .map((item, index) => ({
      index,
      title: typeof item.title === 'string' ? item.title.trim().toLowerCase() : '',
    }))
    .filter(item => item.title === normalizedTarget);

  return titleMatches.length === 1 ? titleMatches[0].index : -1;
};

export async function createAnnouncement(input: CreateAnnouncementInput) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw new Error('Announcement title and body are required.');
  }

  await ensureAnnouncementPermission(input);
  const { currentData, announcements } = await loadAnnouncementsState(input);
  const authorName = await resolveAuthorName({ ...input, currentData });
  const nextId =
    announcements.reduce((maxId, item) => {
      const id = typeof item?.id === 'number' ? item.id : typeof item?.id === 'string' ? Number(item.id) : 0;
      return Number.isFinite(id) && id > maxId ? id : maxId;
    }, 0) + 1;

  const announcement: Announcement = {
    id: nextId,
    title,
    content: body,
    author: authorName,
    date: new Date().toISOString(),
    read: false,
    viewedBy: [input.userEmail],
    aiTagged: true,
  };

  const violation = findPolicyViolation(announcement);
  if (violation) {
    throw new Error(policyErrorMessage);
  }

  await persistAnnouncementsState({
    orgId: input.orgId,
    groupId: input.groupId,
    data: {
      ...currentData,
      announcements: [...announcements, announcement],
    },
  });

  return {
    entityId: String(announcement.id),
    entityType: 'announcement' as const,
    message: 'Announcement created successfully.',
    record: announcement,
  };
}

export async function updateAnnouncement(input: UpdateAnnouncementInput) {
  await ensureAnnouncementPermission(input);
  const { currentData, announcements } = await loadAnnouncementsState(input);
  const announcementIndex = resolveAnnouncementIndex(announcements, input.targetRef);

  if (announcementIndex < 0) {
    throw new Error('I could not safely identify which announcement to update.');
  }

  const existing = announcements[announcementIndex];
  const updatedAnnouncement: Announcement = {
    ...existing,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : existing.title,
    content: typeof input.body === 'string' && input.body.trim() ? input.body.trim() : existing.content,
    recipients: undefined,
    viewedBy: Array.from(new Set([...(existing.viewedBy ?? []), input.userEmail])),
    aiTagged: true,
  };

  const violation = findPolicyViolation(updatedAnnouncement);
  if (violation) {
    throw new Error(policyErrorMessage);
  }

  const nextAnnouncements = [...announcements];
  nextAnnouncements[announcementIndex] = updatedAnnouncement;

  await persistAnnouncementsState({
    orgId: input.orgId,
    groupId: input.groupId,
    data: {
      ...currentData,
      announcements: nextAnnouncements,
    },
  });

  return {
    entityId: String(updatedAnnouncement.id),
    entityType: 'announcement' as const,
    message: 'Announcement updated successfully.',
    record: updatedAnnouncement,
  };
}
