# Load Test Plan

## Tools
- k6 (recommended)
- autocannon (simple node benchmark)

## Targets
- `POST /api/calendar/ai`
- `GET /api/health`

## k6 Example
```
k6 run -e BASE_URL=https://staging.example.com scripts/loadtest-calendar.js
```

## Safety Limits
- Start with 5 VUs, ramp to 20 VUs, duration 2m.
- Monitor AI quota and error rates in Sentry.

