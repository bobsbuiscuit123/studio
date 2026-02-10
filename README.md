# ClubHub AI

Production-ready ClubHub AI app built with Next.js 15 + Supabase + Genkit.

## Required Environment Variables (names only)

Client:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
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
