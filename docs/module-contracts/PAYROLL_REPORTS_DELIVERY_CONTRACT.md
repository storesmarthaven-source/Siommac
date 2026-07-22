# Payroll Reports Center — Delivery Contract (Phase A)

**Owner:** Payroll module (Claude-assisted build)
**Status:** Designed (rev 7; **rebased to current main 2026-07-22** — §3 evidence re-verified, migration
numbering re-based; frozen for code)
**Branch/HEAD:** `payroll/reports-center` / off `main` `2c3e16f4` (worktree `.claude/worktrees/wf-reports-center`)
**Database target:** shared-dev (operator-applied migrations) → verified live before E2E
**Approved scope date:** 2026-07-22 (rev-2 implementation plan approved; build in slices, Slice 1 = DB + live-verify)

Spec: `docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md` §15.1/§15.5/§15.6/§15.8. Mockup:
`mockups/payroll-enterprise/reports.html` (re-implemented to Siomac standard, scoped `.prc-*`, Statutory look).

### Review remediation map (rev 6)

| Finding | Resolution | Section |
|---|---|---|
| R5-1 P1 purge can't recover crashed worker | artifacts gain `purge_token`, `purge_lease_expires_at`, `purge_attempts`, `purge_error`; `purge_claim` claims **active OR expired-purging**; token-checked idempotent finalize; same-token retry→one event; stale→reject | §6, §6B |
| R5-2 P1 history/status lost record/class gates | history rows **filtered by class** (employee→`view_all`, export/audit→`reports.export`); status = **owner OR class-authorized** else 404 (no UUID probing); cross-user negatives | §5, §9 |
| R5-3 P1 request schemas deferred | **§5A2 exact per-key `ReportParams` union now** (required/optional/enums/mutual-exclusion/bounds) | §5A2 |
| R5-4 P1 money/unit violations | `VarianceRow` → discriminated **`VarianceValue`** (money uses `MoneyValue`); **`ChartSeries` gains `unit`** | §5B |
| R5-5 P1 admin-editable policy unimplemented | *(superseded by R7)* | — |
| R7 product decision: no unsourced threshold | **Statutory reconciliation = exact match / zero tolerance** (no `finance_payroll_report_policy` table in Phase A); the 10% / TTD 2,500 materiality default was an unsourced assumption — **removed, not seeded**; an optional internal escalation/materiality policy is deferred to Payroll Setup | §2, §4A, §5A2, §5B, §6, §14 |
| R5-6 P2 memory stale | memory updated (schedules→Phase B, `report_policy` rename, queued→running, purge-token) | memory |
| R6-1 P0 single permission class cannot represent employee export | replace `permission_class` with additive `requires_view_all` + `requires_export`; all run/status/history/download gates enforce every true requirement | §5, §6, §9 |
| R6-2 P1 owner bypasses current authorization on status | status requires `(owner OR reports.export reviewer) AND reports.view AND current additive gates`; unauthorized returns 404 | §5, §9 |
| R6-3 P1 contradictory report/params and incomplete format rules | remove the outer report discriminant; `params.report` is authoritative; freeze exact report-format matrix | §5A, §5A2 |
| R6-4 P1 purge stale-token replay and missing failure path | token checked before idempotent return; add token-checked `purge_fail` | §6, §6B |
| R6-5 P1 uncommitted Storage objects undiscoverable | add durable upload-attempt ledger and token-aware orphan cleanup | §6A |
| R6-6 P1 job status admits impossible shapes | replace optional status fields with a state-discriminated union | §5B |
| R6-7 P2 signed-URL lifetime unspecified | freeze artifact signed URLs to 120 seconds and test the bound | §5, §6A, §12 |

Prior resolved (rev 1–4): frontend/widget-board scope, conditional idempotency, claim/heartbeat lifecycle,
money/date/period bounds, retention fields & 410, preview audit, permissions reuse, legacy cutover, attempt-specific
immutable Storage paths, divergent-completion 409, released-run eligibility, download/purge audit ownership, retry
boundary, KPI redaction.

---

## 1. Objective

Payroll reports from **locked, authorized** run data — previewed or exported to tamper-evident files with
permission-gated history/download. Server-owned 9-key catalog; wired `PayrollReportsPage`; every key returns the
**exact frozen DTO**; file exports run durably (worker) → checksum artifact in protected Storage → signed-URL
download; `status` read-only; focused live E2E + browser journey green. Personas: Payroll Officer/Manager,
Finance/Statutory reviewers. Currency TTD.

## 2. Scope

