-- Paste into Supabase SQL Editor to make the HopeLink org AI-enabled.
-- This targets the HopeLink org by join code and moves that owner's single
-- paid-org assignment to HopeLink.

do $$
declare
  v_org_join_code text := 'HPLINK';
  v_product_id text := 'basic_org';
  v_monthly_limit integer := 6000;
  v_owner_id uuid;
  v_org_id uuid;
  v_period_start timestamptz := now();
  v_period_end timestamptz := now() + interval '30 days';
begin
  select id, owner_id
  into v_org_id, v_owner_id
  from public.orgs
  where join_code = v_org_join_code
  order by created_at desc
  limit 1;

  if v_org_id is null then
    raise exception 'No HopeLink org with join code % found', v_org_join_code;
  end if;

  if v_owner_id is null then
    raise exception 'HopeLink org % has no owner_id set', v_org_id;
  end if;

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

  raise notice 'AI enabled for HopeLink. Org id: %, join code: %, plan: %, monthly tokens: %', v_org_id, v_org_join_code, v_product_id, v_monthly_limit;
end $$;
