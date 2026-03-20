begin;

create or replace function public.is_org_member(
  p_org_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships
    where org_id = p_org_id
      and user_id = p_user_id
  );
$$;

create or replace function public.is_org_owner(
  p_org_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships
    where org_id = p_org_id
      and user_id = p_user_id
      and role = 'owner'
  );
$$;

alter table public.orgs enable row level security;
alter table public.memberships enable row level security;

drop policy if exists "orgs_select_members" on public.orgs;
create policy "orgs_select_members" on public.orgs
  for select using (public.is_org_member(id));

drop policy if exists "orgs_update_owner" on public.orgs;
drop policy if exists "orgs_update_owner_admin" on public.orgs;
drop policy if exists "orgs_update_admin_mod" on public.orgs;
create policy "orgs_update_owner" on public.orgs
  for update using (public.is_org_owner(id));

drop policy if exists "memberships_select_members" on public.memberships;
drop policy if exists "memberships_select_own_or_admin" on public.memberships;
drop policy if exists "memberships_select_self_or_owner" on public.memberships;
create policy "memberships_select_self_or_owner" on public.memberships
  for select using (
    user_id = auth.uid()
    or public.is_org_owner(org_id)
  );

drop policy if exists "memberships_insert_owner_admin" on public.memberships;
drop policy if exists "memberships_insert_admin" on public.memberships;
drop policy if exists "memberships_insert_owner" on public.memberships;
create policy "memberships_insert_owner" on public.memberships
  for insert with check (public.is_org_owner(org_id));

drop policy if exists "memberships_update_owner" on public.memberships;
drop policy if exists "memberships_update_admin" on public.memberships;
create policy "memberships_update_owner" on public.memberships
  for update using (public.is_org_owner(org_id));

drop policy if exists "memberships_delete_owner_admin_or_self" on public.memberships;
drop policy if exists "memberships_delete_admin" on public.memberships;
drop policy if exists "memberships_delete_owner_or_self" on public.memberships;
create policy "memberships_delete_owner_or_self" on public.memberships
  for delete using (
    user_id = auth.uid()
    or public.is_org_owner(org_id)
  );

drop policy if exists "groups_select_members" on public.groups;
create policy "groups_select_members" on public.groups
  for select using (public.is_org_member(org_id));

drop policy if exists "group_memberships_select_org_members" on public.group_memberships;
drop policy if exists "group_memberships_select_own_or_admin" on public.group_memberships;
create policy "group_memberships_select_org_members" on public.group_memberships
  for select using (public.is_org_member(org_id));

drop policy if exists "group_state_select_members" on public.group_state;
create policy "group_state_select_members" on public.group_state
  for select using (public.is_org_member(org_id));

notify pgrst, 'reload schema';

commit;
