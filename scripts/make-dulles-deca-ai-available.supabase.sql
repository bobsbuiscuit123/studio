-- Paste into Supabase SQL Editor to make Dulles HS DECA AI-enabled.
-- This targets the org by ID and moves that owner's single paid-org
-- assignment to this organization.

do $$
declare
  v_org_id uuid := '390987a6-ede3-499a-85c9-0af917e918a1';
  v_expected_name text := 'Dulles HS DECA';
  v_product_id text := 'basic_org';
  v_monthly_limit integer := 6000;
  v_owner_id uuid;
  v_org_name text;
  v_period_start timestamptz := now();
  v_period_end timestamptz := now() + interval '30 days';
begin
  select owner_id, name
  into v_owner_id, v_org_name
  from public.orgs
  where id = v_org_id
  limit 1;

  if v_owner_id is null then
    raise exception 'No org found with id %', v_org_id;
  end if;

  if v_org_name is distinct from v_expected_name then
    raise exception 'Org id % is named %, expected %', v_org_id, v_org_name, v_expected_name;
  end if;

  -- The schema allows only one paid org assignment per owner, so clear the
  -- paid plan from other orgs owned by this account before assigning this org.
  update public.orgs
  set
    subscription_product_id = null,
    subscription_status = 'free',
    monthly_token_limit = 0,
    tokens_used_this_period = 0,
    bonus_tokens_this_period = 0,
    ai_enabled = false,
    updated_at = now()
  where owner_id = v_owner_id
    and id <> v_org_id
    and subscription_product_id is not null;

  update public.orgs
  set
    subscription_product_id = v_product_id,
    subscription_status = 'active',
    monthly_token_limit = v_monthly_limit,
    tokens_used_this_period = 0,
    bonus_tokens_this_period = 0,
    current_period_start = v_period_start,
    current_period_end = v_period_end,
    ai_enabled = true,
    updated_at = now()
  where id = v_org_id;

  update public.profiles
  set
    subscribed_org_id = v_org_id,
    active_subscription_product_id = v_product_id,
    subscription_status = 'active',
    subscription_current_period_start = v_period_start,
    subscription_current_period_end = v_period_end,
    subscription_will_renew = true,
    subscription_billing_issue_detected_at = null,
    subscription_grace_period_expires_at = null,
    subscription_updated_at = now(),
    updated_at = now()
  where id = v_owner_id;

  raise notice 'AI enabled for %. Org id: %, plan: %, monthly tokens: %', v_org_name, v_org_id, v_product_id, v_monthly_limit;
end $$;

select
  id,
  name,
  subscription_product_id,
  subscription_status,
  monthly_token_limit,
  tokens_used_this_period,
  bonus_tokens_this_period,
  ai_enabled,
  current_period_start,
  current_period_end
from public.orgs
where id = '390987a6-ede3-499a-85c9-0af917e918a1';
