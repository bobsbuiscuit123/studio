# LocalStorage to DB Migration Plan

## Goal
Move from localStorage-backed data to a production database without breaking UX.

## Strategy
1) Dual-write: write new data to DB while keeping localStorage as fallback.
2) Shadow-read: read from DB first; if missing, fall back to localStorage.
3) Backfill: migrate existing localStorage data into DB on user login.
4) Cutover: once DB coverage is >99%, disable localStorage writes.

## Backfill Steps
- On first authenticated session, read localStorage records and send to a migration API.
- Mark migration complete per user/club to prevent replays.

## Rollback
- If DB fails, re-enable localStorage as primary store temporarily.