**Backend routes:** `reports/catalog`, `reports/summary`, `reports/run`, `reports/status` (read-only),
`reports/history/list`, `reports/artifacts/download`. Durable job queue + generation worker + purge worker.
Protected-Storage artifacts. **No report-policy table in Phase A** — statutory reconciliation is exact-match /
zero-tolerance; the materiality/escalation threshold is deferred to Payroll Setup (nothing seeded).
Transactional RPCs (all `public SECURITY INVOKER`, service_role-only). 9 reports (reuse engine + net-new). Legacy
`reports/list`+`run` deleted at cutover (grep gate §10A).

**Frontend — wired `src/components/sections/Finance/payroll/reports/PayrollReportsPage.tsx`:** PageHeader → **KPI
widget board** (Statutory pattern + atomic skeleton gate) → **fixed** catalog + parameter workspace + preview →
**fixed** history register; Run dialog outside the board. 5 KPI widgets (§4A). Catalog nav (9) ↔ catalog; per-report
params (FK pickers) + format ↔ run; preview (tables / 3 charts reduced-motion / reconciliation); queued file reports
poll `status` (no fabricated rows); history ↔ history/list; download ↔ artifacts/download. Atomic skeleton gate;
empty/error/403/disabled; toasts; Run-dialog focus trap.

**Non-goals (Phase B, omitted cleanly):** `report-schedules/*`; Scheduled Reports section/register/dialogs/buttons +
its KPI tile; **governed policy editing** (Phase A policy is seeded/read-only); new statutory rates.

### Dependencies

| Dependency | Owner | Contract | Failure |
|---|---|---|---|
| Report engine | payroll | `payrollReports.ts` `runPayrollReport` | reused compute |
| Locked run data | payroll | `finance_payroll_runs` (state ∈ locked/released/exported), `_run_lines`, calc versions | ineligible → 422 |
| Permissions (EXIST) | security | `reports.view/.export`, `view_all` | drift-guard (none added) |
| Protected Storage | platform | private bucket + `createSignedUrl` + `remove` | upload/sign fail → job failed / 503 |
| Scheduled fns | platform | generation worker + purge worker | worker down → jobs `queued`, visible |
| Events/audit | platform | `app_events`, `audit_logs` | written **inside** RPC; failure rolls back |

## 3. Current-state verification

| Item | Evidence |
|---|---|
| Branch | `payroll/reports-center` off `main` `2c3e16f4` (worktree `.claude/worktrees/wf-reports-center`); highest migration on main `20260919000730` → next-free block `…740` |
| Legacy routes/callers (re-verified) | `reports/{run,list}` [`netlify/functions/routes/financePayroll.ts:1174/1670`]; `runReport`/`listReports` wrappers [`src/api/finance/payroll.ts:668-669`]; E2E callers [`scripts/e2e/suites/financePayroll.mjs:2868+`]. **No `PayrollOverview.tsx` consumer on current main** — the api wrapper is the sole FE consumer. |
| Run states (re-verified) | `PayrollRunState` incl. **locked, released, exported** [`types/payrollRuns.ts`]; run-status eligibility guards in [`netlify/functions/lib/finance/payrollRuns.ts`] |
| Money (re-verified) | shared `MoneyValue{amount:number;currency:'TTD'}` [`types/payrollRuns.ts`], dollars 2dp; `r2` [`netlify/functions/lib/finance/payrollReports.ts:301`]; `money()` helper [`netlify/functions/lib/finance/payroll/runRegister.ts:480`] |
| Permissions (re-verified) | `finance.payroll.view_all` [`netlify/functions/lib/permissions.ts:366`], `finance.payroll.reports.view` [:369], `finance.payroll.reports.export` [:370] |
| Tx RPC / Storage patterns (re-verified) | `finance_payroll_create_run_tx` [`netlify/functions/lib/finance/payroll/execution.ts:177`] (payroll lib now under `lib/finance/payroll/`); `createSignedUrl` [`…/attachments.ts:455`], `remove` [`…/disbursements.ts:432`] |
| Shared-contract convention (new) | root-level `types/` holds cross-boundary DTOs (`types/payrollRuns.ts`, `types/messaging.ts`) → **F-12 shared contract goes in `types/payrollReports.ts`**; backend never imports `src/api` |

## 4. UI inventory (`PayrollReportsPage`)

UI-RPT-001 KPI board + skeleton gate · 002 five KPI widgets · 003 catalog nav (9, filtered) · 004 parameter
workspace (FK pickers) · 005 Run button+dialog (preview→inline / file→queued; focus trap; 400/422/409/403 field) ·
006 table preview · 007 3 charts (`scopeId` verified) · 008 reconciliation (balanced iff every difference is exactly zero) · 009
queued/pending (poll, no fake rows) · 010 history (fixed) · 011 download (fresh signed URL; 403 additive gate; 410 purged) ·
012 denied. Each has empty/loading/error states + `BUI-RPT-0xx` (matrix §5).

### 4A. KPI tile definitions (exact)

