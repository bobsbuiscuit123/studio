-- Harden org_group_members with RLS.
-- Safe to run even if the table is absent in some environments.
-- Supports either org_id or organization_id, and either role or is_admin.

create or replace function public.org_group_members_is_org_member(
  p_org_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_org_column text;
  v_sql text;
  v_result boolean := false;
begin
  if p_org_id is null or p_user_id is null or to_regclass('public.org_group_members') is null then
    return false;
  end if;

  select case
    when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'org_group_members'
        and column_name = 'org_id'
    ) then 'org_id'
    when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'org_group_members'
        and column_name = 'organization_id'
    ) then 'organization_id'
    else null
  end
  into v_org_column;

  if v_org_column is null then
    return false;
  end if;

  v_sql := format(
    'select exists (
       select 1
       from public.org_group_members
       where %I = $1
         and user_id = $2
     )',
    v_org_column
  );

  execute v_sql into v_result using p_org_id, p_user_id;
  return coalesce(v_result, false);
end;
$$;

create or replace function public.org_group_members_is_org_admin(
  p_org_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_org_column text;
  v_has_role boolean;
  v_has_is_admin boolean;
  v_admin_clause text;
  v_sql text;
  v_result boolean := false;
begin
  if p_org_id is null or p_user_id is null or to_regclass('public.org_group_members') is null then
    return false;
  end if;

  select case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'org_group_members'
          and column_name = 'org_id'
      ) then 'org_id'
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'org_group_members'
          and column_name = 'organization_id'
      ) then 'organization_id'
      else null
    end,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'org_group_members'
        and column_name = 'role'
    ),
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'org_group_members'
        and column_name = 'is_admin'
    )
  into v_org_column, v_has_role, v_has_is_admin;

  if v_org_column is null or not (v_has_role or v_has_is_admin) then
    return false;
  end if;

  v_admin_clause := case
    when v_has_role and v_has_is_admin then
      '(coalesce(is_admin, false) or lower(coalesce(role, '''')) in (''owner'', ''admin''))'
    when v_has_role then
      'lower(coalesce(role, '''')) in (''owner'', ''admin'')'
    else
      'coalesce(is_admin, false)'
  end;

  v_sql := format(
    'select exists (
       select 1
       from public.org_group_members
       where %I = $1
         and user_id = $2
         and %s
     )',
    v_org_column,
    v_admin_clause
  );

  execute v_sql into v_result using p_org_id, p_user_id;
  return coalesce(v_result, false);
end;
$$;

do $$
declare
  v_org_column text;
  v_has_user_id boolean;
  v_has_role boolean;
  v_has_is_admin boolean;
  v_non_admin_clause text := 'true';
begin
  if to_regclass('public.org_group_members') is null then
    raise notice 'Skipping org_group_members RLS hardening because public.org_group_members does not exist.';
    return;
  end if;

  select case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'org_group_members'
          and column_name = 'org_id'
      ) then 'org_id'
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'org_group_members'
          and column_name = 'organization_id'
      ) then 'organization_id'
      else null
    end,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'org_group_members'
        and column_name = 'user_id'
    ),
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'org_group_members'
        and column_name = 'role'
    ),
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'org_group_members'
        and column_name = 'is_admin'
    )
  into v_org_column, v_has_user_id, v_has_role, v_has_is_admin;

  if v_org_column is null or not v_has_user_id then
    raise notice 'Skipping org_group_members RLS hardening because org/user columns are missing.';
    return;
  end if;

  v_non_admin_clause := case
    when v_has_role and v_has_is_admin then
      '(not coalesce(is_admin, false) and lower(coalesce(role, ''member'')) not in (''owner'', ''admin''))'
    when v_has_role then
      'lower(coalesce(role, ''member'')) not in (''owner'', ''admin'')'
    when v_has_is_admin then
      'not coalesce(is_admin, false)'
    else
      'true'
  end;

  execute 'alter table public.org_group_members enable row level security';

  execute 'drop policy if exists "org_group_members_select_self_or_admin" on public.org_group_members';
  execute 'drop policy if exists "org_group_members_insert_self_or_admin" on public.org_group_members';
  execute 'drop policy if exists "org_group_members_update_self_or_admin" on public.org_group_members';
  execute 'drop policy if exists "org_group_members_delete_self_or_admin" on public.org_group_members';

  execute format(
    'create policy "org_group_members_select_self_or_admin" on public.org_group_members
       for select to authenticated
       using (
         user_id = auth.uid()
         or public.org_group_members_is_org_admin(%1$I)
       )',
    v_org_column
  );

  -- Self-insert is intentionally limited to callers who already belong to the org
  -- and who are not creating an admin/owner row.
  execute format(
    'create policy "org_group_members_insert_self_or_admin" on public.org_group_members
       for insert to authenticated
       with check (
         (
           user_id = auth.uid()
           and public.org_group_members_is_org_member(%1$I)
           and %2$s
         )
         or public.org_group_members_is_org_admin(%1$I)
       )',
    v_org_column,
    v_non_admin_clause
  );

  execute format(
    'create policy "org_group_members_update_self_or_admin" on public.org_group_members
       for update to authenticated
       using (
         user_id = auth.uid()
         or public.org_group_members_is_org_admin(%1$I)
       )
       with check (
         (
           user_id = auth.uid()
           and public.org_group_members_is_org_member(%1$I)
           and %2$s
         )
         or public.org_group_members_is_org_admin(%1$I)
       )',
    v_org_column,
    v_non_admin_clause
  );

  execute format(
    'create policy "org_group_members_delete_self_or_admin" on public.org_group_members
       for delete to authenticated
       using (
         user_id = auth.uid()
         or public.org_group_members_is_org_admin(%1$I)
       )',
    v_org_column
  );
end;
$$;

notify pgrst, 'reload schema';
