alter table public.profiles
  add column if not exists credit_balance numeric(12,3) not null default 0;

alter table public.orgs
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

alter table public.orgs
  add column if not exists member_limit int not null default 25;

alter table public.orgs
  add column if not exists ai_daily_limit_per_user int not null default 40;

alter table public.orgs
  add column if not exists credit_balance numeric(12,3) not null default 0;

alter table public.orgs
  add column if not exists updated_at timestamptz not null default now();

update public.orgs
set owner_user_id = created_by
where owner_user_id is null;

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.orgs(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('purchase', 'usage', 'adjustment', 'refund')),
  amount numeric(12,3) not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_transactions_org_created_at
  on public.credit_transactions(organization_id, created_at desc);

create index if not exists idx_credit_transactions_actor_created_at
  on public.credit_transactions(actor_user_id, created_at desc);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_count int not null default 1,
  credits_charged numeric(12,3) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_logs_org_created_at
  on public.ai_usage_logs(organization_id, created_at desc);

alter table public.credit_transactions enable row level security;
alter table public.ai_usage_logs enable row level security;

drop policy if exists "credit_transactions_select_owner" on public.credit_transactions;
create policy "credit_transactions_select_owner" on public.credit_transactions
  for select using (
    (
      organization_id is null and actor_user_id = auth.uid()
    ) or exists (
      select 1 from public.memberships m
      where m.org_id = credit_transactions.organization_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

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

create or replace function public.consume_org_ai_credit(
  p_org_id uuid,
  p_user_id uuid,
  p_usage_date date,
  p_daily_limit int,
  p_credit_cost numeric
)
returns table(success boolean, reason text, new_request_count int, remaining_balance numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_requests int;
  updated_balance numeric;
begin
  update public.orgs
  set credit_balance = credit_balance - p_credit_cost,
      updated_at = now()
  where id = p_org_id
    and coalesce(credit_balance, 0) >= p_credit_cost
  returning credit_balance into updated_balance;

  if not found then
    return query
      select false, 'insufficient_credits', 0, coalesce((select credit_balance from public.orgs where id = p_org_id), 0);
    return;
  end if;

  insert into public.org_usage_daily (org_id, user_id, usage_date, credits_used)
  values (p_org_id, p_user_id, p_usage_date, 1)
  on conflict (org_id, user_id, usage_date) do update
    set credits_used = public.org_usage_daily.credits_used + 1,
        updated_at = now()
    where public.org_usage_daily.credits_used + 1 <= p_daily_limit
  returning credits_used into updated_requests;

  if not found then
    update public.orgs
    set credit_balance = credit_balance + p_credit_cost,
        updated_at = now()
    where id = p_org_id;

    return query
      select false, 'daily_limit_reached', coalesce((
        select credits_used
        from public.org_usage_daily
        where org_id = p_org_id and user_id = p_user_id and usage_date = p_usage_date
      ), 0), coalesce((select credit_balance from public.orgs where id = p_org_id), 0);
    return;
  end if;

  insert into public.ai_usage_logs (organization_id, user_id, request_count, credits_charged)
  values (p_org_id, p_user_id, 1, p_credit_cost);

  insert into public.credit_transactions (
    organization_id,
    actor_user_id,
    type,
    amount,
    description,
    metadata
  )
  values (
    p_org_id,
    p_user_id,
    'usage',
    -p_credit_cost,
    'AI usage charge',
    jsonb_build_object('usage_date', p_usage_date, 'request_count', 1)
  );

  return query select true, 'ok', updated_requests, updated_balance;
end;
$$;