`reports/summary` → `ReportKpiTiles` with `Tile = { value: number | null; available: boolean }`. Denied/inapplicable
tile → **`{value:null, available:false}`** (never fake 0, never leak). Tiles: availableReports (count runnable catalog
keys), generatedThisMonth (succeeded artifacts this **AST** month; export-required rows excluded without `reports.export`),
nisExceptions (open unverified/continuity_review for latest locked/released run; needs `view_all`), materialVariances
(**Phase A: always `{value:null, available:false}`** — no materiality/escalation threshold is defined; that policy is
deferred to Payroll Setup and this tile activates only when it exists), auditPackages (succeeded
`export_audit_package` this AST month; needs `reports.export`).

## 5. API inventory

| ID | Path | Permission (base + gate) | Request | Response | Errors |
|---|---|---|---|---|---|
| API-RPT-001 | reports/catalog | reports.view; filter keys | `{}` | `{reports: ReportCatalogEntry[]}` | 401/403 |
| API-RPT-002 | reports/summary | reports.view; redact per §4A | `{}` | `ReportKpiTiles` | 401/403 |
| API-RPT-003 | reports/run | reports.view + every derived additive gate (§5C) | `RunReportRequest` (§5A) | `ReportRunResult` (§5B) | 400 unknown/missing-key/blank-key, 403, 409, 422 ineligible/period>24m/mutual-excl |
| API-RPT-004 | reports/status | `reports.view` + **(owner OR reviewer)** + all current additive record/output gates (§5C) | `{jobId}` | `ReportJobStatus` | 401/403; **404 for any failed record-level condition** (no existence leak) |
| API-RPT-005 | reports/history/list | reports.view; **rows filtered by every additive gate** (§5C) | `{cursor?,limit,reportKey?}` | `PageResult<ReportArtifactRow>` | 400/401/403 |
| API-RPT-006 | reports/artifacts/download | reports.view + every additive gate (§5C) | `{artifactId}` | `{url,expiresAt}` (120-second TTL) | 401/403/404/410 |

### 5A. Request envelope (conditional idempotency; one report discriminant)

`params.report` is the **only** report discriminator. There is no outer `report` field, so the route cannot accept
contradictory report identities.

```ts
type StandardFileFormat = 'xlsx' | 'csv' | 'pdf';
type InteractiveReportParams = Exclude<ReportParams, { report: 'export_audit_package' }>;
type AuditPackageParams = Extract<ReportParams, { report: 'export_audit_package' }>;

type RunReportRequest = // each branch and nested params are .strict()
  | { params: InteractiveReportParams; format: 'preview' } // idempotencyKey forbidden
  | { params: InteractiveReportParams; format: StandardFileFormat;
      idempotencyKey: string /* nonblank 8..128 */ }
  | { params: AuditPackageParams; format: 'zip';
      idempotencyKey: string /* nonblank 8..128 */ };
```

The exact format matrix is frozen: the first eight reports support `preview|xlsx|csv|pdf`;
`export_audit_package` supports **zip only**. Therefore audit-package preview and non-ZIP files are 400
`invalid_format`; ZIP for any other report is also 400. File format missing/blank idempotency key → 400;
`preview` with `idempotencyKey` → 400 (unknown field). The server derives `report_key = params.report`.

### 5A2. Exact per-key request params (R5-3 — frozen now)

`Period = { from: string /*YYYY-MM*/; to: string /*YYYY-MM*/ }`, `to ≥ from`, span ≤ 24 months (else 422).
`runId`, `compareRunId`, and `payGroupId` are UUIDs. `departmentId` is the canonical `departments.id` TEXT key;
`ownerId` is `app_users.id` TEXT. Every reference is validated against an accessible active record; run references
must be eligible (state ∈ locked/released/exported). Unknown fields are rejected (`.strict()`).

```ts
type ReportParams =
  | { report:'payroll_register'; runId:string; departmentId?:string; payGroupId?:string }
  | { report:'net_pay_summary'; runId:string; groupBy?:'pay_group'|'department'|'cost_centre' }
  | { report:'payroll_cost_analysis'; period:Period; groupBy?:'department_cost_centre'|'pay_group';
      include?:'gross_net_employer'|'gross_net' }
  | { report:'gross_to_net_reconciliation'; runId:string; compareAgainst?:'outputs' /* Phase-A: 'gl' deferred, DEC-RPT-035 */ } /* exact match, no tolerance */
  | { report:'variance_analysis'; runId:string; compareRunId?:string /* omit ⇒ prior released; if set, ≠ runId */ }
  | { report:'overtime_allowance_analysis'; period:Period; groupBy?:'department'|'cost_centre'|'pay_group';
      thresholdMode?:'all'|'exceptions' }
  | { report:'population_movements'; period:Period; movementType?:'all'|'hires_leavers'|'leave' /* Phase-A: NO 'transfers' — DEC-RPT-034 */;
      evidenceStatus?:'all'|'missing'|'verified' }
  | { report:'nis_exceptions'; scope:'run'|'all'; runId?:string /* required iff scope='run'; forbidden iff 'all' */;
      status?:'open'|'all'; ownerId?:string }
  | { report:'export_audit_package'; runId:string; include?:'full'|'exports'|'decisions' };
```

