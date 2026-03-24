alter table public.token_purchase_intents
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.token_purchase_intents
  add column if not exists product_id text;

create index if not exists idx_token_purchase_intents_user_created_at
  on public.token_purchase_intents(user_id, created_at desc);

create index if not exists idx_token_purchase_intents_product_created_at
  on public.token_purchase_intents(product_id, created_at desc);
