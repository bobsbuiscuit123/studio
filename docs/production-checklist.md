# Production Checklist

- [ ] Rotate leaked keys before launch
- [ ] Confirm Supabase migrations applied
- [ ] Verify RLS policies with member/admin accounts
- [ ] Set `AI_ENABLED` and provider keys
- [ ] Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` on the deployed server
- [ ] Upload the APNs auth key in Firebase Cloud Messaging for bundle ID `com.caspo.app`
- [ ] Verify Sentry release + source maps
- [ ] Run smoke test against production
- [ ] Run E2E tests against staging