Mutual-exclusion/conditional rules (422 `invalid_params` when violated, each with a named E2E): `nis_exceptions`
`runId` required iff `scope='run'`; `variance_analysis` `compareRunId ≠ runId`. `reportDefinitions` re-exports THIS union so
the UI form and route zod share one definition (no divergence). Format/report incompatibility is validated before
enqueue or preview execution and produces no job, event, audit, or Storage object.

### 5B. Frozen output contracts (exact)

Money = `MoneyValue{amount:number;'TTD'}` (dollars, `r2`). Timestamps ISO-UTC; business dates `YYYY-MM-DD`; period/"this
month" in AST. Stable sort per key. Limits: period ≤24mo, preview ≤5,000 rows, chart ≤24 points/6 series. Basis = run's
current locked calc version (or `calculationVersionId`); run state ∈ locked/released/exported else 422. Every completed
result carries `scopeId`.

```ts
interface ReportControlTotals { employees: number; gross: MoneyValue; deductions: MoneyValue; net: MoneyValue }
// R5-4: unit-aware chart series so the FE can tell TTD from counts/hours/percent.
interface ChartSeries { label: string; unit: 'TTD' | 'count' | 'hours' | 'percent'; points: { x: string; y: number }[] }
interface ReportChart { scopeId: string; series: ChartSeries[] }

interface RegisterRow { employeeId: string; employeeName: string; payGroup: string;
  gross: MoneyValue; paye: MoneyValue; nis: MoneyValue; other: MoneyValue; net: MoneyValue }
interface NetPaySummaryRow { group: string; employees: number; gross: MoneyValue; deductions: MoneyValue;
  net: MoneyValue; readiness: 'ready'|'held'|'review' }
interface CostRow { department: string; costCentre: string; employees: number; gross: MoneyValue;
  employerCost: MoneyValue; vsPriorPct: number }
// R5-4: variance money uses MoneyValue via a discriminated value.
type VarianceValue =
  | { unit: 'money'; prior: MoneyValue; current: MoneyValue }
  | { unit: 'count' | 'hours' | 'percent'; prior: number; current: number };
interface VarianceRow { measure: string; value: VarianceValue; changePct: number; driver: string; certified: boolean }
interface OvertimeRow { department: string; employees: number; overtimeHours: number;
  overtimeCost: MoneyValue; allowanceCost: MoneyValue; controlStatus: 'approved'|'threshold'|'review' }
interface PopulationMovementRow { employeeId: string; employeeName: string;
  movement: 'hire'|'unpaid_leave'|'leaver' /* Phase-A: NO 'transfer' — DEC-RPT-034 */; effectiveDate: string;
  priorAssignment: string; currentAssignment: string; payrollImpact: string; evidence: string }
interface NisExceptionRow { employeeId: string; employeeName: string; nisNumber: string | null; nisClass: string;
  profileStatus: 'unverified'|'continuity_review'; payrollImpact: string; owner: string }
// Statutory reconciliation is EXACT: `balanced` iff every source `difference.amount === 0` (zero tolerance).
interface ReconciliationResult { scopeId: string; currency: 'TTD'; balanced: boolean;
  sources: { source: string; registerTotal: MoneyValue; summaryTotal: MoneyValue; difference: MoneyValue;
             matched: boolean /* difference.amount === 0 */; evidenceRef: string }[] }

type ReportRunResult =
  | { state: 'queued'; jobId: string }
  | ({ state: 'completed'; scopeId: string; generatedAt: string } & (
      | { report:'payroll_register'; rows: RegisterRow[]; totals: ReportControlTotals }
      | { report:'net_pay_summary'; rows: NetPaySummaryRow[]; totals: ReportControlTotals }
      | { report:'payroll_cost_analysis'; rows: CostRow[]; chart: ReportChart; totals: ReportControlTotals }
      | { report:'gross_to_net_reconciliation'; reconciliation: ReconciliationResult }
      | { report:'variance_analysis'; rows: VarianceRow[]; chart: ReportChart }
      | { report:'overtime_allowance_analysis'; rows: OvertimeRow[]; chart: ReportChart }
      | { report:'population_movements'; rows: PopulationMovementRow[] }
      | { report:'nis_exceptions'; rows: NisExceptionRow[] }
    ));
// export_audit_package: no inline completed variant — always queued; status result carries the artifact.
type ReportArtifactFormat = StandardFileFormat | 'zip'; // preview is never persisted
interface ReportArtifactRow { id: string; reportKey: PayrollReportKey; scopeId: string; format: ReportArtifactFormat;
  byteSize: number; sha256: string; rowCount: number; retentionClass: string; retentionExpiresAt: string;
  requiresViewAll: boolean; requiresExport: boolean;
  status: 'ready'|'purging'|'purged'; createdBy: string; createdAt: string }

type ReportJobStatus =
  | { state:'queued'; jobId:string; queuedAt:string }
  | { state:'running'; jobId:string; startedAt:string; leaseExpiresAt:string }
  | { state:'succeeded'; jobId:string; completedAt:string; artifact:ReportArtifactRow }
  | { state:'failed'; jobId:string; failedAt:string;
      error:{ code:string; message:string; retryable:boolean } };
```

