insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'group-assets',
  'group-assets',
  true,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.patch_group_state_many(
  p_org_id uuid,
  p_group_id uuid,
  p_patches jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_allowed boolean := false;
  v_data jsonb;
  v_patch jsonb;
  v_path text[];
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  if p_patches is null or jsonb_typeof(p_patches) <> 'array' then
    raise exception 'Patch payload must be an array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_patches) = 0 or jsonb_array_length(p_patches) > 100 then
    raise exception 'Patch count must be between 1 and 100' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.group_memberships gm
    where gm.org_id = p_org_id
      and gm.group_id = p_group_id
      and gm.user_id = v_user_id
  ) or exists (
    select 1
    from public.memberships m
    left join public.orgs o on o.id = m.org_id
    where m.org_id = p_org_id
      and m.user_id = v_user_id
      and (m.role = 'owner' or o.owner_id = v_user_id)
  )
  into v_is_allowed;

  if not v_is_allowed then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  insert into public.group_state (org_id, group_id, data, updated_at)
  values (p_org_id, p_group_id, '{}'::jsonb, now())
  on conflict (group_id) do nothing;

  select coalesce(data, '{}'::jsonb)
  into v_data
  from public.group_state
  where org_id = p_org_id
    and group_id = p_group_id
  for update;

  if v_data is null then
    raise exception 'Group state row not found' using errcode = '02000';
  end if;

  for v_patch in
    select value
    from jsonb_array_elements(p_patches)
  loop
    if jsonb_typeof(v_patch) <> 'object' then
      raise exception 'Each patch must be an object' using errcode = '22023';
    end if;

    if not (v_patch ? 'path') or jsonb_typeof(v_patch->'path') <> 'array' then
      raise exception 'Patch path must be an array' using errcode = '22023';
    end if;

    if not (v_patch ? 'value') then
      raise exception 'Patch value is required' using errcode = '22023';
    end if;

    select array_agg(path_part order by ordinality)
    into v_path
    from jsonb_array_elements_text(v_patch->'path') with ordinality as path(path_part, ordinality);

    if coalesce(array_length(v_path, 1), 0) = 0 or array_length(v_path, 1) > 12 then
      raise exception 'Patch path length must be between 1 and 12' using errcode = '22023';
    end if;

    v_data := jsonb_set(v_data, v_path, v_patch->'value', true);
  end loop;

  update public.group_state
  set
    data = v_data,
    updated_at = now()
  where org_id = p_org_id
    and group_id = p_group_id;
end;
$$;

create or replace function public.patch_group_state(
  p_org_id uuid,
  p_group_id uuid,
  p_path text[],
  p_value jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.patch_group_state_many(
    p_org_id,
    p_group_id,
    jsonb_build_array(jsonb_build_object('path', p_path, 'value', p_value))
  );
$$;

revoke all on function public.patch_group_state_many(uuid, uuid, jsonb) from public;
revoke all on function public.patch_group_state(uuid, uuid, text[], jsonb) from public;
grant execute on function public.patch_group_state_many(uuid, uuid, jsonb) to authenticated;
grant execute on function public.patch_group_state(uuid, uuid, text[], jsonb) to authenticated;
