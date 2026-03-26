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
  trial_tokens constant int := 30;
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

revoke all on function public.create_organization_with_trial(uuid, text, text, text, text, int, int) from public;