### 5C. Additive record/output authorization (R6-1/R6-2)

Jobs and artifacts store two independent requirements, never a single mutually-exclusive class:

```ts
interface ReportPermissionRequirements {
  requiresViewAll: boolean; // employee-level rows or identifiers
  requiresExport: boolean;  // any downloadable file, including employee exports
}
```

The server derives these booleans from the report definition and requested format; the client cannot supply them.
`requiresViewAll=true` requires current `finance.payroll.view_all`; `requiresExport=true` requires current
`finance.payroll.reports.export`; every route also requires current `finance.payroll.reports.view`.

Examples: aggregate preview = false/false; payroll-register preview = true/false; aggregate CSV = false/true;
payroll-register XLSX = true/true; export-audit ZIP = false/true. `history/list` omits any row for which any required
permission is absent. `download` returns 403 after the artifact lookup when a gate is absent. `status` returns a job
only when **(actor is `requested_by` OR actor currently holds `reports.export` as reviewer authority) AND
`reports.view` AND every stored requirement**. All other status lookups return 404, including an owner whose access
was revoked after enqueue. The job worker never weakens these checks; permissions are re-evaluated at every read.

## 6. Data model and migration

| Object | Definition | Constraints | RLS/grants |
|---|---|---|---|
| `payroll_report_jobs` | id, report_key, params jsonb, format, scope jsonb, scope_id text, requested_by, request_hash, idempotency_key, **requires_view_all, requires_export**, state (queued\|running\|succeeded\|failed), attempts, max_attempts, claim_token uuid, lease_expires_at, error jsonb, artifact_id null, started_at, completed_at, failed_at, created_at, updated_at | unique(requested_by, idempotency_key); state check; idx(state, lease_expires_at); **`artifact_id → artifacts.id ON DELETE SET NULL`** (added after artifacts exists) | RLS; service_role only |
| `payroll_report_upload_attempts` | id, job_id, claim_token, storage_path, sha256, byte_size, created_at, committed_at null, last_cleanup_at null, cleanup_attempts default 0 | unique(job_id,claim_token); unique(storage_path); **`job_id → jobs.id ON DELETE CASCADE`**; row registered **before upload**; uncommitted rows retained through 24h quarantine | RLS; service_role only |
| `payroll_report_artifacts` | …storage_path, content_type, byte_size, sha256, scope jsonb, scope_id text, row_count, retention_class, retention_expires_at, **requires_view_all, requires_export**, format, created_by, created_at, **purge_state (active\|purging\|purged)**, purged_at null, **purge_token uuid null, purge_lease_expires_at null, purge_attempts int default 0, purge_error null** | unique(job_id); sha256 not null; format excludes preview; **`job_id → jobs.id ON DELETE CASCADE`** | RLS; base append-only; **column grant `UPDATE(purge_state,purged_at,purge_token,purge_lease_expires_at,purge_attempts,purge_error)` → service_role** |

**RPCs — all `public SECURITY INVOKER`, `SET search_path=pg_catalog, public`, execute→service_role only:**
`enqueue_tx` · `claim` (queued or expired-running) · `heartbeat` · **`register_upload_attempt_tx`** (valid running
token; writes the ledger before upload) · `complete_tx` (token+ledger checked; marks attempt committed in the same
transaction; already-succeeded → identical(token,path,sha256,size)→original else **409**) · `fail_tx`
(`nextAttempts=attempts+1`, requeue iff <max else failed) · `log_run` (preview audit) · `log_download` (download audit)
· **`purge_claim`** · **`purge_fail`** · **`purge_finalize`** (see §6B). The Storage orphan reconciler reads the upload
ledger through a bounded service-role query; it does not expose a browser-callable route.

### 6A. Storage↔DB recovery (generation)

Attempt-specific immutable path `payroll-report-artifacts/<job_id>/<claim_token>/<sha256>.<ext>`, `upsert:false`;
the worker calls `register_upload_attempt_tx` **before** upload, and that RPC accepts only the job's current running
claim token. `complete_tx` commits only the same valid token's ledger path and marks that attempt committed in the
artifact transaction. Commit-fail removes only the caller's path; missing-object removal is idempotent.

