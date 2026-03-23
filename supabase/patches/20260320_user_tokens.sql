alter table public.profiles
  add column if not exists token_balance integer not null default 0;

alter table public.profiles
  add column if not exists has_used_trial boolean not null default false;

alter table public.profiles
  add column if not exists trial_granted_at timestamptz;

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orgs'
      and column_name = 'owner_user_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orgs'
      and column_name = 'owner_id'
  ) then
    alter table public.orgs rename column owner_user_id to owner_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orgs'
      and column_name = 'member_limit'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orgs'
      and column_name = 'member_cap'
  ) then
    alter table public.orgs rename column member_limit to member_cap;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orgs'
      and column_name = 'ai_daily_limit_per_user'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orgs'
      and column_name = 'daily_ai_limit'
  ) then
    alter table public.orgs rename column ai_daily_limit_per_user to daily_ai_limit;
  end if;
end $$;

alter table public.orgs
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

alter table public.orgs
  add column if not exists member_cap int not null default 25;

alter table public.orgs
  add column if not exists daily_ai_limit int not null default 40;

alter table public.orgs
  add column if not exists token_balance int not null default 0;

update public.orgs
set owner_id = created_by
where owner_id is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_usage_daily'
      and column_name = 'credits_used'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_usage_daily'
      and column_name = 'request_count'
  ) then
    alter table public.org_usage_daily rename column credits_used to request_count;
  end if;
end $$;

alter table public.org_usage_daily
  add column if not exists request_count int not null default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_usage_logs'
      and column_name = 'credits_charged'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_usage_logs'
      and column_name = 'tokens_charged'
  ) then
    alter table public.ai_usage_logs rename column credits_charged to tokens_charged;
  end if;
end $$;

alter table public.ai_usage_logs
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.ai_usage_logs
  add column if not exists tokens_charged int not null default 1;

alter table public.ai_usage_logs
  alter column tokens_charged type int using round(coalesce(tokens_charged, 1))::int;

create table if not exists public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.orgs(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('trial', 'usage', 'purchase', 'adjustment')),
  amount integer not null,
  balance_after integer not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_token_transactions_user_created_at
  on public.token_transactions(user_id, created_at desc);

create index if not exists idx_token_transactions_org_created_at
  on public.token_transactions(organization_id, created_at desc);

create table if not exists public.token_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'revenuecat',
  provider_transaction_id text not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index if not exists idx_token_purchase_intents_provider_created_at
  on public.token_purchase_intents(provider, created_at desc);

create index if not exists idx_ai_usage_logs_owner_created_at
  on public.ai_usage_logs(owner_user_id, created_at desc);

alter table public.token_transactions enable row level security;
alter table public.ai_usage_logs enable row level security;

alter table public.token_purchase_intents enable row level security;

drop policy if exists "token_transactions_select_own" on public.token_transactions;
create policy "token_transactions_select_own" on public.token_transactions
  for select using (user_id = auth.uid());

drop policy if exists "ai_usage_logs_select_owner" on public.ai_usage_logs;
create policy "ai_usage_logs_select_owner" on public.ai_usage_logs
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = ai_usage_logs.organization_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create or replace function public.guard_profile_token_columns()
returns trigger
language plpgsql
as $$
declare
  allow_token_mutation text := current_setting('caspo.allow_token_mutation', true);
