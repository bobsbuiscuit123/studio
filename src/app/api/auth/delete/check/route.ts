import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isGroupAdminRole } from '@/lib/group-permissions';

type AdminMember = {
  userId: string;
  email: string;
  name: string;
  role: 'Admin' | 'Officer' | 'Member';
};

type AdminGroup = {
  groupId: string;
  groupName: string;
  members: AdminMember[];
};

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const admin = createSupabaseAdmin();
  const { data: groupMemberships, error: groupMembershipsError } = await admin
    .from('group_memberships')
    .select('group_id, role')
    .eq('user_id', user.id);

  if (groupMembershipsError) {
    return NextResponse.json({ ok: false, error: groupMembershipsError.message }, { status: 500 });
  }

  const adminMemberships = (groupMemberships || []).filter((row) => isGroupAdminRole(row.role));
  const groupIds = adminMemberships.map((row) => row.group_id);
  if (groupIds.length === 0) {
    return NextResponse.json({ ok: true, adminGroups: [] as AdminGroup[] });
  }

  const [{ data: groupRows }, { data: groupStateRows }, { data: userProfile }, { data: allGroupMemberships }] = await Promise.all([
    admin.from('groups').select('id, name').in('id', groupIds),
    admin.from('group_state').select('group_id, data').in('group_id', groupIds),
    admin.from('profiles').select('email, display_name').eq('id', user.id).maybeSingle(),
    admin.from('group_memberships').select('group_id, user_id, role').in('group_id', groupIds),
  ]);

  const userEmail = userProfile?.email || user.email || '';
  const groupNameById = new Map((groupRows || []).map((group) => [group.id, group.name]));

  const adminGroups: AdminGroup[] = [];
  for (const row of groupStateRows || []) {
    const data = row.data as { members?: Array<any> };
    const members = Array.isArray(data?.members) ? data.members : [];
    const adminCount = (allGroupMemberships || [])
      .filter((member) => member.group_id === row.group_id && isGroupAdminRole(member.role))
      .length;
    if (adminCount > 1) {
      continue;
    }
    const mappedMembers: AdminMember[] = members
      .filter(member => Boolean(member?.email) || Boolean(member?.id))
      .map(member => ({
        userId: member.id || '',
        email: member.email || '',
        name: member.name || member.email || 'Member',
        role: (member.role || 'Member') as AdminMember['role'],
      }))
      .filter(member => Boolean(member.userId));

    adminGroups.push({
      groupId: row.group_id,
      groupName: groupNameById.get(row.group_id) || 'Group',
      members: mappedMembers,
    });
  }

  return NextResponse.json({ ok: true, adminGroups });
}