The scheduled **orphan-object reconciler** scans a bounded page of uncommitted upload-attempt rows whose job token is
no longer current or whose lease expired. It removes each recorded Storage path and increments `cleanup_attempts`.
Rows remain eligible for repeated removal for a 24-hour quarantine, covering a displaced worker that uploads late
after an earlier cleanup. After 24 hours, a final remove/missing confirmation permits ledger-row deletion. The
reconciler never deletes the path referenced by a committed artifact, and verifies that condition again immediately
before each remove. Thus an upload-before-commit crash is discoverable without listing the whole bucket, while late
stale uploads are eventually removed.

Download reads committed artifact metadata only → never exposes an uncommitted object; 410 iff
`purge_state ∈ {purging,purged}` OR `now() ≥ retention_expires_at`. Otherwise it writes the download audit and returns
a fresh **120-second** signed URL; `expiresAt` must equal server issue time + 120 seconds within a 2-second test
tolerance. The UI never caches or persists the signed URL.

### 6B. Purge saga with recovery (R5-1)

Postgres cannot call Storage → worker-owned saga with the SAME claim/lease/token model as generation:
1. **`purge_claim`** selects artifacts where `now() ≥ retention_expires_at` AND (`purge_state='active'` **OR**
   (`purge_state='purging'` AND `purge_lease_expires_at < now()`)) `FOR UPDATE SKIP LOCKED`; sets `purge_state='purging'`,
   a new `purge_token`, `purge_lease_expires_at=now()+lease`, `purge_attempts=purge_attempts+1`; returns `storage_path`.
2. Worker `storage.remove(paths)` — a **missing object is treated as already removed** (idempotent). Every returned
   Storage error is checked; no error is swallowed.
3. On remove failure, **`purge_fail(id, purge_token, error)`** locks the artifact and checks token equality before any
   state read/write. A stale token rejects. The current token records bounded/sanitized `purge_error`, expires its
   lease so the row is re-claimable, and emits no business event.
4. On remove success, **`purge_finalize(id, purge_token)`** locks the artifact and checks token equality **first,
   including when the row is already purged**. A stale/different token always rejects. With the same token:
   `purge_state='purged'` returns the original result without another event; `purge_state='purging'` sets
   `purge_state='purged'` and `purged_at`, then writes exactly one `payroll.report.purged` event + audit in the same
   transaction. Any other state rejects. Finalize preserves the winning `purge_token` so same-token replay can be
   distinguished from a stale-token call.
5. A finalize crash leaves the row `purging` with an expired lease → re-claimable at step 1 (recovery). Download
   denies for `purging`/`purged`/retention-expired throughout.

### Migration rules

Order: jobs → upload-attempt ledger (`job_id → jobs ON DELETE CASCADE`) → artifacts
(`job_id → jobs ON DELETE CASCADE`) → **`ALTER payroll_report_jobs ADD artifact_id → artifacts.id ON DELETE SET NULL`**
(deferred to break the jobs↔artifacts cycle) → RPCs → private bucket
`payroll-report-artifacts`. Operator-applied +
`NOTIFY pgrst,'reload schema'`. Live-verify columns/grants (incl. column-level UPDATE grant + purge columns), RPCs
`SECURITY INVOKER` public, bucket private. (No report-policy table in Phase A.)

## 7. State machine — `payroll_report_jobs`

queued → running (claim: token+lease) → succeeded (`complete_tx`) | failed (`fail_tx`, `nextAttempts` boundary);
heartbeat renews lease; running past lease reclaimed; displaced worker stale-token-rejected. Illegal/no-op: re-run
same key+hash → original; duplicate completion identical→original / divergent→409; stale-token complete/fail →
rejected; status read-only. **Purge lifecycle (artifacts):** active → purging (claim) → purged (finalize); stranded
purging (expired lease) → re-claimable.

## 8. Mutation ownership

MUT-RPT-001 enqueue (`payroll.report.enqueued` ×1 + audit, enqueue_tx) · 002 complete (`…completed` ×1 + audit,
complete_tx) · 003 fail/requeue (`…failed`|`requeued` ×1 + audit) · 004 preview (audit only, log_run) · 005 download
(audit only, log_download) · 006 purge (`payroll.report.purged` ×1 + audit, **exactly once even after retry**,
purge_finalize) · 007 operational upload-attempt registration/cleanup (no business event; audited through job
completion/failure and worker logs). Idempotency: enqueue unique(requested_by, key), same→original, divergent→409,
concurrent→one; complete unique(job_id)+token+ledger; purge token+idempotent. Failure matrix: FAIL-RPT-001 enqueue
rollback · 002 upload-fail remove own path + fail · 003 crash lease reclaim · 004 stale-token reject · 005
upload-ok/commit-fail object remains discoverable in ledger and is repeatedly removed during quarantine · 006
purge-finalize crash → stays purging, re-claimed, one event · 007 purge-remove failure → token-checked `purge_fail`,
error recorded, lease expired, re-claimable.

