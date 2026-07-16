# RUNBOOK — Realtime-auth slice (authenticated realtime + signals RLS, mig 351)

Closes messaging-audit finding #5. Supersedes held migration 350 (never apply
it — its `auth.uid()` cast breaks on TEXT user ids and it predates the
authenticated connection). Contract: `netlify/functions/lib/REALTIME_AUTH_CONTRACT.md`.

The code ships INERT: until step 1 below, the summary returns
`realtimeToken: null` and the frontend keeps today's anonymous realtime
connection. Nothing changes for users until migration 351 is applied.

## 1. Operator — configure the project JWT secret
Add to `.env` (and any deploy env):
```
SUPABASE_JWT_SECRET=<Supabase dashboard → Project Settings → API → JWT Secret>
```
This is the PROJECT secret (what the anon/service keys are signed with) — NOT
the app's `JWT_SECRET`. Then restart the dev server (env is read at boot).

## 2. Verify the authenticated path (BEFORE applying the migration)
```
node scripts/verify-realtime-auth.mjs
```
Expect: `PHASE A PASS` (authenticated subscription receives signals) and
`PHASE B WARN` (anon still works — RLS not applied yet).
Also sanity-check the app: reload, badge counts still refresh in realtime.

## 3. Apply migration 351 (plain SQL Editor tab)
Paste the WHOLE of `_apply_20260919000351_communication_signals_rls_authenticated_clean.sql`
(repo root), run, then:
```sql
NOTIFY pgrst, 'reload schema';
```
Verify:
```sql
select policyname, roles from pg_policies
 where tablename = 'communication_signals';
```
Expect exactly `realtime read own communication_signals` for `{authenticated}`.

## 4. Verify enforcement
```
node scripts/verify-realtime-auth.mjs
```
Expect: `PHASE A PASS` AND `PHASE B PASS` (anon receives nothing).
App sanity: badges still refresh live (the connection now carries the token).

## 5. E2E follow-up (after the E2E-hygiene session lands)
The realtime E2E tests (communications realtime-DELIVERY, messaging realtime)
subscribe with the harness's ANON client — after step 3 they will correctly
FAIL until converted: mint a realtime JWT in the harness (same claims as
`scripts/verify-realtime-auth.mjs`) and `client.realtime.setAuth(...)` before
subscribing. Do this in a separate commit once the hygiene session's harness
changes are merged (it owns `scripts/e2e/harness.mjs` right now), then re-run
the FULL realtime suites (supabase-js 2.105.3 pin — realtime is fragile).

## Rollback
Re-apply the permissive policy from `20260628100000_communication_signals_realtime.sql`
(section 2) and re-grant anon select. The token path is inert and needs no rollback.
