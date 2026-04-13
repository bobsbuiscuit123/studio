create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  schema_version integer not null default 1,
  type text not null check (
    type in (
      'message',
      'announcement',
      'event',
      'social',
      'form',
      'gallery',
      'attendance',
      'points',
      'finance',
      'member'
    )
  ),
  entity_id text not null,
  parent_id text,
  parent_type text check (parent_type in ('dm', 'group')),
  read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create index if not exists idx_notifications_user_created_at
  on public.notifications(user_id, created_at desc);

create index if not exists idx_notifications_user_read
  on public.notifications(user_id, read, created_at desc);

create index if not exists idx_notifications_org_group
  on public.notifications(org_id, group_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (user_id = auth.uid());
