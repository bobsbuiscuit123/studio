# Local Supabase Smoke Test

## Prereqs
- Supabase project with migrations applied.
- Two test users (User A + User B) created via the app signup flow.
- `.env.local` populated from `.env.local.template` (no secrets in repo).

## Commands
```bash
npm install
npm run dev
```

In another terminal:
```bash
npm run smoke
```

## UI Steps (User A + User B)

### User A (admin)
1. Open `http://localhost:3000`.
2. Sign up or log in.
3. Create a club (org).
4. Copy the join code.
5. Go to Announcements and create one.

Expected:
- User A is admin in `memberships`.
- Org row exists in `orgs`.
- Announcement row exists in `announcements`.

### User B (member)
1. Log out or open an incognito window.
2. Sign up or log in as User B.
3. Join org using the join code.
4. Attempt to create an announcement (should be denied).

Expected:
- User B is member in `memberships`.
- User B can read announcements but cannot create.

## Supabase Table Checks
In Supabase Dashboard → **Table Editor**:
- `orgs`: new org exists
- `memberships`: User A = admin, User B = member
- `announcements`: created by User A
- `org_state`: org data exists and updates as you use the app

## Health Check
The smoke script hits:
```
GET /api/health
```
and exits non-zero if not healthy.
