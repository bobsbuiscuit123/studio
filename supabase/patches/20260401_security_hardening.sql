-- Defense-in-depth hardening for internal billing/webhook bookkeeping tables.
-- Safe to run even if prior patches were already applied.

alter table if exists public.processed_webhooks enable row level security;
alter table if exists public.token_purchase_intents enable row level security;
alter table if exists public.token_purchase_grants enable row level security;

revoke all on table public.processed_webhooks from public;
revoke all on table public.processed_webhooks from anon;
revoke all on table public.processed_webhooks from authenticated;

revoke all on table public.token_purchase_intents from public;
revoke all on table public.token_purchase_intents from anon;
revoke all on table public.token_purchase_intents from authenticated;

revoke all on table public.token_purchase_grants from public;
revoke all on table public.token_purchase_grants from anon;
revoke all on table public.token_purchase_grants from authenticated;

grant all on table public.processed_webhooks to service_role;
grant all on table public.token_purchase_intents to service_role;
grant all on table public.token_purchase_grants to service_role;

notify pgrst, 'reload schema';
