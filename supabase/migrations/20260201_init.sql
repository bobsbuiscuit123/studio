-- Enable extensions
create extension if not exists "pgcrypto";

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique,
  display_name text,
  created_at timestamptz not null default now()
);

-- Orgs
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  category text,
  description text,
  meeting_time text,
  logo_url text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- Memberships
create table if not exists public.memberships (
  user_id uuid not null references auth.users on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  role text not null check (role in ('admin', 'moderator', 'member')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- Groups
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  type text not null default 'general',
  created_at timestamptz not null default now()
);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  group_id uuid references public.groups on delete set null,
  sender_id uuid not null references auth.users on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- Announcements
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  group_id uuid references public.groups on delete set null,
  author_id uuid not null references auth.users on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- AI usage
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

-- Audit logs
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs on delete cascade,
  actor_id uuid references auth.users on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Org state (temporary store for legacy app data)
create table if not exists public.org_state (
  org_id uuid primary key references public.orgs on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_memberships_org_id on public.memberships(org_id);
create index if not exists idx_memberships_user_id on public.memberships(user_id);
create index if not exists idx_groups_org_id on public.groups(org_id);
create index if not exists idx_messages_org_id on public.messages(org_id);
create index if not exists idx_messages_group_id on public.messages(group_id);
create index if not exists idx_messages_sender_id on public.messages(sender_id);
create index if not exists idx_messages_created_at on public.messages(created_at);
create index if not exists idx_announcements_org_id on public.announcements(org_id);
create index if not exists idx_announcements_group_id on public.announcements(group_id);
create index if not exists idx_announcements_created_at on public.announcements(created_at);
create index if not exists idx_ai_usage_day on public.ai_usage(day);
create index if not exists idx_audit_logs_org_id on public.audit_logs(org_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at);
create index if not exists idx_org_state_updated_at on public.org_state(updated_at);

-- RLS
alter table public.profiles enable row level security;
alter table public.orgs enable row level security;
alter table public.memberships enable row level security;
alter table public.groups enable row level security;
alter table public.messages enable row level security;
alter table public.announcements enable row level security;
alter table public.ai_usage enable row level security;
alter table public.audit_logs enable row level security;
alter table public.org_state enable row level security;

-- Profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Orgs policies
drop policy if exists "orgs_select_members" on public.orgs;
create policy "orgs_select_members" on public.orgs
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = id and m.user_id = auth.uid()
    )
  );
drop policy if exists "orgs_insert_authenticated" on public.orgs;
create policy "orgs_insert_authenticated" on public.orgs
  for insert with check (auth.uid() is not null);
drop policy if exists "orgs_update_admin_mod" on public.orgs;
create policy "orgs_update_admin_mod" on public.orgs
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );

-- Memberships policies
drop policy if exists "memberships_select_own_or_admin" on public.memberships;
create policy "memberships_select_own_or_admin" on public.memberships
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );
-- PATCH: join_org compatibility + policy hardening
drop policy if exists "memberships_insert_own" on public.memberships;
drop policy if exists "memberships_insert_admin" on public.memberships;
create policy "memberships_insert_admin" on public.memberships
  for insert with check (
    exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );
drop policy if exists "memberships_update_admin" on public.memberships;
create policy "memberships_update_admin" on public.memberships
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );
drop policy if exists "memberships_delete_admin" on public.memberships;
create policy "memberships_delete_admin" on public.memberships
  for delete using (
    exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );

-- Groups policies
drop policy if exists "groups_select_members" on public.groups;
create policy "groups_select_members" on public.groups
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = groups.org_id
        and m.user_id = auth.uid()
    )
  );
drop policy if exists "groups_write_admin_mod" on public.groups;
create policy "groups_write_admin_mod" on public.groups
  for insert with check (
    exists (
      select 1 from public.memberships m
      where m.org_id = groups.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );
drop policy if exists "groups_update_admin_mod" on public.groups;
create policy "groups_update_admin_mod" on public.groups
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = groups.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );
drop policy if exists "groups_delete_admin_mod" on public.groups;
create policy "groups_delete_admin_mod" on public.groups
  for delete using (
    exists (
      select 1 from public.memberships m
      where m.org_id = groups.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );

-- Messages policies
drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members" on public.messages
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = messages.org_id
        and m.user_id = auth.uid()
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
  );

-- Announcements policies
drop policy if exists "announcements_select_members" on public.announcements;
create policy "announcements_select_members" on public.announcements
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = announcements.org_id
        and m.user_id = auth.uid()
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
  );
drop policy if exists "announcements_update_admin_mod" on public.announcements;
create policy "announcements_update_admin_mod" on public.announcements
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = announcements.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );
drop policy if exists "announcements_delete_admin_mod" on public.announcements;
create policy "announcements_delete_admin_mod" on public.announcements
  for delete using (
    exists (
      select 1 from public.memberships m
      where m.org_id = announcements.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );

-- AI usage policies (read own; service role bypasses RLS)
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage
  for select using (user_id = auth.uid());

-- Audit logs (read for admin/mod; service role bypasses RLS)
drop policy if exists "audit_logs_select_admin_mod" on public.audit_logs;
create policy "audit_logs_select_admin_mod" on public.audit_logs
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = audit_logs.org_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );

-- Org state (members read/write for legacy flows)
drop policy if exists "org_state_select_members" on public.org_state;
create policy "org_state_select_members" on public.org_state
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = org_state.org_id
        and m.user_id = auth.uid()
    )
  );
drop policy if exists "org_state_update_members" on public.org_state;
create policy "org_state_update_members" on public.org_state
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = org_state.org_id
        and m.user_id = auth.uid()
    )
  );
drop policy if exists "org_state_insert_members" on public.org_state;
create policy "org_state_insert_members" on public.org_state
  for insert with check (
    exists (
      select 1 from public.memberships m
      where m.org_id = org_state.org_id
        and m.user_id = auth.uid()
    )
  );

-- Functions for org creation/join (security definer)
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

  insert into public.org_state (org_id, data)
  values (new_org_id, '{}'::jsonb);

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

grant execute on function public.create_org(text, text, text, text, text, text) to authenticated;
grant execute on function public.join_org(text) to authenticated;
