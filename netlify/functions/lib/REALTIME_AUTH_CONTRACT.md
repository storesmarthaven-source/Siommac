# Realtime-auth slice — authenticated Supabase realtime + signals RLS

> Closes messaging-audit finding #5 the CORRECT way (the held mig 350 was the
> right RLS idea with two fatal flaws: it required an authenticated realtime
> connection that did not exist, and its policy used `auth.uid()` — a UUID cast
> that explodes on TEXT app_users ids like `USR-001`).

## Architecture

1. **Server-issued realtime token.** `lib/realtimeAuth.ts` mints a short-lived
   (55 min) **ES256** JWT signed with a **SIOMAC-generated-and-controlled**
   signing key that was imported into Supabase (dashboard → JWT Keys → import
   JWK) and **rotated to CURRENT** — standby keys are NOT used for verification,
   so the rotation step is mandatory. Env: `SUPABASE_JWT_ES256_PRIVATE_KEY`
   (base64 PKCS8 PEM) + `SUPABASE_JWT_ES256_KID` (must match the imported kid;
   sent as the JWT `kid` header). Claims: `sub` = app_users.id (TEXT),
   `role` = `authenticated`, `aud` = `authenticated`. RLS then evaluates
   policies with `auth.jwt()->>'sub'` = our user id.
   *Why not the legacy HS256 shared secret:* it couples signing authority to an
   extractable symmetric secret, complicates rotation, and Supabase marks it
   not-recommended for production. The legacy secret is NOT used by this slice
   and may be revoked once nothing else depends on it. Never expose either env
   var through `VITE_`/`PUBLIC_`/frontend variables.
2. **Delivery piggybacks the summary.** `getCommsSummary` returns
   `realtimeToken` + `realtimeTokenExpiresAt` beside `realtimeChannelKey`
   (one round-trip; the 30s summary poll keeps the token fresh long before the
   55-min expiry). `null` when the env secret is unconfigured.
3. **FE applies it.** `useRealtimeSignals(channelKey, realtimeToken)`:
   `client.realtime.setAuth(token)` BEFORE `subscribe`; a separate lightweight
   effect re-calls `setAuth` when the token value rotates (no channel churn —
   the channel lifecycle is keyed on channelKey only).
4. **RLS enforcement = migration 351** (`20260919000351_..._authenticated.sql`):
   drops the permissive `USING (true)` policy; SELECT policy `to authenticated`
   scoped via `(auth.jwt()->>'sub')` against `user_realtime_channels`
   (unexpired); revokes anon SELECT. Signals stay metadata-only
   (channel_key/domain/created_at) — RLS is defense-in-depth on top.

## REQUIRED
| # | Requirement |
|---|-------------|
| R1 | Token mint refuses silently → `null` (no fabricated token) when `SUPABASE_JWT_ES256_PRIVATE_KEY`/`_KID` are absent or the key does not decode to a PKCS8 PEM; the FE then runs exactly today's anon path. The migration runbook REQUIRES the env + dashboard import/rotation before apply — the RLS flip is the single enforcement point. |
| R2 | `sub` claim is the TEXT app user id; policy uses `auth.jwt()->>'sub'`, NEVER `auth.uid()`. |
| R3 | Token rotation must NOT resubscribe the channel (badge realtime would flap): setAuth-only effect. |
| R4 | Standalone verify script `scripts/verify-realtime-auth.mjs` (no E2E-harness dependency — the harness is owned by the concurrently-running E2E-hygiene session): phase A = authed subscribe receives a signal; phase B = anon subscribe receives NOTHING (post-351; pre-351 it warns that enforcement is pending). |
| R5 | supabase-js stays pinned 2.105.3 (`realtime.setAuth` verified present). |

## FORBIDDEN
- Applying mig 350 (superseded — auth.uid() cast bug; deleted-marker kept in repo).
- Editing `scripts/e2e/harness.mjs` or suite cleanup blocks in THIS slice (hygiene session owns them; the realtime E2E suite updates happen after it lands).
- Treating realtime as a data source (signals remain refetch triggers only).

## DEFERRED
- Typing/presence over authenticated realtime (their own Messenger slices — this slice unblocks them).
- E2E suite conversion of anon realtime tests to authed (after the hygiene session merges; noted in RUNBOOK_REALTIME_AUTH.md).

## Operator sequence (RUNBOOK_REALTIME_AUTH.md)
1. Generate the ES256 keypair (done via session script): `SUPABASE_JWT_ES256_KID` +
   `SUPABASE_JWT_ES256_PRIVATE_KEY` (base64 PKCS8 PEM) in `.env`; import JWK at
   `supabase-es256-import.jwk.json` (git-ignored).
2. Dashboard → JWT Keys → **Import** the JWK (arrives as standby) → **Rotate**
   it to CURRENT (safe: SIOMAC uses custom auth + `sb_*` API keys — nothing
   consumes Supabase-Auth-signed tokens).
3. Restart dev server → `node scripts/verify-realtime-auth.mjs` → phase A green.
4. Apply `_apply_20260919000351_*_clean.sql` + NOTIFY → re-run verify → A green + B green.
5. After the E2E-hygiene session lands: update the realtime E2E tests to authed connections, full realtime-suite re-run.
6. Optionally revoke the legacy HS256 secret in the dashboard (nothing uses it).
