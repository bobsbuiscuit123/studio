-- Add group join code + description
alter table public.groups
  add column if not exists join_code text;

alter table public.groups
  add column if not exists description text;

create unique index if not exists idx_groups_org_join_code
  on public.groups (org_id, join_code);

-- Group memberships (club-level membership)
create table if not exists public.group_memberships (
  user_id uuid not null references auth.users on delete cascade,
  group_id uuid not null references public.groups on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists idx_group_memberships_org_id on public.group_memberships(org_id);
create index if not exists idx_group_memberships_group_id on public.group_memberships(group_id);
create index if not exists idx_group_memberships_user_id on public.group_memberships(user_id);

alter table public.group_memberships enable row level security;

drop policy if exists "group_memberships_select_own_or_admin" on public.group_memberships;
create policy "group_memberships_select_own_or_admin" on public.group_memberships
  for select using (
    user_id = auth.uid()
    or public.is_org_admin_or_mod(org_id)
  );

drop policy if exists "group_memberships_insert_self" on public.group_memberships;
create policy "group_memberships_insert_self" on public.group_memberships
  for insert with check (
    user_id = auth.uid()
    and public.current_membership_role(org_id) is not null
  );

drop policy if exists "group_memberships_delete_self_or_admin" on public.group_memberships;
create policy "group_memberships_delete_self_or_admin" on public.group_memberships
  for delete using (
    user_id = auth.uid()
    or public.is_org_admin_or_mod(org_id)
  );

-- Group state (club-scoped legacy data)
create table if not exists public.group_state (
  group_id uuid primary key references public.groups on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_group_state_org_id on public.group_state(org_id);
create index if not exists idx_group_state_updated_at on public.group_state(updated_at);

alter table public.group_state enable row level security;

drop policy if exists "group_state_select_members" on public.group_state;
create policy "group_state_select_members" on public.group_state
  for select using (
    exists (
      select 1 from public.group_memberships gm
      where gm.group_id = group_state.group_id
        and gm.user_id = auth.uid()
    )
  );

drop policy if exists "group_state_update_members" on public.group_state;
create policy "group_state_update_members" on public.group_state
  for update using (
    exists (
      select 1 from public.group_memberships gm
      where gm.group_id = group_state.group_id
        and gm.user_id = auth.uid()
    )
  );

drop policy if exists "group_state_insert_members" on public.group_state;
create policy "group_state_insert_members" on public.group_state
  for insert with check (
    exists (
      select 1 from public.group_memberships gm
      where gm.group_id = group_state.group_id
        and gm.user_id = auth.uid()
    )
  );

-- Tighten messages RLS to require group membership when group_id is set
drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members" on public.messages
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = messages.org_id
        and m.user_id = auth.uid()
    )
    and (
      messages.group_id is null
      or exists (
        select 1 from public.group_memberships gm
        where gm.group_id = messages.group_id
          and gm.user_id = auth.uid()
      )
    )
  );

drop policy if exists "messages_insert_members" on public.messages;
create policy "messages_insert_members" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.org_id = messages.org_id
        and m.user_id = auth.uid()
    )
    and (
      messages.group_id is null
      or exists (
        select 1 from public.group_memberships gm
        where gm.group_id = messages.group_id
          and gm.user_id = auth.uid()
      )
    )
  );

-- Tighten announcements RLS to require group membership when group_id is set
drop policy if exists "announcements_select_members" on public.announcements;
create policy "announcements_select_members" on public.announcements
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = announcements.org_id
        and m.user_id = auth.uid()
    )
    and (
      announcements.group_id is null
      or exists (
        select 1 from public.group_memberships gm
        where gm.group_id = announcements.group_id
          and gm.user_id = auth.uid()
      )
    )
  );

drop policy if exists "announcements_insert_admin_mod" on public.announcements;
create policy "announcements_insert_admin_mod" on public.announcements
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.org_id = announcements.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
    and (
      announcements.group_id is null
      or exists (
        select 1 from public.group_memberships gm
        where gm.group_id = announcements.group_id
          and gm.user_id = auth.uid()
      )
    )
  );
