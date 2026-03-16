-- Add owner role to memberships
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner', 'admin', 'moderator', 'member'));

-- Billing plans
create table if not exists public.org_billing_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.orgs(id) on delete cascade,
  max_user_limit int not null check (max_user_limit >= 1),
  daily_credit_per_user int not null check (daily_credit_per_user >= 0),
  static_cost numeric(10,4) not null,
  variable_cost numeric(10,4) not null,
  multiplier numeric(10,4) not null default 1.5,
  retail_price numeric(10,2) not null,
  currency text not null default 'usd',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Generic billing subscriptions, ready for future IAP integration
create table if not exists public.org_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.orgs(id) on delete cascade,
  payment_provider text not null default 'iap',
  provider_customer_id text,
  provider_subscription_id text,
  provider_price_id text,
  provider_checkout_id text unique,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end bool not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Daily usage per org/user (UTC)
create table if not exists public.org_usage_daily (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  credits_used int not null default 0,
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, usage_date)
);

-- 24h cache for AI outputs
create table if not exists public.org_cache (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  cache_key text not null,
  input_hash text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (org_id, cache_key, input_hash)
);

create index if not exists idx_org_usage_daily_org_date
  on public.org_usage_daily(org_id, usage_date);
create index if not exists idx_org_cache_org_expires
  on public.org_cache(org_id, expires_at);

-- RLS
alter table public.org_billing_plans enable row level security;
alter table public.org_subscriptions enable row level security;
alter table public.org_usage_daily enable row level security;
alter table public.org_cache enable row level security;

-- Orgs policies (owner/admin manage)
drop policy if exists "orgs_select_members" on public.orgs;
create policy "orgs_select_members" on public.orgs
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = id and m.user_id = auth.uid()
    )
  );
drop policy if exists "orgs_update_admin_mod" on public.orgs;
create policy "orgs_update_owner_admin" on public.orgs
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Membership policies
drop policy if exists "memberships_select_own_or_admin" on public.memberships;
drop policy if exists "memberships_insert_admin" on public.memberships;
drop policy if exists "memberships_update_admin" on public.memberships;
drop policy if exists "memberships_delete_admin" on public.memberships;
create policy "memberships_select_members" on public.memberships
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
    )
  );
create policy "memberships_insert_owner_admin" on public.memberships
  for insert with check (
    exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );
create policy "memberships_update_owner" on public.memberships
  for update using (
    exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );
create policy "memberships_delete_owner_admin_or_self" on public.memberships
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.org_id = memberships.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Billing plan policies
drop policy if exists "org_billing_plans_select_owner_admin" on public.org_billing_plans;
create policy "org_billing_plans_select_owner_admin" on public.org_billing_plans
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = org_billing_plans.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Subscription policies
drop policy if exists "org_subscriptions_select_owner_admin" on public.org_subscriptions;
create policy "org_subscriptions_select_owner_admin" on public.org_subscriptions
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = org_subscriptions.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Usage policies (read own usage)
drop policy if exists "org_usage_daily_select_own" on public.org_usage_daily;
create policy "org_usage_daily_select_own" on public.org_usage_daily
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.org_id = org_usage_daily.org_id
        and m.user_id = auth.uid()
    )
  );

-- Cache policies (members read)
drop policy if exists "org_cache_select_members" on public.org_cache;
create policy "org_cache_select_members" on public.org_cache
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = org_cache.org_id
        and m.user_id = auth.uid()
    )
  );

-- Prevent direct org creation/join via RPC from clients
revoke execute on function public.create_org(text, text, text, text, text, text) from authenticated;
revoke execute on function public.join_org(text) from authenticated;

-- Atomic credit increment
create or replace function public.increment_daily_credits(
  p_org_id uuid,
  p_user_id uuid,
  p_usage_date date,
  p_increment_by int,
  p_daily_limit int
)
returns table(success boolean, new_value int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_value int;
begin
  insert into public.org_usage_daily (org_id, user_id, usage_date, credits_used)
  values (p_org_id, p_user_id, p_usage_date, p_increment_by)
  on conflict (org_id, user_id, usage_date) do update
    set credits_used = org_usage_daily.credits_used + p_increment_by,
        updated_at = now()
    where org_usage_daily.credits_used + p_increment_by <= p_daily_limit
  returning credits_used into updated_value;

  if found then
    return query select true, updated_value;
    return;
  end if;

  select credits_used into updated_value
  from public.org_usage_daily
  where org_id = p_org_id and user_id = p_user_id and usage_date = p_usage_date;

  return query select false, coalesce(updated_value, 0);
end;
$$;
