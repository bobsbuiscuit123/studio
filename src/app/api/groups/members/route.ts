import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { err } from '@/lib/result';
import {
  displayGroupRole,
  isGroupAdminRole,
  isGroupRole,
  removeGroupStateMember,
  updateGroupStateMemberRole,
} from '@/lib/group-permissions';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';

export const dynamic = 'force-dynamic';

const listSchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
}).strict();

const roleSchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.string().trim().min(1).max(32),
}).strict();

const removeSchema = z.object({
  orgId: z.string().uuid(),
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
}).strict();

const requireActingAdmin = async (orgId: string, groupId: string) => {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const actingUserId = userData.user?.id;
  if (!actingUserId) {
    return { ok: false as const, response: NextResponse.json(err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }), { status: 401 }) };
  }

  const admin = createSupabaseAdmin();
  const { data: actingMembership } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .eq('user_id', actingUserId)
    .maybeSingle();
  if (!actingMembership || !isGroupAdminRole(actingMembership.role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({ code: 'VALIDATION', message: 'Admins only.', source: 'app' }),
        { status: 403 }
      ),
    };
  }

  return { ok: true as const, admin, actingUserId };
};

export async function GET(request: Request) {
  const ipLimiter = rateLimit(`group-members-list:${getRequestIp(request.headers)}`, 60, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const url = new URL(request.url);
  const parsed = listSchema.safeParse({
    orgId: url.searchParams.get('orgId'),
    groupId: url.searchParams.get('groupId'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid member list request.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`group-members-list-user:${userId}`, 120, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();
  const accessResult = await ensureOrgOwnerGroupMembership({
    admin,
    orgId: parsed.data.orgId,
    groupId: parsed.data.groupId,
    userId,
  });
  if (!accessResult.ok) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403 }
    );
  }

  const [{ data: membershipRows, error: membershipError }, { data: groupStateRow, error: stateError }] =
    await Promise.all([
      admin
        .from('group_memberships')
        .select('user_id, role')
        .eq('org_id', parsed.data.orgId)
        .eq('group_id', parsed.data.groupId),
      admin
        .from('group_state')
        .select('data')
        .eq('group_id', parsed.data.groupId)
        .maybeSingle(),
    ]);

  if (membershipError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: membershipError.message, source: 'network' }),
      { status: 500 }
    );
  }
  if (stateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: stateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const stateMembers = Array.isArray((groupStateRow?.data as { members?: Array<Record<string, unknown>> } | null)?.members)
    ? ((groupStateRow?.data as { members?: Array<Record<string, unknown>> }).members ?? [])
    : [];
  const stateById = new Map<string, Record<string, unknown>>();
  const stateByEmail = new Map<string, Record<string, unknown>>();
  stateMembers.forEach(member => {
    const memberId = typeof member.id === 'string' ? member.id : '';
    const memberEmail = typeof member.email === 'string' ? member.email.toLowerCase() : '';
    if (memberId) stateById.set(memberId, member);
    if (memberEmail) stateByEmail.set(memberEmail, member);
  });

  const userIds = (membershipRows ?? [])
    .map(member => member.user_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const profileById = new Map<string, { email?: string | null; display_name?: string | null; avatar_url?: string | null }>();
  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await admin
      .from('profiles')
      .select('id, email, display_name, avatar_url')
      .in('id', userIds);
    if (profileError) {
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: profileError.message, source: 'network' }),
        { status: 500 }
      );
    }
    (profileRows ?? []).forEach(profile => {
      profileById.set(profile.id, {
        email: profile.email,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      });
    });
  }

  const members = (membershipRows ?? []).map(member => {
    const profile = profileById.get(member.user_id);
    const fromState =
      stateById.get(member.user_id) ??
      (profile?.email ? stateByEmail.get(profile.email.toLowerCase()) : undefined);
    const profileDisplayName =
      typeof profile?.display_name === 'string' && profile.display_name.trim().length > 0
        ? profile.display_name
        : null;
    const stateDisplayName =
      typeof fromState?.name === 'string' && fromState.name.trim().length > 0
        ? fromState.name
        : null;
    const profileAvatar =
      typeof profile?.avatar_url === 'string' && profile.avatar_url.trim().length > 0
        ? profile.avatar_url
        : null;
    const stateAvatar =
      typeof fromState?.avatar === 'string' && fromState.avatar.trim().length > 0
        ? fromState.avatar
        : null;
    const displayName =
      profileDisplayName ||
      stateDisplayName ||
      profile?.email ||
      'Member';
    return {
      id: member.user_id,
      name: displayName,
      email:
        (typeof fromState?.email === 'string' && fromState.email) ||
        profile?.email ||
        '',
      role: displayGroupRole(member.role),
      avatar:
        profileAvatar ||
        stateAvatar ||
        getPlaceholderImageUrl({ label: displayName.charAt(0) }),
      dataAiHint:
        typeof fromState?.dataAiHint === 'string' ? fromState.dataAiHint : undefined,
    };
  });

  return NextResponse.json({ ok: true, data: { members } });
}

