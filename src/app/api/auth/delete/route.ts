import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  isGroupAdminRole,
  removeGroupStateMember,
  updateGroupStateMemberRole,
} from '@/lib/group-permissions';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

type DeletePlanItem = {
  groupId: string;
  action: 'transfer' | 'delete';
  newAdminUserId?: string;
};

const deletePlanSchema = z.object({
  groupId: z.string().uuid(),
  action: z.enum(['transfer', 'delete']),
  newAdminUserId: z.string().uuid().optional(),
}).strict();

const deleteRequestSchema = z.object({
  plans: z.array(deletePlanSchema).max(100).optional(),
}).strict();

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`auth-delete:${getRequestIp(request.headers)}`, 10, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const userLimiter = rateLimit(`auth-delete-user:${user.id}`, 10, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = deleteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid delete payload.' }, { status: 400 });
  }

  const admin = createSupabaseAdmin();
  const { data: groupMemberships, error: groupMembershipsError } = await admin
    .from('group_memberships')
    .select('org_id, group_id, user_id, role')
    .eq('user_id', user.id);

  if (groupMembershipsError) {
    return NextResponse.json({ ok: false, error: groupMembershipsError.message }, { status: 500 });
  }

  const groupIds = (groupMemberships || []).map((row) => row.group_id);
  const plans = parsed.data.plans ?? [];

  const { data: userProfile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .maybeSingle();
  const userEmail = userProfile?.email || user.email || '';

  const groupStateRows =
    groupIds.length === 0
      ? []
      : (
          await admin
            .from('group_state')
            .select('group_id, data')
            .in('group_id', groupIds)
        ).data ?? [];

  const groupsRequiringPlan = new Set<string>();
  for (const row of groupStateRows) {
    const currentMembership = (groupMemberships || []).find(
      (membership) => membership.group_id === row.group_id && isGroupAdminRole(membership.role)
    );
    if (!currentMembership) continue;
    const adminCount = (groupMemberships || []).filter(
      (membership) => membership.group_id === row.group_id && isGroupAdminRole(membership.role)
    ).length;
    if (adminCount <= 1) {
      groupsRequiringPlan.add(row.group_id);
    }
  }

  if (groupsRequiringPlan.size > 0) {
    const planGroupIds = new Set(plans.map((plan) => plan.groupId));
    const hasAllPlans = Array.from(groupsRequiringPlan).every((groupId) => planGroupIds.has(groupId));
    if (!hasAllPlans) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ADMIN_ACTION_REQUIRED',
          adminGroupIds: Array.from(groupsRequiringPlan),
        },
        { status: 409 }
      );
    }
  }

  const groupsToDelete = new Set<string>();
  for (const plan of plans) {
    if (plan.action === 'delete') {
      groupsToDelete.add(plan.groupId);
    }
  }

  if (groupsToDelete.size > 0) {
    await admin.from('group_state').delete().in('group_id', Array.from(groupsToDelete));
    await admin.from('group_memberships').delete().in('group_id', Array.from(groupsToDelete));
    await admin.from('groups').delete().in('id', Array.from(groupsToDelete));
  }

  const transferPlans = plans.filter((plan) => plan.action === 'transfer');
  for (const plan of transferPlans) {
    if (!plan.newAdminUserId || plan.newAdminUserId === user.id) {
      return NextResponse.json({ ok: false, error: 'Invalid transfer target.' }, { status: 400 });
    }
    const groupStateRow = groupStateRows.find(row => row.group_id === plan.groupId);
    if (!groupStateRow?.data) {
      return NextResponse.json({ ok: false, error: 'Group not found.' }, { status: 404 });
    }
    const data = groupStateRow.data as Record<string, unknown>;
    const targetMembership = (groupMemberships || []).find(
      (membership) => membership.group_id === plan.groupId && membership.user_id === plan.newAdminUserId
    );
    if (!targetMembership) {
      return NextResponse.json({ ok: false, error: 'Transfer target not in group.' }, { status: 400 });
    }
    await admin
      .from('group_memberships')
      .update({ role: 'admin' })
      .eq('group_id', plan.groupId)
      .eq('user_id', plan.newAdminUserId);
    await admin
      .from('group_state')
      .update({
        data: removeGroupStateMember(
          updateGroupStateMemberRole(data, plan.newAdminUserId, 'admin') as Record<string, unknown>,
          user.id,
          userEmail
        ),
      })
      .eq('group_id', plan.groupId);
    await admin
      .from('group_memberships')
      .delete()
      .eq('group_id', plan.groupId)
      .eq('user_id', user.id);
  }

  const remainingGroupIds = groupIds.filter((groupId) => !groupsToDelete.has(groupId));
  if (remainingGroupIds.length > 0) {
    const remainingGroupStates =
      (
        await admin
          .from('group_state')
          .select('group_id, data')
          .in('group_id', remainingGroupIds)
      ).data ?? [];
    if (remainingGroupStates) {
      for (const row of remainingGroupStates) {
        if (transferPlans.some((plan) => plan.groupId === row.group_id)) {
          continue;
        }
        const data = row.data as Record<string, unknown>;
        await admin
          .from('group_state')
          .update({ data: removeGroupStateMember(data, user.id, userEmail) })
          .eq('group_id', row.group_id);
      }
    }
    await admin
      .from('group_memberships')
      .delete()
      .in('group_id', remainingGroupIds)
      .eq('user_id', user.id);
  }

  await admin.from('profiles').delete().eq('id', user.id);

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
