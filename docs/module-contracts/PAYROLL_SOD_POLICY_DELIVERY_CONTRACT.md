# Payroll Segregation-of-Duties (SoD) Policy — Delivery Contract

**Status:** BUILT (migration + service + routes + UI) — **migration not yet applied**; E2E suite and
live verification outstanding. Security-critical (anti-fraud control over payroll money).

**Build log (2026-07-25):**
- `e516d261` — migration (policy table, `finance_payroll_active_sod_level()`, `runs.sod_level`
  snapshot default, both RPCs patched) + permission keys in BE/FE catalogues + permissionMeta.
- `cc9554e3` — `lib/finance/payroll/sodPolicy.ts` + 4 routes + the two atomic policy RPCs
  (`..._approve_tx`, `..._set_roles_tx`) appended to the same migration.
- `04142e12` — Payroll Setup → **Governance** tab (`SodPolicyPanel.tsx`) + FE API client.
- `4af5c0aa` — regenerated `docs/generated` index.
- Gates so far: BE+FE typecheck 0/0, vitest 484/484, `repo:index:check` clean.

**APPLIED + VERIFIED (2026-07-25):**
- Operator applied the migration. Live DB probe: policy table seeded (1 row, level 3, active,
  roles `{superadmin,finance_manager}`), `finance_payroll_active_sod_level()` = 3,
  `finance_payroll_runs.sod_level` present (PAY-2026-0589 = 3), both governance RPCs resolvable
  with their guards firing. A bad-arg probe of `..._set_roles_tx` rolled back cleanly — incidental
  proof of the in-database atomicity.