## 9. Permission matrix (existing keys only; additive record/output gates)

| Route | Base | Additional gate |
|---|---|---|
| catalog / summary | reports.view | filter/redact per additive requirement (§4A/§5C) |
| run (aggregate) | reports.view | — |
| run/preview employee-level (register, net_pay, nis) | reports.view | **`view_all`** |
| run file export | reports.view | **`reports.export` plus `view_all` when employee-level** |
| artifact download | reports.view | all stored requirements: export always; view_all additionally when employee-level |
| history/list | reports.view | **row-filtered by both independent requirements** |
| status | reports.view | **(owner OR reports.export reviewer) AND all stored requirements**; else 404 |

Negatives: AUTH-RPT-001 officer w/o `view_all` → employee report 403 · 002 non-payroll → 403 · 003 w/o
`reports.export` → file export/download 403 · **004 non-owner basic viewer → status 404** · **005 history omits rows
when either requirement is absent** · **006 reports.export without view_all cannot run/read employee export** ·
**007 view_all without reports.export cannot run/download any file** · **008 owner whose reports.view or a stored
requirement was revoked gets status 404**. No new keys.

## 10. Cross-module + 10A cutover

report completed/purged → `app_events`; preview/download → audit. Cutover: delete `reports/{run,list}`
(`routes/financePayroll.ts:1174/1670`) + `runReport`/`listReports` (`src/api/finance/payroll.ts:668-669`),
migrate the `financePayroll.mjs` report E2E callers (`:2868+`) — only after a repo grep test asserts zero
remaining refs to `finance/payroll/reports/list` and legacy `run` in `src/ netlify/ scripts/`. (No
`PayrollOverview.tsx` consumer exists on current main.)

## 11. Query and scale

Jobs low-volume; artifacts purged at `retention_expires_at`. Reports scan 1 run / 2 runs / ≤24-month period. History
keyset `(created_at desc, id)` ≤100/25. Engine reads paginate. Worker claims ≤N/tick; idx(state, lease_expires_at)
(generation), orphan-attempt scan on `(committed_at, created_at)`, and retention/purge scan on
`(purge_state, retention_expires_at, purge_lease_expires_at)`. Orphan reconciliation and both claim RPCs use bounded
pages plus `FOR UPDATE SKIP LOCKED`; no whole-bucket listing. Preview ≤5,000 rows else export.

## 12. UX and accessibility

Atomic skeleton gate on the KPI board; KPI skeleton on cold path (never fake 0); fixed catalog/params/preview/history.
Real empty/error/403. Queued reports poll status, no fabricated rows. Charts reduced-motion + `scopeId`/`unit`
verified. Run dialog: focus trap, initial focus, Escape, submit disabled until valid, pending lockout, field-level
400/422/409/403, restored focus; close during submit doesn't cancel the job. Toasts; responsive; employee data masked
per `view_all`. Download URLs expire after 120 seconds, are held in memory only, and are requested again for every
download action.

## 13. Test scope (highlights; full matrix in `PAYROLL_REPORTS_E2E_MATRIX.md`)

Unit: per-key **request-param** validation (required/enum/mutual-exclusion/bounds) + output DTO; reconciliation
balanced-iff-every-difference-exactly-zero (exact match, no tolerance/policy); idempotency hash; chart `scopeId`+`unit`; AST month; retry
boundary; one report discriminant; exact format matrix (audit preview/non-ZIP rejected, non-audit ZIP rejected);
state-discriminated job status. DB/RPC: RPC atomicity; claim SKIP-LOCKED + running + reclaim + heartbeat; upload
attempt registered before upload; complete idempotent + divergent 409 + ledger commit; artifact append-only +
unique(job_id); **purge saga claim(active|expired-purging)→remove→finalize(token,idempotent)→one event after retry**;
same-token finalized replay returns original, different/stale token rejects even after purged; `purge_fail` is
token-checked and makes the row re-claimable. Live API E2E: catalog metadata; each key exact §5B
DTO; charts scope+unit; reconciliation exact-match (balanced iff every diff exactly 0; `matched` per source; no
tolerance/policy); materialVariances tile → available:false (no threshold in Phase A); file→worker→artifact checksum/scope/retention/additive requirements; download
bytes+checksum+both-gates+audit + 410 + **TTL ≤120s**; status read-only; idempotency
same/divergent/missing-blank/concurrent; worker exactly-once; crash after upload/before commit leaves a discoverable
ledger row; orphan reconciler removes it; simulated late stale upload is removed during quarantine; purge one
event+audit after finalize retry; KPI formulas + denied→available:false; eligibility locked/released/exported;
**cross-user status 404, revoked-owner status 404, history additive filtering, reports.export-only denied employee
export, view_all-only denied every file**; negative authz; cutover grep gate. Browser/component: KPI-board loading-gate
+ journey + §15.8 dialog/failure. Cleanup: `h.TAG`, `h.mustDelete` artifacts→upload attempts→jobs + Storage; sweeper
BUSINESS_TAGGED += `payroll_report_*`. Full regression at end; coverage gate.

