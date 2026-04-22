alter table public.assistant_pending_actions
  add column if not exists action_fields jsonb not null default '{}'::jsonb;
