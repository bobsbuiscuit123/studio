create or replace function public.join_org(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org_id uuid;
begin
  select id into target_org_id
  from public.orgs
  where orgs.join_code = p_join_code;
  if target_org_id is null then
    raise exception 'Org not found';
  end if;

  insert into public.memberships (user_id, org_id, role)
  values (auth.uid(), target_org_id, 'member')
  on conflict do nothing;

  return target_org_id;
end;
$$;

grant execute on function public.join_org(text) to authenticated;
