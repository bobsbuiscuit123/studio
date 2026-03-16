create table if not exists public.group_user_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists idx_group_user_state_org_id
  on public.group_user_state(org_id);

create index if not exists idx_group_user_state_group_id
  on public.group_user_state(group_id);

alter table public.group_user_state enable row level security;

drop policy if exists "group_user_state_select_own" on public.group_user_state;
create policy "group_user_state_select_own" on public.group_user_state
  for select using (user_id = auth.uid());

drop policy if exists "group_user_state_insert_own" on public.group_user_state;
create policy "group_user_state_insert_own" on public.group_user_state
  for insert with check (user_id = auth.uid());

drop policy if exists "group_user_state_update_own" on public.group_user_state;
create policy "group_user_state_update_own" on public.group_user_state
  for update using (user_id = auth.uid());

drop policy if exists "group_user_state_delete_own" on public.group_user_state;
create policy "group_user_state_delete_own" on public.group_user_state
  for delete using (user_id = auth.uid());
