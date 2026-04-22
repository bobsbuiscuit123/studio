create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assistant_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  request_payload jsonb not null default '{}'::jsonb,
  normalized_plan jsonb,
  retrieval_payload jsonb,
  response_payload jsonb,
  state text not null check (
    state in (
      'response',
      'retrieval_response',
      'draft_preview',
      'awaiting_confirmation',
      'executing',
      'success',
      'error',
      'needs_clarification'
    )
  ),
  pending_action_id uuid,
  retry_count integer not null default 0,
  timeout_flag boolean not null default false,
  error_code text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.assistant_pending_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  action_type text not null check (
    action_type in (
      'create_announcement',
      'update_announcement',
      'create_event',
      'update_event',
      'create_message'
    )
  ),
  original_draft_payload jsonb not null,
  current_payload jsonb not null,
  status text not null check (
    status in (
      'pending',
      'confirmed',
      'executing',
      'executed',
      'failed',
      'cancelled',
      'expired'
    )
  ),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  executed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  result_entity_id text,
  result_entity_type text,
  result_message text
);

create table if not exists public.assistant_action_logs (
  id uuid primary key default gen_random_uuid(),
  pending_action_id uuid not null references public.assistant_pending_actions(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  action_type text not null check (
    action_type in (
      'create_announcement',
      'update_announcement',
      'create_event',
      'update_event',
      'create_message'
    )
  ),
  original_draft_payload jsonb not null,
  final_executed_payload jsonb not null,
  result text not null check (result in ('success', 'failure')),
  entity_id text,
  error_message text,
  confirmation_timestamp timestamptz,
  execution_duration_ms integer,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists assistant_conversations_scope_idx
  on public.assistant_conversations (user_id, org_id, group_id, updated_at desc);

create index if not exists assistant_turns_scope_idx
  on public.assistant_turns (conversation_id, created_at desc);

create index if not exists assistant_pending_actions_scope_idx
  on public.assistant_pending_actions (user_id, org_id, group_id, conversation_id, created_at desc);

create index if not exists assistant_pending_actions_status_idx
  on public.assistant_pending_actions (status, expires_at);

create index if not exists assistant_action_logs_scope_idx
  on public.assistant_action_logs (conversation_id, created_at desc);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_turns enable row level security;
alter table public.assistant_pending_actions enable row level security;
alter table public.assistant_action_logs enable row level security;
