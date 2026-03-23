create table if not exists public.token_purchase_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'revenuecat',
  provider_transaction_id text not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  product_id text not null,
  tokens_granted integer not null,
  environment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index if not exists idx_token_purchase_grants_user_created_at
  on public.token_purchase_grants(user_id, created_at desc);

create index if not exists idx_token_purchase_grants_product_created_at
  on public.token_purchase_grants(product_id, created_at desc);

create index if not exists idx_token_purchase_grants_org_created_at
  on public.token_purchase_grants(org_id, created_at desc);

alter table public.token_purchase_grants enable row level security;

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

  select owner_id, coalesce(token_balance, 0)
  into org_owner, current_balance
  from public.orgs
  where id = target_org_id
  for update;

  if org_owner is null then
    raise exception 'Organization not found for this purchase.';
  end if;

  if org_owner <> p_user_id then
    raise exception 'Only the organization owner can receive token purchases.';
  end if;

  select g.tokens_granted
  into existing_tokens
  from public.token_purchase_grants g
  where g.provider = normalized_provider
    and g.provider_transaction_id = p_provider_transaction_id;

  if found then
    return query
      select false, current_balance, existing_tokens;
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
      select false, current_balance, coalesce(existing_tokens, mapped_tokens);
    return;
  end if;

  update public.orgs
  set token_balance = current_balance + mapped_tokens,
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

revoke all on function public.grant_token_purchase(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.grant_token_purchase(uuid, text, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
