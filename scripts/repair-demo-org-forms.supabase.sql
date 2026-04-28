-- Paste into Supabase SQL Editor to repair existing demo org forms that were
-- inserted without required array fields.

update public.group_state gs
set
  data = jsonb_set(
    gs.data,
    '{forms}',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'questions', jsonb_build_array(),
            'viewedBy', jsonb_build_array(),
            'responses', jsonb_build_array()
          ) || form_item
        )
        from jsonb_array_elements(
          case
            when jsonb_typeof(gs.data->'forms') = 'array' then gs.data->'forms'
            else jsonb_build_array()
          end
        ) as form_item
      ),
      jsonb_build_array()
    ),
    true
  ),
  updated_at = now()
from public.orgs o
where gs.org_id = o.id
  and o.name = 'Caspo Demo High School'
  and o.owner_id = (
    select id
    from auth.users
    where lower(email) = lower('pratheek.mukkavilli@gmail.com')
    limit 1
  );
