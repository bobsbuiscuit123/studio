alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  add column if not exists subscribed_org_id uuid;

alter table public.profiles
  add column if not exists active_subscription_product_id text;

alter table public.profiles
  add column if not exists subscription_status text not null default 'free';

alter table public.profiles
  add column if not exists subscription_current_period_start timestamptz;

alter table public.profiles
  add column if not exists subscription_current_period_end timestamptz;

alter table public.profiles
  add column if not exists subscription_will_renew boolean not null default false;

alter table public.profiles
  add column if not exists subscription_billing_issue_detected_at timestamptz;

alter table public.profiles
  add column if not exists subscription_grace_period_expires_at timestamptz;

alter table public.profiles
  add column if not exists subscription_updated_at timestamptz;

alter table public.profiles
  add column if not exists has_received_org_creation_bonus boolean not null default false;

alter table public.profiles
  add column if not exists org_creation_bonus_granted_at timestamptz;

alter table public.orgs
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

alter table public.orgs
  add column if not exists updated_at timestamptz not null default now();

update public.orgs
set owner_id = created_by
where owner_id is null
  and created_by is not null;

alter table public.orgs
  add column if not exists subscription_product_id text;

alter table public.orgs
  add column if not exists subscription_status text not null default 'free';

alter table public.orgs
  add column if not exists monthly_token_limit integer not null default 0;

alter table public.orgs
  add column if not exists tokens_used_this_period integer not null default 0;

alter table public.orgs
  add column if not exists current_period_start timestamptz;

alter table public.orgs
  add column if not exists current_period_end timestamptz;

alter table public.orgs
  add column if not exists bonus_tokens_this_period integer not null default 0;

alter table public.orgs
  add column if not exists ai_enabled boolean not null default false;

alter table public.orgs
  add column if not exists usage_estimate_members integer not null default 0;

alter table public.orgs
  add column if not exists usage_estimate_requests_per_member integer not null default 0;

alter table public.orgs
  add column if not exists usage_estimate_monthly_tokens integer not null default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'has_used_trial'
  ) then
    update public.profiles
    set has_received_org_creation_bonus = true,
        org_creation_bonus_granted_at = coalesce(org_creation_bonus_granted_at, trial_granted_at),
        updated_at = now()
    where coalesce(has_used_trial, false) = true;
  end if;
end $$;

update public.profiles p
set has_received_org_creation_bonus = true,
    updated_at = now()
where coalesce(has_received_org_creation_bonus, false) = false
  and exists (
    select 1
    from public.orgs o
    where o.owner_id = p.id
  );

create table if not exists public.processed_webhooks (
  id text primary key,
  processed_at timestamptz not null default now()
);

create table if not exists public.org_creation_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text,
  description text,
  selected_plan_id text not null default 'free',
  creation_mode text not null default 'free',
  usage_estimate_members integer not null default 0,
  usage_estimate_requests_per_member integer not null default 0,
  usage_estimate_monthly_tokens integer not null default 0,
  status text not null default 'draft',
  finalized_org_id uuid references public.orgs(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_creation_drafts_owner_updated_at
  on public.org_creation_drafts(owner_id, updated_at desc);

create unique index if not exists idx_org_creation_drafts_owner_idempotency
  on public.org_creation_drafts(owner_id, idempotency_key)
  where idempotency_key is not null;

alter table public.org_creation_drafts enable row level security;

drop policy if exists "org_creation_drafts_select_own" on public.org_creation_drafts;
create policy "org_creation_drafts_select_own" on public.org_creation_drafts
  for select using (owner_id = auth.uid());

drop policy if exists "org_creation_drafts_insert_own" on public.org_creation_drafts;
create policy "org_creation_drafts_insert_own" on public.org_creation_drafts
  for insert with check (owner_id = auth.uid());

drop policy if exists "org_creation_drafts_update_own" on public.org_creation_drafts;
create policy "org_creation_drafts_update_own" on public.org_creation_drafts
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "org_creation_drafts_delete_own" on public.org_creation_drafts;
create policy "org_creation_drafts_delete_own" on public.org_creation_drafts
  for delete using (owner_id = auth.uid());

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'profiles'
      and constraint_name = 'profiles_subscribed_org_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_subscribed_org_id_fkey
      foreign key (subscribed_org_id)
      references public.orgs(id)
      on delete set null;
  end if;
end $$;

do $$
declare
  constraint_exists boolean;
begin
  select exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'orgs'
      and constraint_name = 'orgs_subscription_product_id_check'
  ) into constraint_exists;

  if not constraint_exists then
    alter table public.orgs
      add constraint orgs_subscription_product_id_check
      check (
        subscription_product_id is null
        or subscription_product_id in ('starter_org', 'basic_org', 'growth_org', 'pro_org', 'elite_org')
      );
  end if;