begin
  if allow_token_mutation = '1' or coalesce(auth.role(), '') in ('service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.token_balance, 0) <> 0
      or coalesce(new.has_used_trial, false) <> false
      or new.trial_granted_at is not null then
      raise exception 'token fields are write-protected';
    end if;
    return new;
  end if;

  if new.token_balance is distinct from old.token_balance
    or new.has_used_trial is distinct from old.has_used_trial
    or new.trial_granted_at is distinct from old.trial_granted_at then
    raise exception 'token fields are write-protected';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_token_columns on public.profiles;
create trigger profiles_guard_token_columns
before insert or update on public.profiles
for each row execute function public.guard_profile_token_columns();

drop function if exists public.consume_org_ai_credit(uuid, uuid, date, int, numeric);
drop function if exists public.increment_daily_credits(uuid, uuid, date, int, int);

create or replace function public.create_organization_with_trial(
  p_owner_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_join_code text,
  p_member_cap int,
  p_daily_ai_limit int
)
returns table(org_id uuid, join_code text, trial_granted boolean, token_balance int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_org_id uuid;
  already_used_trial boolean := false;
  granted_trial boolean := false;
  trial_tokens constant int := 2500;
  resulting_balance int := 0;
begin
  perform set_config('caspo.allow_token_mutation', '1', true);

  insert into public.profiles (id, token_balance, has_used_trial, updated_at)
  values (p_owner_id, 0, false, now())
  on conflict (id) do nothing;

  select coalesce(p.has_used_trial, false)
  into already_used_trial
  from public.profiles p
  where p.id = p_owner_id
  for update;

  insert into public.orgs (
    name,
    join_code,
    category,
    description,
    created_by,
    owner_id,
    member_cap,
    daily_ai_limit,
    updated_at
  )
  values (
    p_name,
    p_join_code,
    p_category,
    p_description,
    p_owner_id,
    p_owner_id,
    greatest(p_member_cap, 0),
    greatest(p_daily_ai_limit, 0),
    now()
  )
  returning id into new_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (p_owner_id, new_org_id, 'owner')
  on conflict do nothing;

  if not already_used_trial then
    granted_trial := true;

    update public.profiles
    set has_used_trial = true,
        trial_granted_at = coalesce(trial_granted_at, now()),
        updated_at = now()
    where id = p_owner_id;

    update public.orgs
    set token_balance = token_balance + trial_tokens
    where id = new_org_id;

    insert into public.token_transactions (
      user_id,
      organization_id,
      actor_user_id,
      type,
      amount,
      balance_after,
      description,
      metadata
    )
    values (
      p_owner_id,
      new_org_id,
      p_owner_id,
      'trial',
      trial_tokens,
      trial_tokens,
      'First organization trial tokens',
      jsonb_build_object('trial_tokens', trial_tokens)
    );
  end if;

  select token_balance into resulting_balance
  from public.orgs
  where id = new_org_id;

  return query
    select new_org_id, p_join_code, granted_trial, coalesce(resulting_balance, 0);
end;
$$;

create or replace function public.consume_owner_token_for_org_ai(
  p_org_id uuid,
  p_user_id uuid,
  p_usage_date date
)
returns table(success boolean, reason text, used_today int, remaining_today int, remaining_tokens int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org_owner_id uuid;
  daily_limit int := 0;
  current_balance int := 0;
  updated_requests int := 0;
begin
  perform set_config('caspo.allow_token_mutation', '1', true);

  select owner_id, coalesce(daily_ai_limit, 0), coalesce(token_balance, 0)
  into org_owner_id, daily_limit, current_balance
  from public.orgs
  where id = p_org_id
  for update;

  if org_owner_id is null then
    return query select false, 'org_not_found', 0, 0, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.memberships
    where org_id = p_org_id and user_id = p_user_id
  ) then
    return query select false, 'not_member', 0, 0, 0;
    return;
  end if;

  if current_balance <= 0 then
    select coalesce(request_count, 0)
    into updated_requests
    from public.org_usage_daily
    where org_id = p_org_id
      and user_id = p_user_id
      and usage_date = p_usage_date;

    return query
      select false, 'insufficient_tokens', coalesce(updated_requests, 0), greatest(daily_limit - coalesce(updated_requests, 0), 0), 0;
    return;
  end if;

  if daily_limit <= 0 then
    return query select false, 'daily_limit_reached', 0, 0, current_balance;
    return;
  end if;

  insert into public.org_usage_daily (org_id, user_id, usage_date, request_count)
  values (p_org_id, p_user_id, p_usage_date, 1)
  on conflict (org_id, user_id, usage_date) do update
    set request_count = public.org_usage_daily.request_count + 1,
        updated_at = now()
    where public.org_usage_daily.request_count + 1 <= daily_limit
  returning request_count into updated_requests;

  if not found then
    select coalesce(request_count, 0)
    into updated_requests
    from public.org_usage_daily
    where org_id = p_org_id
      and user_id = p_user_id
      and usage_date = p_usage_date;

    return query
      select false, 'daily_limit_reached', coalesce(updated_requests, 0), greatest(daily_limit - coalesce(updated_requests, 0), 0), current_balance;
    return;
  end if;

  update public.orgs
  set token_balance = token_balance - 1,
      updated_at = now()
  where id = p_org_id
  returning token_balance into current_balance;

  insert into public.ai_usage_logs (
    organization_id,
    user_id,
    owner_user_id,
    request_count,
    tokens_charged
  )
  values (
    p_org_id,
    p_user_id,
    org_owner_id,
    1,
    1
  );

  insert into public.token_transactions (
    user_id,
    organization_id,
    actor_user_id,
    type,
    amount,
    balance_after,
    description,
    metadata
  )
  values (
    org_owner_id,
    p_org_id,
    p_user_id,
    'usage',
    -1,
    current_balance,
    'AI request token charge',
    jsonb_build_object('usage_date', p_usage_date, 'request_count', 1)
  );

  return query
    select true, 'ok', updated_requests, greatest(daily_limit - updated_requests, 0), current_balance;
end;
$$;

create or replace function public.get_org_token_stats(
  p_org_id uuid
)
returns table(tokens_purchased int, tokens_used int)
language sql
security definer
set search_path = public, pg_temp
as $$
select
  coalesce((select sum(tokens_granted) from public.token_purchase_grants where org_id = p_org_id), 0),
  coalesce(-(select sum(amount) from public.token_transactions where organization_id = p_org_id and type = 'usage'), 0);
$$;

revoke all on function public.get_org_token_stats(uuid) from public;
grant execute on function public.get_org_token_stats(uuid) to service_role;

revoke all on function public.create_organization_with_trial(uuid, text, text, text, text, int, int) from public;
revoke all on function public.consume_owner_token_for_org_ai(uuid, uuid, date) from public;
