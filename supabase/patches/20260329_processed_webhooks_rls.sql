alter table public.processed_webhooks enable row level security;

revoke all on table public.processed_webhooks from public;
revoke all on table public.processed_webhooks from anon;
revoke all on table public.processed_webhooks from authenticated;

grant all on table public.processed_webhooks to service_role;