end $$;

do $$
declare
  constraint_exists boolean;
begin
  select exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'orgs'
      and constraint_name = 'orgs_monthly_token_limit_check'
  ) into constraint_exists;

  if not constraint_exists then
    alter table public.orgs
      add constraint orgs_monthly_token_limit_check
      check (monthly_token_limit >= 0);
  end if;
end $$;

do $$
declare
  constraint_exists boolean;
begin
  select exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'orgs'
      and constraint_name = 'orgs_tokens_used_this_period_check'
  ) into constraint_exists;

  if not constraint_exists then
    alter table public.orgs
      add constraint orgs_tokens_used_this_period_check
      check (tokens_used_this_period >= 0);
  end if;
end $$;

do $$
declare
  constraint_exists boolean;
begin
  select exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'orgs'
      and constraint_name = 'orgs_bonus_tokens_this_period_check'
  ) into constraint_exists;

  if not constraint_exists then
    alter table public.orgs
      add constraint orgs_bonus_tokens_this_period_check
      check (bonus_tokens_this_period >= 0);
  end if;
end $$;

do $$
declare
  constraint_exists boolean;
begin
  select exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'orgs'
      and constraint_name = 'orgs_current_period_window_check'
  ) into constraint_exists;

  if not constraint_exists then
    alter table public.orgs
      add constraint orgs_current_period_window_check
      check (
        current_period_start is null
        or current_period_end is null
        or current_period_start <= current_period_end
      );
  end if;
end $$;

create or replace function public.subscription_product_monthly_limit(p_product_id text)
returns integer
language sql
immutable
as $$
  select case coalesce(p_product_id, '')
    when 'starter_org' then 2200
    when 'basic_org' then 6000
    when 'growth_org' then 12500
    when 'pro_org' then 28000
    when 'elite_org' then 65000
    else 0
  end;
$$;

create or replace function public.validate_profile_subscribed_org()
returns trigger
language plpgsql
as $$
declare
  target_owner_id uuid;
  target_subscription_product_id text;
begin
  if new.subscribed_org_id is null then
    return new;
  end if;

  select owner_id, subscription_product_id
  into target_owner_id, target_subscription_product_id
  from public.orgs
  where id = new.subscribed_org_id;

  if target_owner_id is null then
    raise exception 'subscribed_org_id must reference an existing organization';
  end if;

  if target_owner_id <> new.id then
    raise exception 'subscribed_org_id must reference an organization owned by the same user';
  end if;

  if target_subscription_product_id is null then
    raise exception 'subscribed_org_id must reference a paid organization';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_validate_subscribed_org on public.profiles;
create constraint trigger profiles_validate_subscribed_org
after insert or update of subscribed_org_id on public.profiles
deferrable initially deferred
for each row execute function public.validate_profile_subscribed_org();

