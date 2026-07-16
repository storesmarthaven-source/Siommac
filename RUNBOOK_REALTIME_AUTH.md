# RUNBOOK — Realtime-auth slice (authenticated realtime + signals RLS, mig 351)

Closes messaging-audit finding #5. Supersedes held migration 350 (never apply
it — its `auth.uid()` cast breaks on TEXT user ids and it predates the
authenticated connection). Contract: `netlify/functions/lib/REALTIME_AUTH_CONTRACT.md`.

The code ships INERT: until steps 1–2 below, the summary returns
`realtimeToken: null` and the frontend keeps today's anonymous realtime
connection. Nothing changes for users until migration 351 is applied.

**Design (2026-07-16 revision):** tokens are minted **ES256** with a
SIOMAC-generated-and-controlled signing key imported into Supabase — NOT the
legacy HS256 shared secret (extractable symmetric root credential; Supabase
marks it not-recommended for production). Standby keys do NOT verify, so the
imported key must be rotated to CURRENT.

## 1. Operator — env (already done by the session that generated the key)
`.env` (and any deploy env) carries:
```
SUPABASE_JWT_ES256_KID=<uuid — must match the imported key's kid>
SUPABASE_JWT_ES256_PRIVATE_KEY=<base64 of the PKCS8 PEM private key>
```
These are backend-only. NEVER expose via `VITE_`/`PUBLIC_` variables. The
import JWK sits at `supabase-es256-import.jwk.json` (repo root, git-ignored).

## 2. Operator — import + rotate in the Supabase dashboard
1. Dashboard → **Project Settings → JWT Keys** → **Import key** → paste the
   contents of `supabase-es256-import.jwk.json`. It arrives as **standby**.
2. **Rotate** the standby key to **CURRENT**. Safe for SIOMAC: auth is custom
   (app_users + our own JWT) and API keys are new-format `sb_*` — nothing
   consumes Supabase-Auth-signed tokens, so rotation affects only our minted
   realtime tokens.
3. Do NOT revoke anything yet. Restart the dev server (env is read at boot).
4. After the slice is verified end-to-end you may revoke the legacy HS256
   secret ("previously used") — nothing in SIOMAC uses it.

## 3. Verify the authenticated path (BEFORE applying the migration)
```
node scripts/verify-realtime-auth.mjs
```
Expect: `PHASE A PASS` (authenticated subscription receives signals) and
`PHASE B WARN` (anon still works — RLS not applied yet).
Also sanity-check the app: reload, badge counts still refresh in realtime.

## 4. Apply migration 351 (plain SQL Editor tab)
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

## 5. Verify enforcement
```
node scripts/verify-realtime-auth.mjs
```
Expect: `PHASE A PASS` AND `PHASE B PASS` (anon receives nothing).
App sanity: badges still refresh live (the connection now carries the token).

## 6. E2E follow-up (after the E2E-hygiene session lands)
The realtime E2E tests (communications realtime-DELIVERY, messaging realtime)
subscribe with the harness's ANON client — after step 4 they will correctly
FAIL until converted: mint a realtime JWT in the harness (same claims as
`scripts/verify-realtime-auth.mjs`) and `client.realtime.setAuth(...)` before
subscribing. Do this in a separate commit once the hygiene session's harness
changes are merged (it owns `scripts/e2e/harness.mjs` right now), then re-run
the FULL realtime suites (supabase-js 2.105.3 pin — realtime is fragile).

## Rollback
Re-apply the permissive policy from `20260628100000_communication_signals_realtime.sql`
(section 2) and re-grant anon select. The token path is inert and needs no rollback.
