do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'stripe_customer_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'provider_customer_id'
  ) then
    alter table public.org_subscriptions
      rename column stripe_customer_id to provider_customer_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'stripe_subscription_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'provider_subscription_id'
  ) then
    alter table public.org_subscriptions
      rename column stripe_subscription_id to provider_subscription_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'stripe_price_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'provider_price_id'
  ) then
    alter table public.org_subscriptions
      rename column stripe_price_id to provider_price_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'checkout_session_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_subscriptions'
      and column_name = 'provider_checkout_id'
  ) then
    alter table public.org_subscriptions
      rename column checkout_session_id to provider_checkout_id;
  end if;
end $$;

alter table public.org_subscriptions
  add column if not exists payment_provider text;

alter table public.org_subscriptions
  alter column provider_customer_id drop not null;

update public.org_subscriptions
set payment_provider = 'iap'
where payment_provider is null or payment_provider = '';

update public.org_subscriptions
set status = 'active'
where status is null or status = '';

alter table public.org_subscriptions
  alter column payment_provider set default 'iap';

alter table public.org_subscriptions
  alter column payment_provider set not null;