## 14. Decisions

001 phased · 002 real worker/read-only status · 003 catalog + cutover gate · 004 reuse existing perms · 005 schedules
Phase B · **006 reconciliation EXACT match / zero tolerance — no policy table, no tolerance param, no missing-policy 422 (R7)** · 007 execution by format · 008 protected Storage + §6A · 009 all RPCs
public SECURITY INVOKER · 010 frontend in scope · 011 schedule surface omitted · 012 queued→running + heartbeat · 013
conditional idempotency · 014 frozen money/date/limits/basis + exact DTOs · 015 KPI formulas · 016 retention + purge ·
017 preview single audit · 018 KPI widget board + fixed content · 019 attempt-specific immutable path · 020 purge saga
· 021 divergent-completion 409 · 022 eligible states locked/released/exported · 023 download+purge audit · 024 retry
boundary · **025 NO report-policy table / NO seeded threshold in Phase A. Statutory reconciliation = exact match,
zero tolerance. The 10%/TTD 2,500 materiality default was an unsourced product assumption, removed; the optional
materiality/escalation policy is deferred to Payroll Setup (R7, supersedes R5-5)** · **026 purge recovery: purge_token/lease/attempts/error; claim active|expired-purging;
token-checked idempotent finalize (R5-1)** · **027 additive requirements on run/history/download plus
`(owner|reviewer) AND current requirements` on status, 404 on record-level denial (R6-1/R6-2)** · **028 exact per-key
request params union frozen with `params.report` as the sole discriminant and an exact format matrix (R6-3)** ·
**029 VarianceValue + unit-aware ChartSeries (R5-4)** · **030 purge token checked before every state branch;
token-checked purge_fail (R6-4)** · **031 upload-attempt ledger + 24h repeated-removal quarantine for uncommitted
Storage objects (R6-5)** · **032 state-discriminated job status DTO (R6-6)** · **033 signed download URL TTL=120s,
memory-only (R6-7)** · **034 (Phase-A scope, user-approved 2026-07-22) `population_movements` ships hires/leavers/leave
ONLY — `transfers` is REMOVED from the DTO enum, filter options, charts, tests and catalog description because there
is no first-class HR transfer source table. Deriving transfers from department/cost-centre change history is
explicitly out of scope. Phase-B gap: add an HR transfer/movement model first, then re-add transfer movements +
update the DTO enum + E2E.** · **035 (Phase-A scope, 2026-07-22) `gross_to_net_reconciliation` implements
`compareAgainst:'outputs'` ONLY — run header totals vs SUM of run lines (exact match, zero tolerance). The
`'gl'` comparison is deferred to Phase B: it needs the confirmed `finance_payroll_gl_mappings`
component→account mapping + journal-per-run linkage semantics, which are NOT guessed. Field kept for
forward-compat.**

**Product decision — RESOLVED (R7):** Phase A seeds **no** monetary/percentage threshold. Statutory reconciliation
uses **exact matching (zero tolerance)** — `balanced` iff every source difference is exactly 0. The optional internal
materiality/escalation policy is a **future Payroll Setup** capability, not created or seeded here; the
`materialVariances` KPI tile stays `available:false` until that policy exists.

## 15. Implementation handoff

Before code:
1. Replace the Rev 5 contract on `wf/payroll-reports` with this Rev 6 contract; do not layer a contradictory addendum.
2. Revise `PAYROLL_REPORTS_E2E_MATRIX.md` so every bold invariant in §13 has a named test, especially the two-gate
   confidentiality cases, revoked-owner status, format incompatibilities, upload-orphan quarantine, purge stale-token
   behavior, and the 120-second signed-URL bound.
3. Update the Reports Center memory to Rev 6 (additive gates, upload-attempt ledger, `purge_fail`, exact status union,
   120-second URL TTL). Schedules remain Phase B.
4. DEC-RPT-025 product decision RESOLVED (R7): no policy table / no seeded threshold; reconciliation exact-match. Nothing to obtain.
5. Return the aligned contract + matrix for one final review; then implement migration → backend → E2E → frontend,
   with operator-applied migrations and live verification. Do not claim completion from static checks.

## 16. Approval

Product/scope __ · Security/SQL __ (RPCs/storage/purge saga+recovery/column grants/additive gates) · UX __ · Test-plan __
· Date __
