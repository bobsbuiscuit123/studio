# ClubHub AI Runbook

## AI Outage
- Symptom: AI endpoints return errors or timeouts.
- Immediate action:
  1) Set `AI_ENABLED=false` and redeploy.
  2) Verify `GET /api/health` is healthy.
  3) Monitor Sentry errors for AI failures.
- Recovery:
  - Re-enable AI after provider stabilization and verify with a single test prompt.

## Provider Errors (429/Quota)
- Symptom: AI quota errors in logs and UI toasts.
- Action:
  - Confirm billing/quota on provider.
  - Lower AI traffic (feature flag) or upgrade quota.
  - Monitor error rate in Sentry.

## DB Errors (Future)
- Symptom: 5xx on data endpoints, auth failures, or missing data.
- Action:
  - Check DB availability and credentials.
  - Roll back last release if error spike aligns with deploy.

## Rollback
- Revert to last known good release.
- Confirm `/api/health` and core flows (login, create announcement, AI prompt).

