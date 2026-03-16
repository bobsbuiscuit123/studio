-- Group memberships + group state (per-group data storage)

-- Create group_memberships if missing
create table if not exists public.group_memberships (
  user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  group_id uuid not null references public.groups on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists idx_group_memberships_org_id on public.group_memberships(org_id);
create index if not exists idx_group_memberships_group_id on public.group_memberships(group_id);
create index if not exists idx_group_memberships_user_id on public.group_memberships(user_id);

alter table public.group_memberships enable row level security;

drop policy if exists "group_memberships_select_org_members" on public.group_memberships;
create policy "group_memberships_select_org_members" on public.group_memberships
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = group_memberships.org_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "group_memberships_insert_org_members" on public.group_memberships;
create policy "group_memberships_insert_org_members" on public.group_memberships
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.org_id = group_memberships.org_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "group_memberships_delete_self" on public.group_memberships;
create policy "group_memberships_delete_self" on public.group_memberships
  for delete using (user_id = auth.uid());

-- Create group_state table if missing (per-group JSON state)
create table if not exists public.group_state (
  org_id uuid not null references public.orgs on delete cascade,
  group_id uuid not null references public.groups on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (group_id)
);

create index if not exists idx_group_state_org_id on public.group_state(org_id);
create index if not exists idx_group_state_updated_at on public.group_state(updated_at);

alter table public.group_state enable row level security;

drop policy if exists "group_state_select_members" on public.group_state;
create policy "group_state_select_members" on public.group_state
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = group_state.org_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "group_state_update_members" on public.group_state;
create policy "group_state_update_members" on public.group_state
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = group_state.org_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "group_state_insert_members" on public.group_state;
create policy "group_state_insert_members" on public.group_state
  for insert with check (
    exists (
      select 1 from public.memberships m
      where m.org_id = group_state.org_id
        and m.user_id = auth.uid()
    )
  );

-- Rename legacy org_state if it still exists and group_state does not
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'org_state'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'group_state'
  ) then
    alter table public.org_state rename to org_state_legacy;
  end if;
end;
$$;

-- Update create_org to stop inserting into org_state
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
  values (auth.uid(), new_org_id, 'admin');

  return new_org_id;
end;
$$;