export async function PATCH(request: Request) {
  const ipLimiter = rateLimit(`group-members-patch:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success || !isGroupRole(parsed.data.role)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid role update.', source: 'app' }),
      { status: 400 }
    );
  }

  const permission = await requireActingAdmin(parsed.data.orgId, parsed.data.groupId);
  if (!permission.ok) return permission.response;

  const userLimiter = rateLimit(`group-members-patch-user:${permission.actingUserId}`, 60, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const { admin } = permission;
  const { data: targetMembership } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', parsed.data.userId)
    .maybeSingle();
  if (!targetMembership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Target user is not in the group.', source: 'app' }),
      { status: 404 }
    );
  }

  const { data: orgMembership } = await admin
    .from('memberships')
    .select('user_id')
    .eq('org_id', parsed.data.orgId)
    .eq('user_id', parsed.data.userId)
    .maybeSingle();
  if (!orgMembership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Target user is not in the organization.', source: 'app' }),
      { status: 409 }
    );
  }

  const { data: groupMembers } = await admin
    .from('group_memberships')
    .select('user_id, role')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId);
  const adminCount = (groupMembers || []).filter((member) => isGroupAdminRole(member.role)).length;
  if (isGroupAdminRole(targetMembership.role) && parsed.data.role !== 'admin' && adminCount <= 1) {
    return NextResponse.json(
      err({ code: 'ADMIN_REQUIRED', message: 'A group must always have at least one admin.', source: 'app' }),
      { status: 409 }
    );
  }

  const { error: updateError } = await admin
    .from('group_memberships')
    .update({ role: parsed.data.role })
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', parsed.data.userId);
  if (updateError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: updateError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const { data: groupStateRow } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', parsed.data.groupId)
    .maybeSingle();
  if (groupStateRow?.data) {
    await admin
      .from('group_state')
      .update({ data: updateGroupStateMemberRole(groupStateRow.data as Record<string, unknown>, parsed.data.userId, parsed.data.role) })
      .eq('group_id', parsed.data.groupId);
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`group-members-post:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success || !isGroupRole(parsed.data.role)) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid group member payload.', source: 'app' }),
      { status: 400 }
    );
  }

  const permission = await requireActingAdmin(parsed.data.orgId, parsed.data.groupId);
  if (!permission.ok) return permission.response;

  const userLimiter = rateLimit(`group-members-post-user:${permission.actingUserId}`, 60, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const { admin } = permission;
  const { data: orgMembership } = await admin
    .from('memberships')
    .select('user_id')
    .eq('org_id', parsed.data.orgId)
    .eq('user_id', parsed.data.userId)
    .maybeSingle();
  if (!orgMembership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Target user is not in the organization.', source: 'app' }),
      { status: 409 }
    );
  }

  const { error: insertError } = await admin
    .from('group_memberships')
    .upsert(
      {
        org_id: parsed.data.orgId,
        group_id: parsed.data.groupId,
        user_id: parsed.data.userId,
        role: parsed.data.role,
      },
      { onConflict: 'user_id,group_id' }
    );
  if (insertError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: insertError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const [{ data: profile }, { data: groupStateRow }] = await Promise.all([
    admin.from('profiles').select('email, display_name').eq('id', parsed.data.userId).maybeSingle(),
    admin.from('group_state').select('data').eq('group_id', parsed.data.groupId).maybeSingle(),
  ]);

  if (groupStateRow?.data) {
    const data = groupStateRow.data as Record<string, any>;
    const members = Array.isArray(data.members) ? data.members : [];
    if (!members.some((member) => member?.id === parsed.data.userId)) {
      await admin
        .from('group_state')
        .update({
          data: {
            ...data,
            members: [
              ...members,
              {
                id: parsed.data.userId,
                name: profile?.display_name || profile?.email || 'Member',
                email: profile?.email || '',
                role: displayGroupRole(parsed.data.role),
                avatar: getPlaceholderImageUrl({ label: (profile?.display_name || profile?.email || 'M').charAt(0) }),
              },
            ],
          },
        })
        .eq('group_id', parsed.data.groupId);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const ipLimiter = rateLimit(`group-members-delete:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid member removal.', source: 'app' }),
      { status: 400 }
    );
  }

  const permission = await requireActingAdmin(parsed.data.orgId, parsed.data.groupId);
  if (!permission.ok) return permission.response;

  const userLimiter = rateLimit(`group-members-delete-user:${permission.actingUserId}`, 60, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const { admin } = permission;
  const { data: targetMembership } = await admin
    .from('group_memberships')
    .select('role')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', parsed.data.userId)
    .maybeSingle();
  if (!targetMembership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Target user is not in the group.', source: 'app' }),
      { status: 404 }
    );
  }

  const { data: groupMembers } = await admin
    .from('group_memberships')
    .select('user_id, role')
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId);
  const adminCount = (groupMembers || []).filter((member) => isGroupAdminRole(member.role)).length;
  if (isGroupAdminRole(targetMembership.role) && adminCount <= 1) {
    return NextResponse.json(
      err({ code: 'ADMIN_REQUIRED', message: 'A group must always have at least one admin.', source: 'app' }),
      { status: 409 }
    );
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', parsed.data.userId)
    .maybeSingle();

  const { error: deleteError } = await admin
    .from('group_memberships')
    .delete()
    .eq('org_id', parsed.data.orgId)
    .eq('group_id', parsed.data.groupId)
    .eq('user_id', parsed.data.userId);
  if (deleteError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: deleteError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const { data: groupStateRow } = await admin
    .from('group_state')
    .select('data')
    .eq('group_id', parsed.data.groupId)
    .maybeSingle();
  if (groupStateRow?.data) {
    await admin
      .from('group_state')
      .update({ data: removeGroupStateMember(groupStateRow.data as Record<string, unknown>, parsed.data.userId, profile?.email) })
      .eq('group_id', parsed.data.groupId);
  }

  return NextResponse.json({ ok: true });
}