with ranked_paid_orgs as (
  select
    o.id,
    row_number() over (
      partition by o.owner_id
      order by
        case when p.subscribed_org_id = o.id then 0 else 1 end,
        o.updated_at desc nulls last,
        o.created_at desc nulls last,
        o.id
    ) as rn
  from public.orgs o
  left join public.profiles p on p.id = o.owner_id
  where o.owner_id is not null
    and o.subscription_product_id is not null
)
update public.orgs o
set subscription_product_id = null,
    subscription_status = 'free',
    monthly_token_limit = 0,
    tokens_used_this_period = 0,
    bonus_tokens_this_period = 0,
    ai_enabled = false,
    updated_at = now()
from ranked_paid_orgs r
where o.id = r.id
  and r.rn > 1;

create unique index if not exists one_paid_org_per_user
  on public.orgs (owner_id)
  where subscription_product_id is not null;

create or replace function public.refresh_org_subscription_period(p_org_id uuid)
returns table(
  org_id uuid,
  subscription_product_id text,
  subscription_status text,
  monthly_token_limit integer,
  bonus_tokens_this_period integer,
  tokens_used_this_period integer,
  effective_available_tokens integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  ai_enabled boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org_row public.orgs%rowtype;
  next_start timestamptz;
  next_end timestamptz;
  next_limit integer;
  next_bonus integer;
  next_used integer;
  next_ai_enabled boolean;
  next_effective_tokens integer;
begin
  select *
  into org_row
  from public.orgs
  where id = p_org_id
  for update;

  if not found then
    return;
  end if;

  next_start := coalesce(org_row.current_period_start, now());
  next_end := coalesce(org_row.current_period_end, next_start + interval '1 month');

  if next_end <= next_start then
    next_end := next_start + interval '1 month';
  end if;

  next_limit := case
    when org_row.subscription_product_id is null then 0
    else public.subscription_product_monthly_limit(org_row.subscription_product_id)
  end;

  next_bonus := case
    when org_row.subscription_product_id is null then greatest(coalesce(org_row.bonus_tokens_this_period, 0), 0)
    else 0
  end;

  next_used := greatest(coalesce(org_row.tokens_used_this_period, 0), 0);

  if now() > next_end then
    while now() > next_end loop
      next_start := next_end;
      next_end := next_start + interval '1 month';
    end loop;

    next_used := 0;
    if org_row.subscription_product_id is null then
      next_limit := 0;
      next_bonus := 0;
    else
      next_limit := public.subscription_product_monthly_limit(org_row.subscription_product_id);
      next_bonus := 0;
    end if;
  end if;

  next_effective_tokens := greatest(next_limit + next_bonus - next_used, 0);
  next_ai_enabled := next_effective_tokens > 0;

  update public.orgs
  set subscription_status = case
        when public.orgs.subscription_product_id is null then 'free'
        else public.orgs.subscription_status
      end,
      monthly_token_limit = next_limit,
      bonus_tokens_this_period = next_bonus,
      tokens_used_this_period = next_used,
      current_period_start = next_start,
      current_period_end = next_end,
      ai_enabled = next_ai_enabled,
      updated_at = now()
  where id = p_org_id;

  return query
  select
    p_org_id,
    org_row.subscription_product_id,
    case
      when org_row.subscription_product_id is null then 'free'
      else org_row.subscription_status
    end,
    next_limit,
    next_bonus,
    next_used,
    next_effective_tokens,
    next_start,
    next_end,
    next_ai_enabled;
end;
$$;

create or replace function public.sync_user_subscription_state(
  p_user_id uuid,
  p_active_product_id text default null,
  p_subscription_status text default 'free',
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_will_renew boolean default false,
  p_billing_issue_detected_at timestamptz default null,
  p_grace_period_expires_at timestamptz default null,
  p_target_org_id uuid default null
)
returns table(
  subscribed_org_id uuid,
  active_subscription_product_id text,
  subscription_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  resolved_target_org_id uuid := p_target_org_id;
  resolved_product_id text := nullif(p_active_product_id, '');
  resolved_status text := coalesce(nullif(p_subscription_status, ''), 'free');
  resolved_limit integer := public.subscription_product_monthly_limit(resolved_product_id);
  owner_org_count integer := 0;
  paid_period_changed boolean := false;
  existing_org public.orgs%rowtype;
begin
  insert into public.profiles (
    id,
    subscription_status,
    subscription_will_renew,
    has_received_org_creation_bonus,
    updated_at
  )
  values (
    p_user_id,
    'free',
    false,
    false,
    now()
  )
  on conflict (id) do nothing;

  select *
  into profile_row
  from public.profiles
  where id = p_user_id
  for update;

  perform 1
  from public.orgs
  where owner_id = p_user_id
  for update;

  select count(*)
  into owner_org_count
  from public.orgs
  where owner_id = p_user_id;

  if resolved_product_id is null or resolved_limit <= 0 or resolved_status in ('free', 'expired', 'cancelled') then
    update public.orgs
    set subscription_product_id = null,
        subscription_status = 'free',
        monthly_token_limit = 0,
        tokens_used_this_period = 0,
        bonus_tokens_this_period = 0,
        ai_enabled = false,
        updated_at = now()
    where owner_id = p_user_id
      and subscription_product_id is not null;

    update public.profiles
    set subscribed_org_id = null,
        active_subscription_product_id = null,
        subscription_status = case
          when resolved_status in ('expired', 'cancelled') then resolved_status
          else 'free'
        end,
        subscription_current_period_start = p_period_start,
        subscription_current_period_end = p_period_end,
        subscription_will_renew = false,
        subscription_billing_issue_detected_at = p_billing_issue_detected_at,
        subscription_grace_period_expires_at = p_grace_period_expires_at,
        subscription_updated_at = now(),
        updated_at = now()
    where id = p_user_id;

    return query
    select null::uuid, null::text, case
      when resolved_status in ('expired', 'cancelled') then resolved_status
      else 'free'
    end;
    return;
  end if;

  if resolved_target_org_id is null then
    resolved_target_org_id := profile_row.subscribed_org_id;
  end if;

  if resolved_target_org_id is null and owner_org_count = 1 then
    select id
    into resolved_target_org_id
    from public.orgs
    where owner_id = p_user_id
    limit 1;
  end if;

  if resolved_target_org_id is not null then
    select *
    into existing_org
    from public.orgs
    where id = resolved_target_org_id
      and owner_id = p_user_id
    for update;

    if not found then
      raise exception 'target_org_not_owned';
    end if;
  end if;

  update public.orgs
  set subscription_product_id = null,
      subscription_status = 'free',
      monthly_token_limit = 0,
      tokens_used_this_period = 0,
      bonus_tokens_this_period = 0,
      ai_enabled = false,
      updated_at = now()
  where owner_id = p_user_id
    and subscription_product_id is not null
    and (resolved_target_org_id is null or id <> resolved_target_org_id);

  if resolved_target_org_id is not null then
    paid_period_changed :=
      existing_org.current_period_start is distinct from coalesce(p_period_start, existing_org.current_period_start)
      or existing_org.current_period_end is distinct from coalesce(p_period_end, existing_org.current_period_end);

    update public.orgs
    set subscription_product_id = resolved_product_id,
        subscription_status = resolved_status,
        monthly_token_limit = resolved_limit,
        bonus_tokens_this_period = 0,
        tokens_used_this_period = case
          when paid_period_changed then 0
          else greatest(coalesce(tokens_used_this_period, 0), 0)
        end,
        current_period_start = coalesce(p_period_start, current_period_start, now()),
        current_period_end = coalesce(p_period_end, current_period_end, coalesce(p_period_start, now()) + interval '1 month'),
        ai_enabled = greatest(
          resolved_limit - case
            when paid_period_changed then 0
            else greatest(coalesce(tokens_used_this_period, 0), 0)
          end,
          0
        ) > 0,
        updated_at = now()
    where id = resolved_target_org_id
      and owner_id = p_user_id;
  end if;

  update public.profiles
  set subscribed_org_id = resolved_target_org_id,
      active_subscription_product_id = resolved_product_id,
      subscription_status = case
        when resolved_target_org_id is null then 'unassigned'
        else resolved_status
      end,
      subscription_current_period_start = p_period_start,
      subscription_current_period_end = p_period_end,
      subscription_will_renew = coalesce(p_will_renew, false),
      subscription_billing_issue_detected_at = p_billing_issue_detected_at,
      subscription_grace_period_expires_at = p_grace_period_expires_at,
      subscription_updated_at = now(),
      updated_at = now()
  where id = p_user_id;

  return query
  select
    resolved_target_org_id,
    resolved_product_id,
    case
      when resolved_target_org_id is null then 'unassigned'
      else resolved_status
    end;
end;
$$;

create or replace function public.finalize_org_creation_from_draft(
  p_draft_id uuid,
  p_user_id uuid,
  p_creation_mode text default null,
  p_verified_product_id text default null
)
returns table(
  org_id uuid,
  join_code text,
  plan_id text,
  subscription_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  draft_row public.org_creation_drafts%rowtype;
  profile_row public.profiles%rowtype;
  created_org public.orgs%rowtype;
  owner_org_count integer := 0;
  resolved_mode text;
  resolved_plan_id text;
  assigned_product_id text;
  generated_join_code text;
  trial_bonus integer := 0;
  paid_sync_result record;
begin
  select *
  into draft_row
  from public.org_creation_drafts
  where id = p_draft_id
    and owner_id = p_user_id
  for update;

  if not found then
    raise exception 'draft_not_found';
  end if;

  if draft_row.finalized_org_id is not null then
    return query
    select
      draft_row.finalized_org_id,
      (select o.join_code from public.orgs o where o.id = draft_row.finalized_org_id),
      coalesce(draft_row.selected_plan_id, 'free'),
      coalesce((select o.subscription_status from public.orgs o where o.id = draft_row.finalized_org_id), 'free');
    return;
  end if;

  insert into public.profiles (
    id,
    subscription_status,
    subscription_will_renew,
    has_received_org_creation_bonus,
    updated_at
  )
  values (
    p_user_id,
    'free',
    false,
    false,
    now()
  )
  on conflict (id) do nothing;

  select *
  into profile_row
  from public.profiles
  where id = p_user_id
  for update;

  perform 1
  from public.orgs
  where owner_id = p_user_id
  for update;

  select count(*)
  into owner_org_count
  from public.orgs
  where owner_id = p_user_id;

  resolved_plan_id := coalesce(nullif(draft_row.selected_plan_id, ''), 'free');
  resolved_mode := coalesce(nullif(p_creation_mode, ''), nullif(draft_row.creation_mode, ''), case
    when resolved_plan_id = 'free' then 'free'
    else 'purchase'
  end);

  if resolved_mode in ('purchase', 'transfer_subscription') then
    assigned_product_id := coalesce(nullif(profile_row.active_subscription_product_id, ''), nullif(p_verified_product_id, ''));

    if assigned_product_id is null then
      raise exception 'purchase_not_synced';
    end if;
  else
    assigned_product_id := null;
  end if;

  loop
    generated_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1
      from public.orgs
      where join_code = generated_join_code
    );
  end loop;

  insert into public.orgs (
    name,
    join_code,
    category,
    description,
    created_by,
    owner_id,
    subscription_product_id,
    subscription_status,
    monthly_token_limit,
    tokens_used_this_period,
    current_period_start,
    current_period_end,
    bonus_tokens_this_period,
    ai_enabled,
    usage_estimate_members,
    usage_estimate_requests_per_member,
    usage_estimate_monthly_tokens,
    updated_at
  )
  values (
    draft_row.name,
    generated_join_code,
    draft_row.category,
    draft_row.description,
    p_user_id,
    p_user_id,
    null,
    'free',
    0,
    0,
    now(),
    now() + interval '1 month',
    0,
    false,
    greatest(coalesce(draft_row.usage_estimate_members, 0), 0),
    greatest(coalesce(draft_row.usage_estimate_requests_per_member, 0), 0),
    greatest(coalesce(draft_row.usage_estimate_monthly_tokens, 0), 0),
    now()
  )
  returning *
  into created_org;

  insert into public.memberships (user_id, org_id, role)
  values (p_user_id, created_org.id, 'owner')
  on conflict do nothing;

  if resolved_mode in ('purchase', 'transfer_subscription') then
    if owner_org_count = 0 and coalesce(profile_row.has_received_org_creation_bonus, false) = false then
      update public.profiles
      set has_received_org_creation_bonus = true,
          updated_at = now()
      where id = p_user_id;
    end if;

    select *
    into paid_sync_result
    from public.sync_user_subscription_state(
      p_user_id,
      assigned_product_id,
      case
        when coalesce(nullif(profile_row.subscription_status, ''), 'free') in ('free', 'expired', 'cancelled', 'unassigned')
          then 'active'
        else profile_row.subscription_status
      end,
      coalesce(profile_row.subscription_current_period_start, now()),
      coalesce(profile_row.subscription_current_period_end, now() + interval '1 month'),
      coalesce(profile_row.subscription_will_renew, true),
      profile_row.subscription_billing_issue_detected_at,
      profile_row.subscription_grace_period_expires_at,
      created_org.id
    );

    update public.org_creation_drafts
    set finalized_org_id = created_org.id,
        status = 'finalized',
        updated_at = now()
    where id = p_draft_id;

    return query
    select created_org.id, generated_join_code, assigned_product_id, coalesce(paid_sync_result.subscription_status, 'active');
    return;
  end if;

  if owner_org_count = 0 and coalesce(profile_row.has_received_org_creation_bonus, false) = false then
    trial_bonus := 30;
    update public.profiles
    set has_received_org_creation_bonus = true,
        org_creation_bonus_granted_at = coalesce(org_creation_bonus_granted_at, now()),
        updated_at = now()
    where id = p_user_id;
  end if;

  update public.orgs
  set subscription_product_id = null,
      subscription_status = 'free',
      monthly_token_limit = 0,
      tokens_used_this_period = 0,
      current_period_start = now(),
      current_period_end = now() + interval '1 month',
      bonus_tokens_this_period = trial_bonus,
      ai_enabled = trial_bonus > 0,
      updated_at = now()
  where id = created_org.id;

  update public.org_creation_drafts
  set finalized_org_id = created_org.id,
      status = 'finalized',
      updated_at = now()
  where id = p_draft_id;

  return query
  select created_org.id, generated_join_code, 'free'::text, 'free'::text;
end;
$$;

create or replace function public.claim_processed_webhook_and_sync_subscription(
  p_event_id text,
  p_user_id uuid,
  p_active_product_id text default null,
  p_subscription_status text default 'free',
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_will_renew boolean default false,
  p_billing_issue_detected_at timestamptz default null,
  p_grace_period_expires_at timestamptz default null,
  p_target_org_id uuid default null
)
returns table(
  already_processed boolean,
  subscribed_org_id uuid,
  active_subscription_product_id text,
  subscription_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'missing_webhook_event_id';
  end if;

  insert into public.processed_webhooks (id)
  values (p_event_id)
  on conflict do nothing;

  if not found then
    return query
    select true, null::uuid, null::text, null::text;
    return;
  end if;

  return query
  select
    false,
    sync_result.subscribed_org_id,
    sync_result.active_subscription_product_id,
    sync_result.subscription_status
  from public.sync_user_subscription_state(
    p_user_id,
    p_active_product_id,
    p_subscription_status,
    p_period_start,
    p_period_end,
    p_will_renew,
    p_billing_issue_detected_at,
    p_grace_period_expires_at,
    p_target_org_id
  ) as sync_result;
end;
$$;

create or replace function public.consume_org_subscription_token(
  p_org_id uuid,
  p_user_id uuid,
  p_usage_date date default current_date
)
returns table(
  success boolean,
  reason text,
  monthly_token_limit integer,
  bonus_tokens_this_period integer,
  tokens_used_this_period integer,
  effective_available_tokens integer,
  current_period_start timestamptz,
  current_period_end timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org_row public.orgs%rowtype;
begin
  perform *
  from public.refresh_org_subscription_period(p_org_id);

  update public.orgs
  set tokens_used_this_period = tokens_used_this_period + 1,
      ai_enabled = greatest(
        coalesce(monthly_token_limit, 0) + coalesce(bonus_tokens_this_period, 0) - (coalesce(tokens_used_this_period, 0) + 1),
        0
      ) > 0,
      updated_at = now()
  where id = p_org_id
    and exists (
      select 1
      from public.memberships
      where org_id = p_org_id
        and user_id = p_user_id
    )
    and (
      coalesce(monthly_token_limit, 0) +
      coalesce(bonus_tokens_this_period, 0) -
      coalesce(tokens_used_this_period, 0)
    ) > 0
  returning *
  into org_row;

  if not found then
    select *
    into org_row
    from public.orgs
    where id = p_org_id;

    if not found then
      return query
      select false, 'org_not_found', 0, 0, 0, 0, null::timestamptz, null::timestamptz;
      return;
    end if;

    if not exists (
      select 1
      from public.memberships
      where org_id = p_org_id
        and user_id = p_user_id
    ) then
      return query
      select false, 'not_member', org_row.monthly_token_limit, org_row.bonus_tokens_this_period, org_row.tokens_used_this_period,
        greatest(
          coalesce(org_row.monthly_token_limit, 0) +
          coalesce(org_row.bonus_tokens_this_period, 0) -
          coalesce(org_row.tokens_used_this_period, 0),
          0
        ),
        org_row.current_period_start,
        org_row.current_period_end;
      return;
    end if;

    return query
    select false, 'insufficient_tokens', org_row.monthly_token_limit, org_row.bonus_tokens_this_period, org_row.tokens_used_this_period,
      greatest(
        coalesce(org_row.monthly_token_limit, 0) +
        coalesce(org_row.bonus_tokens_this_period, 0) -
        coalesce(org_row.tokens_used_this_period, 0),
        0
      ),
      org_row.current_period_start,
      org_row.current_period_end;
    return;
  end if;

  insert into public.org_usage_daily (org_id, user_id, usage_date, request_count)
  values (p_org_id, p_user_id, p_usage_date, 1)
  on conflict (org_id, user_id, usage_date) do update
    set request_count = public.org_usage_daily.request_count + 1,
        updated_at = now();

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
    org_row.owner_id,
    1,
    1
  );

  return query
  select true, 'ok', org_row.monthly_token_limit, org_row.bonus_tokens_this_period, org_row.tokens_used_this_period,
    greatest(org_row.monthly_token_limit + org_row.bonus_tokens_this_period - org_row.tokens_used_this_period, 0),
    org_row.current_period_start,
    org_row.current_period_end;
end;
$$;

revoke all on function public.refresh_org_subscription_period(uuid) from public;
grant execute on function public.refresh_org_subscription_period(uuid) to service_role;

revoke all on function public.sync_user_subscription_state(uuid, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, uuid) from public;
grant execute on function public.sync_user_subscription_state(uuid, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, uuid) to service_role;

revoke all on function public.finalize_org_creation_from_draft(uuid, uuid, text, text) from public;
grant execute on function public.finalize_org_creation_from_draft(uuid, uuid, text, text) to service_role;

revoke all on function public.claim_processed_webhook_and_sync_subscription(text, uuid, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, uuid) from public;
grant execute on function public.claim_processed_webhook_and_sync_subscription(text, uuid, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, uuid) to service_role;

revoke all on function public.consume_org_subscription_token(uuid, uuid, date) from public;
grant execute on function public.consume_org_subscription_token(uuid, uuid, date) to service_role;

notify pgrst, 'reload schema';
