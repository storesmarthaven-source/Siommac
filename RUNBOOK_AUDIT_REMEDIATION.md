# Runbook — External Audit Remediation (2026-07-16)

Remediation of the external audit report (3 P0 + findings 4–11 + P1/P2 items).
Every claim was **verified against the code first** (standing rule); two audit
claims were factually wrong — see "Audit errors" at the bottom.

## Operator steps (in order)

1. **Apply migration 399** — paste `_apply_20260919000399_workflow_audit_remediation_clean.sql`
   into the Supabase SQL Editor, run, then `NOTIFY pgrst, 'reload schema';`
   Verify:
   ```sql
   select position('does not match the template role' in prosrc) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = '_create_instance' and n.nspname = 'wf_internal';
   ```
2. **Apply migration 400** — paste `_apply_20260919000400_finance_statutory_workflow_transition_tx_clean.sql`,
   run, `NOTIFY pgrst, 'reload schema';`
   ⚠ The statutory approve/reject **engine path breaks until this is applied** —
   the outbox worker now commits via this RPC and the adapter callbacks throw.
3. **Apply migration 364** (favourites — still pending from the Messenger slice) —
   `_apply_20260919000364_messaging_favourites_clean.sql` + NOTIFY.
4. `npm run build:backend` and **restart** `dev:netlify` (serves compiled dist).
5. **E2E gate** (after 1–4): `npm run test:e2e -- workflow-engine financeStatutory incidents riskjsa capa hrOvertime messagingReactions messagingFavourites communications`
   - workflow-engine includes the NEW mig-399 pin tests
     (`PIN: explicit start with a redirected role assignee → 422`).
   - financeStatutory exercises the new receipt RPC path end-to-end
     (incl. rejected-thread parity: subject contains "rejected").
6. Realtime-auth switch-on (unchanged, separate): set
   `SUPABASE_JWT_ES256_PRIVATE_KEY` + `SUPABASE_JWT_ES256_KID` per
   `RUNBOOK_REALTIME_AUTH.md` → `node scripts/verify-realtime-auth.mjs` phase A → apply mig **351** (NOT 350 —
   350 is HELD and its root apply-copy has been deleted) → verify A+B.

## Per-finding disposition