- `599e9f90` — migration reworked to patch the two RPCs from `pg_get_functiondef()` instead of
  carrying a 1,430-line copy (1667 → 285 lines; cannot go stale, RAISES rather than silently
  no-op'ing, idempotent).
- `800feec4` — `scripts/e2e/suites/payrollSodPolicy.mjs` **14/14 green** + migration §6 role grants.
- Regression: **financePayroll 137/137** — that suite drives certify→submit→approve→lock→fund→
  release through BOTH patched RPCs, so the patch is behaviourally sound.
- Shared-DB hygiene verified after the run: exactly one active level-3 policy, no leftover users.

**DEFECT THE SUITE CAUGHT:** `requirePermission` resolves capabilities from the `role_permissions`
TABLE, not the static catalogue in code — the new keys 403'd for `finance_manager` despite being in
both catalogues (the "DB seed ≠ static code" pitfall). Fixed at source in migration §6.

**ENFORCEMENT PROVEN (`8b08d8c7`, financePayroll 140/140):** three cases in the release section flip
`finance_payroll_runs.sod_level` on the locked run and probe `finance_payroll_confirm_funding_tx`
with a non-negative but mismatched amount — the amount check sits AFTER the SoD checks, so PR403 vs
PR422 distinguishes "blocked by SoD" from "SoD passed". Result: level 3 blocks the approver; level 2
admits the SAME approver (PR422) while still blocking the preparer; level 4 restores the strictest
chain. Zero funding rows written. This is the behavioural proof the RPCs read `v_run.sod_level`.

**REMAINING:**
1. Certifier-ONLY delta (level 4 vs 3) needs a fixture whose certifier differs from the preparer —
   `fstaff1` is both in financePayroll, so the level-4 case asserts the chain end-to-end rather than
   the certifier clause in isolation.
2. Browser QA of Payroll Setup → **Governance** (propose → approve as a different actor).
3. Note: existing runs took `sod_level = 3` from the column default on apply — level 3 is *less*
   strict than the previous hardcoded 4-way, so confirm no in-flight run is surprised (PAY-2026-0589
   is already released, so inert there).
**Origin:** 2026-07-25 "finish live run" session — releasing PAY-2026-0589 required 4 distinct
actors because the SoD chain is hardcoded. User asked to make the strictness configurable.
**Related:** [[central-workflow-engine]], governed statutory-version pattern (draft→submit→approve→
activate), [[module-service-adapter-pattern]], [[rbac-permission-registry]], settings architecture.

---

## 1. Problem (today)

The release chain enforces a fixed **4-way SoD**, hardcoded in the Postgres RPCs
(`supabase/migrations/20260919000424_finance_payroll_certification_release_tx.sql`):

- `finance_payroll_confirm_funding_tx` (~line 1433): funder ≠ preparer **and** ≠ approver **and** ≠ certifier (lines 1527, 1542).
- `finance_payroll_release_run_tx` (~line 261): releaser ≠ preparer **and** ≠ approver **and** ≠ certifier (lines 369, 410).
- Approve (`submit`/approve path): approver ≠ preparer (the 2-person floor).

A finance team with < 4 distinct payroll-authorized people literally cannot release a run.

## 2. Target design

### 2.1 Configurable SoD level (preset — Option A)

| Level | approver ≠ | funder & releaser ≠ | distinct people |
|-------|-----------|---------------------|-----------------|
| **2** | preparer | preparer | 2 |
| **3** *(default)* | preparer | preparer, approver | 3 |
| **4** *(current)* | preparer | preparer, approver, certifier | 4 |

- Floor is **2** (preparer ≠ approver always); "one person does everything" is NOT selectable.
- Default is **3**.

### 2.2 Per-run snapshot binding ("no switching between runs")

The SoD level is **captured onto each run at creation** (new column
`finance_payroll_runs.sod_level int not null`), set from the active policy inside
`create_run_tx`. The funding/release RPCs read **`v_run.sod_level`**, NOT the live global setting.
Changing the policy therefore **never** alters the rules of an in-flight run — only runs created
after the change pick up the new level.

### 2.3 Workflow-governed change (draft → submit → approve → activate)

Changing the SoD level is **not** a direct toggle. It is a governed change routed through the
**Central Workflow Engine** (same pattern as statutory rate versions / pay policies):

1. An authorized **proposer** drafts a new level (with a reason).
2. Submit → creates a workflow task/approval binding via `startWorkflowForRecord` (engine is the
   single approval authority; no ad-hoc flag).
3. An authorized **approver** (≠ proposer — maker-checker enforced server-side) decides it.
4. On approval, the new level becomes **active**; prior active version is superseded (versioned,
   append-only — full audit trail of who changed the fraud control, when, why).

### 2.4 Configurable authorized roles (with escalation guardrail)

- Roles eligible to **propose/approve** an SoD-level change are configurable; **default
  `{superadmin, finance_manager}`**.
- **Guardrail (non-negotiable):** editing the eligible-role list is **superadmin-only** — a
  finance_manager must NOT be able to add themselves as the sole approver and defeat maker-checker.
  This is the one hardcoded rule (prevents a privilege-escalation loop).
- Maker ≠ checker enforced server-side for BOTH the level change and (trivially) new runs.

## 3. REQUIRED (must ship, all wired + §2 side-effects)

- **Migration** (`supabase/migrations/2026XXXX_finance_payroll_sod_policy.sql`):
  - `finance_payroll_sod_policy` — versioned, append-only: `id`, `sod_level int check in (2,3,4)`,
    `status ('draft'|'pending_approval'|'active'|'superseded')`, `eligible_roles text[]`,
    `proposed_by`, `approved_by`, `reason`, `workflow_id`, `effective_at`, `created_at`. RLS on.
    Seed ONE active row at level 3, eligible_roles `{superadmin,finance_manager}`.
  - `finance_payroll_runs.sod_level int not null default 3` (+ capture in `create_run_tx`).
  - `CREATE OR REPLACE` `finance_payroll_confirm_funding_tx` + `finance_payroll_release_run_tx`
    reproduced **verbatim** with ONLY the SoD checks parameterized by `v_run.sod_level`
    (`>=3 ⇒ exclude approver`, `>=4 ⇒ exclude certifier`).
  - RPC `finance_payroll_sod_policy_change_tx` (draft/submit/approve) — atomic, transactional-outbox
    (app_events + audit_logs + handoff/workflow), maker-checker + status guards inside the RPC.
- **Permission keys** (add to BOTH catalogues + permissionMeta, exact strings):
  `finance.payroll.sod_policy.view`, `finance.payroll.sod_policy.propose`,
  `finance.payroll.sod_policy.approve`, `finance.payroll.sod_policy.manage_roles` (superadmin-gated).
- **Backend routes** (`routes/financePayroll.ts`): `sod-policy/get`, `sod-policy/propose`,
  `sod-policy/approve`, `sod-policy/set-roles` — each `requirePermission` + validate `body.args ?? body`.
- **Frontend**: governed-config surface in Payroll Setup / governance (mirrors the statutory version
  drawer) — view active level + history, propose change (level + reason), approve pending (SoD-blocked
  for the proposer), superadmin-only eligible-roles editor. Reactive `useCan()` gates. Toasts on every
  mutation.
- **E2E** (`scripts/e2e/suites/payrollSodPolicy.mjs`): each level's funding/release negative path
  (wrong-actor → 403 with the right code), maker=checker denied, non-eligible role denied,
  snapshot invariance (change policy mid-run → in-flight run keeps its level), superadmin-only role
  edit, + §2 side-effect assertions (app_events/audit_logs/workflow_tasks) via service client.

## 4. FORBIDDEN

- No live-read of the global level in the funding/release RPCs (must read the run snapshot).
- No UI-only enforcement — the RPC is the authority.
- No single-actor level change (must be workflow-approved, maker ≠ checker).
- No finance_manager self-service of the eligible-role list.
- No accept-and-drop: don't ship the settings UI unless the RPCs actually honor the level.

## 5. DEFERRED

- Per-pay-group / per-run-type SoD levels (v1 is global-active → snapshot-per-run).
- Granular per-step role eligibility (Option B) — presets only for v1.

## 6. Verification / rollout

- Migration is **operator-applied** (DDL not runnable via the JS client). Build + typecheck +
  vitest + write E2E; operator applies; then live-verify each level's negative path on a real run.
- Gate: vitest green, `npm run test:e2e -- payrollSodPolicy` green, repo:index clean, no lint regress.

## 7. Session checkpoint that precedes this work

- PAY-2026-0589 released end-to-end (4-way SoD, distinct actors incl. seeded funder USR-FINFUND).
- Committed on `main`: `4db01682` (RBAC dept-role nav), `702ccd42` (certify-at-submit UI + GL
  idempotencyKey). vitest 484/484, typecheck 0/0.
- Known follow-up rough edge (small): the run header "Generate Payslips" button only calls
  `payslips/generate` (records, no render), leaving release silently blocked; the release-tab
  "Generate payslips" (→ `render-run`, generate+render) is the complete one. Consider removing/merging
  the header generate-only button.
