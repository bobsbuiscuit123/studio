update public.orgs
set token_balance = greatest(round(coalesce(credit_balance, 0)), 0)::int
where coalesce(token_balance, 0) <= 0
  and coalesce(credit_balance, 0) > 0;

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
  legacy_balance int := 0;
  effective_balance int := 0;
  updated_requests int := 0;
begin
  perform set_config('caspo.allow_token_mutation', '1', true);

  select
    owner_id,
    coalesce(daily_ai_limit, 0),
    coalesce(token_balance, 0),
    greatest(round(coalesce(credit_balance, 0)), 0)::int
  into org_owner_id, daily_limit, current_balance, legacy_balance
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

  effective_balance := case
    when current_balance > 0 then current_balance
    when legacy_balance > 0 then legacy_balance
    else current_balance
  end;

  if effective_balance <= 0 then
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
    return query select false, 'daily_limit_reached', 0, 0, effective_balance;
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
      select false, 'daily_limit_reached', coalesce(updated_requests, 0), greatest(daily_limit - coalesce(updated_requests, 0), 0), effective_balance;
    return;
  end if;

  update public.orgs
  set token_balance = effective_balance - 1,
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

create or replace function public.grant_token_purchase(
  p_user_id uuid,
  p_product_id text,
  p_provider_transaction_id text,
  p_provider text default 'revenuecat',
  p_environment text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_org_id uuid default null
)
returns table(granted boolean, token_balance integer, tokens_granted integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_balance integer := 0;
  legacy_balance integer := 0;
  effective_balance integer := 0;
  mapped_tokens integer := 0;
  existing_tokens integer := 0;
  normalized_provider text := coalesce(nullif(p_provider, ''), 'revenuecat');
  target_org_id uuid := p_org_id;
  org_owner uuid;
begin
  perform set_config('caspo.allow_token_mutation', '1', true);

  if p_user_id is null then
    raise exception 'Missing user id for token purchase grant.';
  end if;

  if p_provider_transaction_id is null or btrim(p_provider_transaction_id) = '' then
    raise exception 'Missing provider transaction id for token purchase grant.';
  end if;

  mapped_tokens := case p_product_id
    when 'tokens_basic' then 2200
    when 'tokens_growth' then 6000
    when 'tokens_pro' then 12500
    when 'tokens_scale' then 28000
    when 'tokens_enterprise' then 65000
    else 0
  end;

  if mapped_tokens <= 0 then
    raise exception 'Unknown token product id: %', p_product_id;
  end if;

  if target_org_id is null then
    select org_id
    into target_org_id
    from public.token_purchase_intents
    where provider = normalized_provider
      and provider_transaction_id = p_provider_transaction_id
    limit 1;
  end if;

  if target_org_id is null then
    raise exception 'Missing organization for token purchase grant.';
  end if;

  select
    owner_id,
    coalesce(token_balance, 0),
    greatest(round(coalesce(credit_balance, 0)), 0)::int
  into org_owner, current_balance, legacy_balance
  from public.orgs
  where id = target_org_id
  for update;

  if org_owner is null then
    raise exception 'Organization not found for this purchase.';
  end if;

  if org_owner <> p_user_id then
    raise exception 'Only the organization owner can receive token purchases.';
  end if;

  effective_balance := case
    when current_balance > 0 then current_balance
    when legacy_balance > 0 then legacy_balance
    else current_balance
  end;

  select g.tokens_granted
  into existing_tokens
  from public.token_purchase_grants g
  where g.provider = normalized_provider
    and g.provider_transaction_id = p_provider_transaction_id;

  if found then
    return query
      select false, effective_balance, existing_tokens;
    return;
  end if;

  insert into public.token_purchase_grants (
    user_id,
    provider,
    provider_transaction_id,
    product_id,
    tokens_granted,
    org_id,
    environment,
    metadata
  )
  values (
    p_user_id,
    normalized_provider,
    p_provider_transaction_id,
    p_product_id,
    mapped_tokens,
    target_org_id,
    p_environment,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, provider_transaction_id) do nothing;

  if not found then
    select g.tokens_granted
    into existing_tokens
    from public.token_purchase_grants g
    where g.provider = normalized_provider
      and g.provider_transaction_id = p_provider_transaction_id;

    return query
      select false, effective_balance, coalesce(existing_tokens, mapped_tokens);
    return;
  end if;

  update public.orgs
  set token_balance = effective_balance + mapped_tokens,
      updated_at = now()
  where id = target_org_id
  returning token_balance into current_balance;

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
    p_user_id,
    target_org_id,
    p_user_id,
    'purchase',
    mapped_tokens,
    current_balance,
    'Apple token purchase',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'provider', normalized_provider,
      'provider_transaction_id', p_provider_transaction_id,
      'product_id', p_product_id,
      'environment', p_environment,
      'organization_id', target_org_id
    )
  );

  return query
    select true, current_balance, mapped_tokens;
end;
$$;

revoke all on function public.consume_owner_token_for_org_ai(uuid, uuid, date) from public;
grant execute on function public.consume_owner_token_for_org_ai(uuid, uuid, date) to service_role;

revoke all on function public.grant_token_purchase(uuid, text, text, text, text, jsonb, uuid) from public;
grant execute on function public.grant_token_purchase(uuid, text, text, text, text, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
