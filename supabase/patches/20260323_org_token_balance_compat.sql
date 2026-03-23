alter table public.orgs
  add column if not exists token_balance integer;

alter table public.orgs
  alter column token_balance set default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orgs'
      and column_name = 'credit_balance'
  ) then
    execute $sql$
      update public.orgs
      set token_balance = coalesce(token_balance, greatest(round(coalesce(credit_balance, 0)), 0)::int)
      where token_balance is null
    $sql$;
  else
    update public.orgs
    set token_balance = coalesce(token_balance, 0)
    where token_balance is null;
  end if;
end $$;

alter table public.orgs
  alter column token_balance set not null;
