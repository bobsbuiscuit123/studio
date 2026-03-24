create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);

create unique index if not exists idx_device_push_tokens_token on public.device_push_tokens(token);
create index if not exists idx_device_push_tokens_user_id on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists "device_push_tokens_select_own" on public.device_push_tokens;
create policy "device_push_tokens_select_own" on public.device_push_tokens
  for select using (user_id = auth.uid());

drop policy if exists "device_push_tokens_insert_own" on public.device_push_tokens;
create policy "device_push_tokens_insert_own" on public.device_push_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists "device_push_tokens_update_own" on public.device_push_tokens;
create policy "device_push_tokens_update_own" on public.device_push_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
