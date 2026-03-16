alter table public.orgs
  add column if not exists created_by uuid references auth.users on delete set null;

alter table public.groups
  add column if not exists created_by uuid references auth.users on delete set null;

alter table public.memberships
  drop constraint if exists memberships_role_check;

alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner', 'member'));

alter table public.group_memberships
  add column if not exists role text;

update public.group_memberships
set role = 'member'
where role is null;

alter table public.group_memberships
  alter column role set default 'member';

alter table public.group_memberships
  alter column role set not null;

alter table public.group_memberships
  drop constraint if exists group_memberships_role_check;

alter table public.group_memberships
  add constraint group_memberships_role_check
  check (role in ('admin', 'officer', 'member'));

with first_members as (
  select distinct on (group_id) group_id, user_id
  from public.group_memberships
  order by group_id, created_at asc, user_id asc
)
update public.group_memberships gm
set role = 'admin'
from first_members fm
where gm.group_id = fm.group_id
  and gm.user_id = fm.user_id
  and not exists (
    select 1
    from public.group_memberships existing_admin
    where existing_admin.group_id = gm.group_id
      and existing_admin.role = 'admin'
  );

create or replace function public.create_org(
  org_name text,
  join_code text,
  category text,
  description text,
  meeting_time text,
  logo_url text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_org_id uuid;
begin
  insert into public.orgs (name, join_code, category, description, meeting_time, logo_url, created_by)
  values (org_name, join_code, category, description, meeting_time, logo_url, auth.uid())
  returning id into new_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (auth.uid(), new_org_id, 'owner');

  return new_org_id;
end;
$$;

create or replace function public.join_org(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org_id uuid;
begin
  select id into target_org_id
  from public.orgs
  where orgs.join_code = p_join_code;
  if target_org_id is null then
    raise exception 'Org not found';
  end if;

  insert into public.memberships (user_id, org_id, role)
  values (auth.uid(), target_org_id, 'member')
  on conflict do nothing;

  return target_org_id;
end;
$$;