| # | Finding | Disposition |
|---|---------|-------------|
| F1 (P0) | Explicit-start assignee injection (caller could redirect a role step's approval to any role/user) | **Fixed** — mig 399: `wf_internal._create_instance` pins `role`/`fixed_user` assignees to the template resolver value (mismatch → WF422). Dynamic types unchanged by design. Regression tests added to `scripts/e2e/suites/workflow-engine.mjs`. |
| F2 (P0) | Scoped bindings never match (site/department/recordData not threaded) | **Fixed** — mig 399: `workflow_create_and_start_tx` threads `siteId`/`departmentId` from HSE payloads into `_create_instance`; `hseIncidents.ts`/`hseRiskJsa.ts` now pass `siteId`/`departmentId`/`recordData` into `selectWorkflowBinding`. |
| F3 (P0) | Statutory workflow completion not retry-safe (adapter multi-write could partially apply) | **Fixed** — mig 400: `finance_statutory_workflow_transition_tx` receipt RPC (mirrors payroll mig 180); `outboxWorker.ts` registers `finance_statutory:finance_statutory_approval` receipt handler (commit via RPC, notifications/threads in `afterCommit`); `financeAdapters.ts` completed/returned/rejected callbacks now **throw** (cancelled keeps `rollBackToDraft`). |
| F4 | Actor-level source authorization on explicit start (beyond permission + existence) | **Deferred with rationale** — the route already enforces module permission (Gate 2) + source existence (Gate 3) + template pinning (F1). Record-level ACLs are a per-module read-gate concern; bolting a generic actor-vs-record check into the engine would duplicate module authority. Tracked for the read-gate inheritance pass. |
| F5 | Incident handoff failures swallowed | **Fixed** — `hseIncidents.ts` logs failed handoffs and emits a critical `hse.incident.handoff_failed` app_event (deduped); `handoffBus.ts` failure results now carry `message`. |
| F6 | Synthetic idempotency keys on HSE creates (could never dedupe) | **Fixed** — `hseCapa`/`hseIncidents`/`hseRiskJsa` derive the key from content: `hse.<x>.create:<userId>:<sha256(payload)[0..32]>`. |
| F7 | Orphan open tasks under terminal workflows (my-tasks shows dead work) | **Fixed** — `workflowEngine.ts` my-tasks joins `workflow_instances!inner(status)` and excludes terminal statuses; mig 399 data-fix cancels existing orphans. |
| F8 | Template publish not atomic; bindings accept scoped rows without scope_id | **Fixed** — publish is error-checked with compensating rollback (new version → draft if archiving others fails); bindings/create rejects `scopeType != 'global'` without `scopeId` (400) and forces `scope_id = null` for global. |
| F9 | Message send idempotency key dropped (hardcoded null) | **Fixed end-to-end** — route schema accepts `clientIdempotencyKey` (uuid), lib threads it to `messages_send_message_tx.client_msg_key`, Messenger repository generates one `crypto.randomUUID()` **per send attempt**. |
| F10 | cancel/delegate/reassign are multi-write (non-atomic) | **Deferred with rationale** — conscious finding-#2 scope deferral: these are admin actions with low contention; atomizing them joins the same RPC family as decide/start and is queued behind the mutation-backbone plan. No data-destruction risk (worst case: audit row missing after a crash mid-action). |
| F11 | Hook-order violations + optimistic markRead never reverts | **Fixed** — `MessageThread.tsx` and `ThreadSidebar.tsx` run all hooks before any early return; `MessagingProvider.markRead` restores the previous unread count (with `console.warn`) when the server call fails. |
| P1 | Silent realtime channel failure (random unregistered key substituted) | **Fixed** — `_ensureRealtimeChannel` returns `null` on upsert failure (logged); `realtimeChannelKey` is nullable through `CommsSummary` (BE + FE types); client skips realtime and polling covers until the next summary retry. |
| P1 | Missing service_role grants on the two new messaging tables | **Fixed** — grants included in mig 399 (`message_post_reactions`, `message_thread_favourites`). |
| P1 | Deployment gates (unapplied migrations vs shipped code) | **Addressed** — this runbook is the gate; steps 1–5 above. Mig 400 is the only one where code strictly precedes DDL (adapter throws until applied). |
| P2 | E2E post-run sweep failure exits 0 (leaks look green) | **Fixed** — `scripts/e2e/run.mjs` exits **3** when the post-run sweep fails even if all suites passed. |

## Audit errors (verify-first rule paid off)

- Claimed migs **363** and **398** were unapplied — both were applied and
  live-verified before the audit landed. No action taken.

## Static gates run (2026-07-16)

- `npm run build:backend` — clean.
- `npm run typecheck:frontend` — clean.
- `npx vitest run` — **270/270 passing**.
- `node --check` on `run.mjs` + `workflow-engine.mjs` — clean.
- Full E2E deliberately **not run yet** — blocked on operator applies (steps 1–4);
  run step 5 immediately after.

## Post-apply E2E gate — RUN & GREEN (2026-07-16)

Operator applied 399/400/364; live-verified (statutory RPC answers WF404 probe,
favourites table present, PIN E2E proves 399). Backend rebuilt + dev server
restarted. Gate result:

- First run: **475/479** — the new PIN tests passed; the only 4 failures were a
  STALE pay-component section in `financeStatutory.mjs` still asserting the
  pre-maker-checker direct-create DTO (the parked "financeStatutory DTO fix"
  from 2026-07-10, NOT a regression — the 398→399 RPC diff is byte-clean).
- Fix: deleted the superseded section (mutations are covered end-to-end by the
  dedicated `financePayComponents` suite; read paths + permission negatives stay).
- Re-run: `financeStatutory` + `financePayComponents` — **105/105 green**,
  which also independently confirms mig 399's redefined
  `workflow_create_and_start_tx` pay-component branch.
