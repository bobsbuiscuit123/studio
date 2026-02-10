# Staging Checklist

## Build & Deploy
- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`

## Smoke Tests
- [ ] `SMOKE_BASE_URL=https://staging.example.com npm run smoke`
- [ ] Verify `/api/health` returns `ok: true`.

## Core Flows
- [ ] Login / signup flow
- [ ] Create announcement
- [ ] Send message
- [ ] Calendar AI prompt success
- [ ] Calendar AI prompt timeout (simulate)

## Observability
- [ ] Confirm Sentry DSNs are set
- [ ] Check Sentry error ingestion in staging

