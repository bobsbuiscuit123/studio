# CASPO

Production-ready CASPO app built with Next.js 15 + Supabase + Genkit.

## Required Environment Variables (names only)

Client:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_ENV`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_RELEASE`

Server:
- `SUPABASE_SERVICE_ROLE_KEY`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `AI_PROVIDER`
- `AI_ENABLED`
- `GEMINI_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY`

## Migrations
Apply SQL in `supabase/migrations/20260201_init.sql` in your Supabase SQL editor.
Then apply `supabase/patches/20260214_groups.sql` for the org -> clubs (groups) split.
Then apply `supabase/migrations/20260304_org_billing_quota.sql` for quotas + IAP-ready billing metadata.
If you already applied an older billing migration, also apply `supabase/patches/20260313_iap_billing.sql`.

## Development
```
npm install
npm run dev
```

## Tests
```
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

## Genkit
```
npm run genkit:dev
```
If Sentry is missing or DSN is unset, telemetry is safely disabled.

## Staging / Production
See:
- `docs/staging-checklist.md`
- `docs/runbook.md`

## Important
Rotate leaked keys before public launch.

## Auth Signup Behavior
- This app uses a server-side signup endpoint with the Supabase service role to create users immediately.
- Email confirmation is not required for signup; accounts are created if the email is not already in use.
- `SUPABASE_SERVICE_ROLE_KEY` must be set for `/api/auth/signup` to work.
- trigger ios pipeline

