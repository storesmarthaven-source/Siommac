# Payroll Enterprise UX and Control Plane - Implementation Specification

## 1. Purpose

Implement the approved payroll experience shown in this folder without replacing working payroll domain logic. The target is a payroll control plane suitable for an organization processing roughly 300 employees, while preserving the current support for 1,100+ employees proven by the scale E2E suite.

This document is build guidance for Claude. It is not authorization to bypass the repository build order. Production implementation starts only after the user explicitly approves the relevant Finance phase.

## 1A. Current Code Reconciliation (2026-07-17)

This section is authoritative when an older section or mockup note conflicts with the current
codebase. Generated maps are navigation aids; re-read the referenced source before editing.

### Verified current capabilities

| Capability | Current implementation | Required treatment |
|---|---|---|
| Payroll submission | `workflow_submit_for_record_tx` commits run status, `workflow_id`, workflow instance/tasks, business event, HR audit and approval handoff in one transaction. | Reuse. Do not restore the legacy status-flip/start/stamp sequence or compensating rollback. |
| Submit idempotency | `/api/finance/payroll/runs/submit` and `src/api/finance/payroll.ts` require `idempotencyKey`. The caller creates one key per logical command and reuses it only for a retry. | Required contract. Never generate a replacement key after the network boundary and never make it optional to satisfy an old caller. |
| Workflow decisions | Approval is assigned by the workflow definition and enforced by the engine, including maker-checker separation. | Decide as the actual assigned user/role. Never bypass assignment checks for UI or E2E convenience. |
| Legacy payroll API | `routes/payroll.ts` is unmounted. `/api/payroll/*` is retained only as a negative removal assertion. | Build only on `/api/finance/payroll/*`; do not extend or remount legacy endpoints. |
| Pay groups | Effective-dated groups, membership, overlap exclusion and period-correct payroll support are implemented. | Reuse canonical pay-group APIs and constraints. |
| Run identity | `period_month` is now a reporting bucket. Scheduled and exceptional runs use explicit period/type/group business keys, including a non-null sentinel for unscoped uniqueness. | Do not restore global month uniqueness or infer identity from `periodMonth`. |
| Execution evidence | Input snapshots, calculation attempts, immutable calculation versions, version comparison, sanitized failure evidence and controlled recovery are implemented in migrations 420-421 and the payroll execution service. | Build failure/recovery UX on these contracts; never infer calculation success from a spinner or overwrite prior versions. |
| Control findings | Normalized, versioned findings support assign, resolve, warning waiver and reopen commands with optimistic concurrency, idempotency and evidence. Blockers cannot be waived. | Use finding IDs, versions and command keys. Do not mutate raw warning rows from the UI. |
| Certification and release | Processor certification, funding confirmation, release preflight, three-way SoD, immutable release certificates, bank-routing snapshots, period-correct T&T remittances and downstream drafts are implemented in migrations 420 and 424. | Treat `released` as the business state. Export generation is a separate versioned artifact action. |
| GL | Preview, atomic post, reverse, exact event/audit/handoff ownership and command receipts are implemented. | Treat GL as a governed payroll output; do not recreate a second journal path. |
| Exports | Released payroll exports and downloads are immutable, versioned, checksummed and idempotent. The public artifact `checksum` is SHA-256; `content_md5` is an internal integrity value required by the table constraint. Downloads verify size, MD5 and SHA-256. A newer export replaces only `is_current`; it does not change the release certificate. | Preserve both checksum algorithms in their defined columns. Do not put SHA-256 into `content_md5`, and do not use export generation as a release transition. |
| Payslips | Generation, templates, PDF rendering, protected storage, delivery records and ESS reads exist. | Build batch/workspace UX over canonical endpoints; preserve artifact version and delivery evidence. |
| Payroll adjustments | Worksheet overrides, overtime rules, loans/advances and back pay have dedicated backend slices and live E2E suites. | Integrate them into run evidence; do not model them as mockup-only fields. |
| Statutory outputs | Remittances, statutory forms and bank disbursements are implemented as separate modules connected to payroll. | Payroll creates immutable outputs/handoffs and displays downstream status; downstream modules own payment, filing and reconciliation. |
| Reports | Payroll register, variance/audit comparisons and statutory/payroll report catalogs exist. | Use the permission-aware report APIs and governed artifacts/schedules. |

### Open integration and verification debt

1. **Migration application:** source corrections and migrations
   `20260919000420` through `20260919000425` must be applied to the target development database in
   order. Rebuild from the corrected source migrations when the environment supports a clean
   reset; do not add patch-on-top compatibility migrations.
2. **Frontend contract port:** `src/api/finance/payroll.ts` still carries stale command signatures.
   Claude's UI slice must require one caller-owned `idempotencyKey` for calculate, final lock,
   reopen, GL post/reverse, export generation and export download, and must expose the new
   workspace, attempt/version, finding, certification, funding, release and certificate APIs.
   Do not generate replacement keys inside the API wrapper.
3. **Focused live verification:** backend typecheck, E2E script parsing and the payroll contract
   gate are green. The migrations and backend must be rebuilt/restarted, then the affected payroll
   suites must pass against the live stack.
4. **Final regression:** run the complete E2E suite once only after the targeted payroll suites are
   green. A static contract gate, typecheck or mockup is not completion evidence.
5. **Downstream command hardening:** Payroll release transactionally creates the initial bank
   disbursement and T&T statutory-remittance drafts. Reopen correctly refuses to continue while
   either module has an active artifact; cancellation must be performed by that artifact's owning
   module. The existing standalone disbursement create/cancel and remittance cancellation paths
   still need their own atomic, idempotent RPCs and shared serialization with the payroll-run row
   before manual downstream commands are enterprise-complete. Do not make Payroll silently cancel
   those records or duplicate downstream state machines.
6. **Unit-test discovery (resolved 2026-07-17):** `tests/unit/payrollStatutory.test.ts` is a Jest
   test — the repo convention is `tests/**` = Jest (`npm run test:unit`), `src/**` = Vitest. Jest's
   `testMatch` (`**/tests/**/*.test.ts`) discovers it and all 25 cases pass. Run it with
   `npx jest tests/unit/payrollStatutory.test.ts`; do not invoke it through Vitest.

The earlier run-identity, scale-caller and payslip-fixture defects are resolved in source. Do not
reopen those controls by weakening uniqueness, idempotency or pay-group overlap validation.

### Current atomic ownership

For payroll submission, the database RPC owns the source transition, workflow creation, workflow
task/audit/events, payroll business event, HR audit and approval handoff in one commit. TypeScript
owns request authorization, binding lookup, RPC error mapping, post-commit notification fan-out and
response refetch. No TypeScript caller may duplicate an event, audit or handoff already written by
the RPC.

Every other multi-row payroll command must document the same ownership explicitly: business rows,
event, audit, workflow/task, notification intent and durable handoff/outbox. A failed RPC returns an
error and leaves no partial state.

Cancelled disbursement and remittance rows are immutable recovery history, not slots to reuse.
The corrected source migration drops the old full-run uniqueness constraints and enforces only one
active disbursement per payroll run and one active remittance per
`(payroll_run_id, authority, period_year, period_month)`. After the owning module cancels an active
artifact, Payroll may create one replacement while preserving the cancelled row.

### Required implementation gates

Before any payroll slice is called complete:

1. Refresh `docs/generated/modules/payroll.md` with `npm run repo:index`.
2. Run `npm run repo:index:check` and `npm run test:e2e:coverage`.
3. Run the affected payroll suites, including access denial, idempotent retry, conflicting retry,
   concurrency, rollback/no-change, exact side-effect counts and cleanup.
4. Run the complete E2E suite once after all targeted suites are green.
5. Record the exact migration state, server checkout/HEAD, commands, counts and remaining deferrals.

## 2. Reference Mockups

- `index.html`: payroll command center
- `create-run.html`: run creation wizard
- `run.html`: processor run workspace
- `approval.html`: independent approver workspace
- `failed.html`: failed calculation and controlled recovery
- `runs.html`: canonical payroll run register, saved views, correction history, archive visibility and pay calendar
- `exceptions.html`: cross-run approvals, blockers, warnings, resolved history and finding ownership actions
- `close-run.html`: close preflight, lock, output manifest and release certificate
- `payslips.html`: cross-run payslip batch register, delivery progress, scheduling, exception and retention state
- `payslip-batch.html`: one batch lifecycle, recipient register, delivery policy, retry and controlled completion
- `reports.html`: nine-report catalog, parameters, analytical previews, schedule management and artifact history
- `dialogs.html`: canonical payroll dialog, menu, toast and error-state library
- `crew-packages.html`: Payroll Setup pay-policy directory and integrity position
- `create-crew-package.html`: seven-step effective-dated pay-policy wizard
- `crew-package.html`: pay-policy configuration, versions, usage and audit workspace
- `crew-run.html`: standard payroll run with policy-specific crew controls

The mockups are information-architecture references. Do not copy static values, letter icons, or mockup-only CSS into production. Use the existing icon library, permissions, query layer, action dialogs and Finance visual tokens.

The payroll product boundary ends at the release certificate and immutable handoff creation. Bank Disbursements, Statutory Remittances and Statutory Forms remain separate modules. Their own approval, payment, filing, receipt and reconciliation pages must not be rebuilt inside Payroll.

## 3. Approved Design Decisions

Standardize only frequently repeated structures:

| Pattern | Approved choice | Production responsibility |
|---|---|---|
| Module header | `HEADER-3` | Page title, context, primary command |
| Run tabs | `TABS-2` | Stable deep links and count badges |
| Run identity | `RUNHEAD-3` | Status, stage, owner and optional metadata slots |
| Lifecycle | `LIFECYCLE-3` | Timestamps, failed state and stat band |
| KPI summary | `KPI-3` | Divided, scan-friendly metrics |
| Intent message | `BANNER-1` | One anatomy; info, warning, danger and success intents |
| Wizard progress | `WIZSTEP-2` | Seven-step navigation and completion state |
| Wizard right rail | Unique per step | Step-specific readiness, impact and supporting facts |
| Wizard footer | Footer A | Back, save draft, continue/create |
| Activity | `ACTIVITY-1` | Compact actor, event, detail and timestamp |
| Actions | Tiles on full pages; stacked in rails | Output and recovery commands |

Do not force unique content sections into a generic card template. The command center, reconciliation, approval evidence and failure diagnosis have different information needs.

## 4. Current Capabilities to Preserve

The existing code already provides meaningful enterprise behavior. Reuse it:

- Persisted payroll runs and lifecycle transitions.
- Pay groups with effective-dated membership.
- Pay date and cutoff date.
- Population preview with salaried/hourly counts, new hires, terminations, missing pay basis and missing statutory profile counts.
- Statutory version resolution and run stamping.
- Frozen input snapshot when inputs are locked.
- Gross-to-net calculation, statutory deductions and warning severities.
- Warning resolution.
- Workflow-backed maker-checker approval with separation of duties.
- Audit history and `app_events` side effects.
- Variance reports.
- GL preview and posting.
- Payslip generation, rendering and delivery.
- Bank disbursement and statutory remittance creation.
- Individual/bulk overrides, overtime rules, loans and back pay.
- Scale behavior tested at 1,100 employees.

Do not rebuild these as parallel features. Extend their contracts and present them coherently.

## 5. Required Product Additions

### 5.1 Run identity and calendar

Support multiple legitimate payroll runs in the same calendar month:

- Scheduled runs for weekly, fortnightly, semi-monthly and monthly groups.
- Off-cycle runs.
- Correction runs linked to a released source run.
- Final-pay runs for terminated employees.
- A sequence number when more than one run has the same type, group and period.
- Start/end period dates instead of relying on a single `periodMonth` identity.

The command center must list upcoming, in-progress, approval-blocked, failed and recently released runs. It must not collapse all payroll activity into one monthly record.

### 5.2 Wizard draft and preflight

The seven wizard steps are:

1. Run basics: run type, ownership and purpose.
2. Pay group: frequency, scope and scheduled population.
3. Dates: period, separate input cutoffs, funding date, release date and pay date.
4. Statutory: effective statutory version and validation result.
5. Population: employee reconciliation, hires, leavers, exclusions, bank and statutory readiness.
6. Inputs: source freshness, approved-record counts, source owner and unresolved items.
7. Review: preflight controls, financial estimate and explicit confirmations.

Wizard state must be persisted as a server-side draft. Do not keep a business draft only in component state or local storage. A resumed draft must rerun preflight checks because source readiness can change.

### 5.3 Calculation attempts and versions

Do not destructively replace the only calculated result:

- Every calculation request creates an attempt.
- A successful attempt publishes an immutable calculation version.
- A failed attempt records stage, sanitized error code, timestamps, correlation ID, input snapshot, affected count and rollback result.
- Partial calculated lines are never made current.
- Recalculation creates a new version; earlier versions remain available for audit and comparison.
- The run points to one current calculation version.

For a 300-employee run, calculation may complete synchronously, but the contract must support a queued job and progress polling. The UI must never infer success from a timed spinner.

### 5.4 Control findings

Replace the presentation-only warning concept with an operational control finding where needed:

- Severity: info, warning or blocker.
- Domain: population, input, statutory, payment, accounting, variance, funding or release.
- Owner/assignee and due date.
- Source record references.
- Resolution evidence and actor.
- Waiver policy, reason, approver and expiry when a warning is waivable.
- Blockers are never silently waived.

Existing payroll warnings can remain the calculation engine's raw output, but the run workspace needs a normalized control view. Reuse warning IDs as source references rather than duplicating the same error text into unrelated tables.

### 5.5 Approval package

Before submission, persist a certification package tied to the current calculation version:

- Population total and reconciliation evidence.
- Input snapshot ID and checksum.
- Statutory totals and version IDs.
- Material variance policy, rows and explanations.
- Payment readiness and net control total.
- GL readiness and balance result.
- Processor certification actor/time.

Approvers see this package read-only. Approve, return and reject are distinct decisions. Return/reject require a reason. The decision must use the canonical transactional workflow-decision path; do not directly flip the run status from the frontend or a secondary route.

Threshold rules may add a funding-release approval after payroll approval. The preparer, payroll approver and release approver must satisfy configured separation-of-duty rules.

### 5.6 Release, outputs and certificates

`exported` is not an adequate terminal payroll state. Exporting a CSV is one output action, not payroll release.

Add an explicit `released` business state. Release must:

- Require an approved, locked calculation version.
- Revalidate funding, bank, GL, statutory and payslip prerequisites.
- Create or link the bank-disbursement control total.
- Create or link the balanced GL journal.
- Create or link payslip and remittance batches as configured.
- Record checksums, totals, output versions, actor and timestamp in a release certificate.
- Be idempotent for the same run and calculation version.
- Use an outbox for external bank/file/delivery actions.

Generating an export must create a versioned artifact and must not itself change the run to released.

## 6. Source Schema Corrections

Follow the repository no-band-aid rule: correct the original migration source and rebuild the development database. Do not add a migration whose only purpose is to work around a known-bad uniqueness rule while leaving the source definition wrong.

### 6.1 `finance_payroll_runs`

In `supabase/migrations/20260804000000_finance_payroll_runs.sql`:

- Remove `unique` from `period_month`.
- Keep `period_month` temporarily only if reports still consume it; treat it as a derived/reporting month, not identity.
- Add:
  - `run_type text not null` constrained to `scheduled`, `off_cycle`, `correction`, `final_pay`.
  - `period_start date not null`.
  - `period_end date not null` with `period_end >= period_start`.
  - `sequence_no integer not null default 1` with `sequence_no > 0`.
  - `source_run_id uuid null` restricted to correction/final-pay policy as applicable.
  - `current_calculation_version_id uuid null` after the version table exists.
  - `released_by text null`, `released_at timestamptz null`.
- Extend the status constraint with `calculation_failed` and `released` only if those states are stored on the run. A queued calculation state should be backed by the active job/attempt rather than a fragile transient status alone.

In `supabase/migrations/20260918000040_finance_pay_groups.sql`, replace the current absence of a run business key with intentional partial uniqueness:

```sql
create unique index finance_payroll_runs_scheduled_key
  on public.finance_payroll_runs(pay_group_id, period_start, period_end, run_type)
  where run_type = 'scheduled' and status <> 'cancelled';

create unique index finance_payroll_runs_sequence_key
  on public.finance_payroll_runs(pay_group_id, period_start, period_end, run_type, sequence_no)
  where run_type <> 'scheduled' and status <> 'cancelled';
```

If unscoped runs are still supported, define their business key explicitly; PostgreSQL uniqueness treats null values as distinct. Do not rely on the partial indexes above to deduplicate `pay_group_id is null` runs.

### 6.2 New tables

Use module-prefixed snake-case tables, UUID IDs and text user foreign keys:

- `finance_payroll_run_drafts`
  - owner, version, draft payload, last preflight timestamp, created/updated timestamps.
  - JSON is acceptable for incomplete form state; final run fields remain relational.
- `finance_payroll_input_snapshots`
  - run, version, checksum, source cutoff/freshness metadata, locked actor/time.
- `finance_payroll_calculation_attempts`
  - run, snapshot, attempt number, idempotency key, status, progress, stage, correlation ID, error code/detail, started/completed timestamps.
- `finance_payroll_calculation_versions`
  - run, attempt, version number, totals, employee count, statutory version, created timestamp.
- Update run lines and calculated warnings to reference `calculation_version_id`; uniqueness becomes `(calculation_version_id, employee_id)`.
- `finance_payroll_control_findings`
  - run, calculation version, source warning/reference, domain, severity, state, assignment, due date, resolution and waiver fields.
- `finance_payroll_certifications`
  - run, calculation version, certification type, evidence payload, checksum, actor/time.
- `finance_payroll_release_certificates`
  - one current certificate per run/current calculation version, control totals, artifact IDs/checksums, actor/time and idempotency key.

Add indexes for every foreign key and common list filter. At minimum:

- Run: `(status, pay_date)`, `(pay_group_id, period_start, period_end)`, `source_run_id` where non-null.
- Attempt: `(run_id, attempt_no desc)`, unique idempotency key.
- Version: unique `(run_id, version_no)`.
- Finding: `(run_id, state, severity)`, `(assignee_id, state, due_at)`.
- Draft: unique active draft per `(owner_id, draft_key)` or a clearly defined multi-draft key.

Enable RLS on every new table and grant service-role access. ERP browser data continues to flow through authenticated Netlify APIs only.

## 7. Backend API Contracts

Keep the POST-only Hono/Netlify pattern and `requirePermission()` on every route.

### 7.1 Command center

- `finance/payroll/control-center/get`
  - Inputs: date window and optional pay-group/status filters.
  - Returns one coherent control-center projection containing:
    - portfolio health, blocked-run count, approval-due count, funding gap and the next required action;
    - six KPI measures: next pay date, active runs, employees due, gross payroll, net payroll and funding confirmation;
    - scheduled/upcoming runs, release-impact action queue, next-run readiness gates, deadlines and funding controls;
    - comparable-run cost movement, the current approval assignment and payroll-specific recent activity.
  - Aggregate server-side; do not make the browser join multiple protected datasets.
  - Include an `asOf` timestamp and stable drill-down identifiers on every actionable item. The client must not infer blockers, funding state or readiness from unrelated responses.

### 7.2 Wizard

- `finance/payroll/run-drafts/create`
- `finance/payroll/run-drafts/get`
- `finance/payroll/run-drafts/update`
- `finance/payroll/run-drafts/delete`
- `finance/payroll/run-drafts/preflight`
- Extend `finance/payroll/runs/create` to accept the finalized, validated draft identity.

Preflight response shape:

```ts
interface PayrollRunPreflight {
  checkedAt: string;
  population: PopulationPreview & { eligible: number; excluded: number };
  sources: Array<{
    key: string;
    owner: string;
    cutoffAt: string | null;
    lastUpdatedAt: string | null;
    recordCount: number;
    status: 'ready' | 'warning' | 'blocked';
    findings: string[];
  }>;
  statutory: { versionId: string; effectiveFrom: string; status: 'ready' | 'blocked'; findings: string[] };
  payment: { eligible: number; missingBank: number; estimatedNet: number; availableFunding: number | null };
  accounting: { missingMappings: number; status: 'ready' | 'blocked' };
  blockers: PayrollControlFinding[];
}
```

The create route must rerun authoritative validations inside the mutation. Never trust a previously displayed preflight response.

### 7.3 Run workspace

- Extend `finance/payroll/runs/get` or add `finance/payroll/runs/workspace` to return the run header, lifecycle timestamps, current calculation version, KPI totals and control summary in one authorized response.
- Add paginated/filterable endpoints for population, findings, variances and audit. Do not return an unbounded employee list.
- Add `finance/payroll/runs/certify` for processor certification after all blockers close.

### 7.4 Calculation

- `finance/payroll/calculations/start`
  - Derive idempotency from run ID + input snapshot checksum + calculation policy version.
- `finance/payroll/calculations/status`
- `finance/payroll/calculations/list`
- `finance/payroll/calculations/get`
- `finance/payroll/calculations/compare`

The current `runs/calculate` route may become a thin adapter to `calculations/start`, but remove the duplicate path when callers migrate. Do not maintain two calculation authorities.

### 7.5 Findings

- `finance/payroll/findings/list`
- `finance/payroll/findings/assign`
- `finance/payroll/findings/resolve`
- `finance/payroll/findings/waive`
- `finance/payroll/findings/reopen`

All transitions require row-level state checks and must reject stale decisions with a conflict response.

### 7.6 Approval and release

- Submission starts the canonical workflow against a certification package and current calculation version.
- Approval actions use the workflow decision endpoint/RPC only.
- `finance/payroll/releases/preflight`
- `finance/payroll/releases/release`
- `finance/payroll/releases/get-certificate`

Release uses one transactional DB mutation for state, certificate, app event, audit, notifications and outbox records. External delivery and banking adapters run from the durable outbox after commit.

## 8. Mutation and Concurrency Rules

Every major mutation follows the repository backbone:

1. Lock and validate the current business row/version.
2. Write the business transition.
3. Emit `app_events`.
4. Write the audit log.
5. Create/advance workflow tasks when required.
6. Create notifications and handoff/outbox records required by policy.
7. Commit once.

Use compare-and-set or `FOR UPDATE` locking for:

- Finalizing a draft into a run.
- Locking inputs.
- Publishing a calculation version.
- Certifying and submitting.
- Approve/return/reject workflow decisions.
- Locking and releasing.
- Resolving or waiving a finding.

Return `409` for stale state/version conflicts. An idempotent retry must return the prior result, not duplicate output rows.

Never swallow a satellite insert error. A successful status response is invalid if required events, audit, workflow, notifications or outbox rows did not commit.

### 8.1 Backend module boundaries

Do not extend the existing payroll route and service monoliths. The production port must move payroll into explicit command/query boundaries under the existing Finance ownership area:

```text
netlify/functions/lib/finance/payroll/
  runQueries.ts
  runDrafts.ts
  runCreation.ts
  inputSnapshots.ts
  calculationAttempts.ts
  controlFindings.ts
  approvals.ts
  releases.ts
  outputs.ts
  payPolicies.ts
  contracts.ts
```

- Hono route files authenticate, validate the request, invoke one domain command/query and map the result. They do not implement payroll state transitions.
- Each command owns one transaction boundary and returns a typed result. Required event, audit, workflow, notification and outbox writes are part of that boundary.
- Query modules never mutate state and must support server-side filtering, pagination and deterministic ordering.
- Shared calculations and state-transition guards are extracted once. Do not duplicate status switches across routes, services and UI components.
- Do not create a second service tree for offshore or marine payroll. Conditional work-pattern behavior is resolved from the snapshotted pay-policy capabilities.
- Delete superseded exports and route adapters after callers are cut over. Do not leave parallel payroll APIs or compatibility shims.

## 9. Frontend Architecture

### 9.1 Shared payroll components

Create components within the existing Finance ownership boundary first. UI-kit promotion remains deferred.

- `PayrollPageHeader`
- `PayrollRunHeader`
- `PayrollLifecycle`
- `PayrollKpiRow`
- `PayrollIntentBanner`
- `PayrollRunTabs`
- `PayrollActivityFeed`
- `PayrollWizardStepper`
- `PayrollWizardFooter`

Each component receives typed data and emits commands; it does not fetch its own unrelated datasets. All status/risk labels must come from one typed mapping, not repeated switches in each page.

### 9.2 Page composition

- Refactor `PayrollOverview.tsx` into the operational command-center composition defined in section 9.4.
- Refactor `PayNewRunWizard.tsx` into five steps and server-backed draft/preflight state as defined in section 9.6.
- Replace the increasingly large `PayRunDrawer.tsx` workspace with a routed full-page run workspace. Keep a compact drawer only for quick inspection if it has a distinct use case.
- Add an approver route/page that opens directly from workflow tasks.
- Add a failure/recovery route that reads calculation-attempt evidence.
- Use one run page and one run state machine for standard, shift, project, offshore and marine payroll. Typed policy capabilities conditionally add specialized evidence and controls.

Suggested production file layout:

```text
src/components/sections/Finance/payroll/
  command-center/
    PayrollCommandCenterPage.tsx
  runs/
    PayrollRunRegisterPage.tsx
    create/
      PayNewRunWizard.tsx
      steps/
    workspace/
      PayrollRunPage.tsx
      OverviewTab.tsx
      PopulationPayTab.tsx
      InputsReconciliationTab.tsx
      ExceptionsTab.tsx
      ApprovalTab.tsx
      ReleaseAuditTab.tsx
    failures/
      PayrollCalculationFailurePage.tsx
  approvals/
    PayrollApprovalPage.tsx
  exceptions/
  payments/
  remittances/
  reports/
  setup/
    calendars/
    pay-groups/
    components/
    pay-policies/
    statutory/
    banking/
    accounting/
    documents/
  shared/
    PayrollRunHeader.tsx
    PayrollLifecycle.tsx
    PayrollKpiRow.tsx
    PayrollIntentBanner.tsx
    PayrollActivityFeed.tsx
```

Do not create nested cards or a marketing-style payroll landing page. This is an operational workspace optimized for scanning and repeated action.

### 9.3 Query behavior

- Use TanStack Query for all protected data.
- Use stable run/draft/version query keys.
- Invalidate only affected run, command-center, task and summary queries after mutations.
- Realtime may trigger refetches only.
- Paginate employee rows and audit history.
- Preserve URL tab/filter state so task links open the exact approval, exception or release context.
- Warn before navigation when the local form differs from the persisted wizard draft.

Split the client API by the same domain boundaries under `src/api/finance/payroll/`. Do not keep every DTO, endpoint wrapper and query hook in one `payroll.ts` file. Public barrel exports are acceptable, but there must be one canonical protected Netlify API path; browser Supabase payroll reads are not permitted.

### 9.4 Information architecture and ownership

The production navigation must make the operating boundary explicit:

- **Payroll** contains Command Center, Runs, Approvals, Exceptions, Payments, Remittances and Reports.
- **Payroll Setup** contains Pay Calendars and Pay Groups, Components and Pay Policies, Statutory Configuration, Banking and Output Profiles, Accounting Mappings, and Documents and Payslip Templates.
- Employee loans, advances and employee-specific deductions are operated from the employee/payroll workflow. Setup contains only their governing rules and approval policy.
- Payslip Studio remains under Payroll Setup > Documents and Branding. A payroll runner selects an approved effective template from the run; they do not edit designs during processing.
- Pay Policies are configured in Payroll Setup and resolved automatically by pay group plus pay date. They are not a primary command-center action.

Use generic production names. The current prototype filenames are references only and must map as follows during the port:

```text
crew-packages.html        -> PayPolicyListPage
create-crew-package.html  -> PayPolicyWizard
crew-package.html         -> PayPolicyPage
crew-run.html             -> PayrollRunPage with conditional capability sections
```

Do not ship `crew-*` routes, page identifiers or generic navigation labels. Crew, offshore, marine, rotation, movement and asset terminology appears only after the chosen policy type enables those capabilities. After the production pages are verified, delete the superseded prototype-specific routes and links.

### 9.5 Command-center composition

The first payroll screen is an operational control surface, not a reporting dashboard. Its hierarchy is:

1. A compact module header with `New payroll run` as the primary command, plus refresh and Pay Policies as secondary controls.
2. A full-width portfolio-health urgency band using the selected Option 06 anatomy: a fixed 80px-high card with a 42px vertical risk rail, concise intervention summary, approval/funding/cutoff measures and the selected Option 02 numbered resolution area. The risk rail uses animation Option 04, Drawer Slide: it enters once from outside the card, settles in place and never loops. Reduced-motion preferences disable the transition and show the settled rail immediately. Measures are read-only evidence rather than hidden full-cell links. The action area orders the two release blockers and exposes the full seven-action queue from its header; these three explicit commands are the only links in the band. Do not repeat those actions in a separate queue card.
3. Six equal KPI cells in one compact desktop row: next pay date, active runs, employees due, gross payroll, net payroll and funding confirmation.
4. A two-column operational workspace occupies the first two grid tracks: Assigned to you on the left, followed by Upcoming deadlines on the right. Assigned to you contains the current approval followed by recent payroll-specific activity. Upcoming deadlines contains only release-critical dates for the next seven days, not a general calendar or task list.
5. A dedicated third-track release-control rail places a compact Release readiness card above the vertical Monthly Salaried release-impact card. The payroll run register sits below Upcoming deadlines and Assigned to you across the first two tracks. The register retains search, status filters and direct run actions; the impact rail retains all four exposure totals and all four release-control steps.

The command-center run register intentionally consolidates the overview contract into six columns: run, pay group with employee count and schedule context, pay date, net payroll, readiness with stage, and drill-down action. It follows the Statutory Configuration register language for presentation only: full-width underline tabs, a separate search toolbar, white Title Case table headers, spacious rows and an aligned register footer. Preserve the payroll-specific readiness bars, row values, arrow actions and footer copy; do not change the data contract merely to imitate another table. Do not use a segmented-control filter or colored table header. Full population and lifecycle detail remain in the run workspace. Search and status tabs operate together and preserve an explicit empty state.

All command-center display copy uses Title Case, including navigation labels, headings, buttons, tabs, table headers, helper copy and status labels. Preserve established acronyms and identifiers such as `TTD`, `AST`, `HR`, `PAY-...` and statutory codes in uppercase. Apply the command-center-scoped `font-size-adjust: .56` typography lift so compact labels, body copy, values and headings all become slightly more legible without flattening their established hierarchy; exclude icon fonts from this adjustment.

Upcoming deadlines and Assigned to you share equal widths and row height, with aligned headers and bottom edges. Assigned to you combines a soft decision banner with a structured control summary: show the assigned approver's profile photo, name and role beside the readiness statement, then run ID and net payroll, followed by schedule and employee context beside one prominent review command. The assignee must come from the workflow task rather than the payroll preparer so maker-checker identity remains explicit. Keep the three timestamped payroll events beneath it and do not use colored top or side accent rules. Upcoming deadlines shows the input cutoff, funding confirmation and pay date with direct workspace links. The Release readiness card is independently sized in the right rail and combines the canonical Metric Card and Employee Master entity-profile anatomy: a gradient navy header with an icon chip and explicit status; an animated Chart.js doughnut used as the entity avatar; pay-group identity, run-ID pill and date/population metadata; a three-cell profile stat strip; then a labeled white detail body containing the release-control rows. Use a stable HTML center label over the Chart.js canvas and respect reduced-motion preferences. Gate rows retain every label, supporting detail and status, and use equal 54px rows at desktop so the Release Readiness card aligns with the Approval and Upcoming Deadlines card bottoms. At `1120px` and below, stack every major widget at full width; use two KPI columns on standard phones and one only below `340px`. The page itself must never overflow horizontally; only dense table content may use a contained horizontal scroller at phone widths.

Do not add charts to the command center merely for dashboard decoration. Gross, net and funding totals are already communicated by the KPI row; repeating those values as a chart adds visual weight without improving a release decision. Period totals, statutory trends and net-pay history belong in Reports, while detailed variance drivers belong in the run reconciliation workspace. General audit activity remains in the audit center; the activity panel is limited to payroll events that affect the current approval or release workflow.

Do not add standalone Action queue or Funding and release widgets to the command center. The health-band footer owns priority actions; the KPI strip exposes the next pay date and funding percentage; the release-impact path exposes the amount at risk and unresolved funding control. Upcoming deadlines is the sole compact schedule surface and is limited to release-critical milestones in the next seven days. Full queues, calendars and banking controls belong in their dedicated workspaces.

### 9.6 Run wizard and workspace contract

The run wizard has five server-backed steps:

1. **Run and calendar** - run type, pay group and resolved calendar instance.
2. **Dates and controls** - period, pay date, cutoffs, owner and approval route. Scheduled dates are derived and require permission plus reason to override.
3. **Population readiness** - effective employees, joiners/leavers, proration, assignments and statutory/bank/pay-basis blockers.
4. **Input readiness** - approved, late, missing and overlapping compensation, time, leave and adjustment sources using the same resolver as input lock.
5. **Review and create** - resolved statutory/pay-policy versions, control results, estimate, attestations and immutable creation intent.

Do not expose a field the server ignores. Contribution weeks, policy version and other derived evidence are read-only. Draft persistence, optimistic concurrency, resume and abandonment are server-backed.

The full run workspace has at most six primary tabs:

1. Overview.
2. Population and Pay.
3. Inputs and Reconciliation.
4. Exceptions.
5. Approval.
6. Release and Audit.

Keep a sticky run header, lifecycle and one context-sensitive next action. Failed and superseded calculation attempts remain available as immutable evidence. Conditional policy capabilities add sections inside these tabs; they do not add another run page or duplicate the lifecycle.

## 10. Type Changes

Replace free-form run status strings with unions:

```ts
type PayrollRunType = 'scheduled' | 'off_cycle' | 'correction' | 'final_pay';
type PayrollRunStatus =
  | 'draft'
  | 'input_locked'
  | 'calculation_failed'
  | 'calculated'
  | 'pending_approval'
  | 'returned'
  | 'approved'
  | 'locked'
  | 'released'
  | 'cancelled';
```

Extend `PayrollRun` with run type, period start/end, sequence, source run, current calculation version, released actor/time and lifecycle timestamps. Deprecate `exportedAt` as a run-state indicator; export artifacts retain their own generated timestamp.

Add DTOs for drafts, preflight, calculation attempt/version, control finding, certification package and release certificate. Validate route inputs at the server boundary using the repository's current schema validation pattern.

## 11. Permissions and Security

Define distinct permissions rather than treating all payroll actions as `manage`:

- View payroll runs and aggregate totals.
- Manage run drafts and inputs.
- Start calculations.
- Resolve findings.
- Certify/submit.
- Approve payroll.
- Approve funding/release threshold.
- Lock payroll.
- Release payroll and outputs.
- View protected employee-level pay.
- Export payroll artifacts.

Enforce permissions and participant scope server-side. The browser must never be able to retrieve another employee's pay because a tab is hidden.

Sensitive requirements:

- No direct browser Supabase reads.
- Do not return full bank account or statutory identifiers.
- Sanitize calculation errors; store technical detail server-side and expose a correlation ID.
- Release/export URLs must be short-lived and authorized.
- Audit all reads of bulk payroll exports where the audit backbone supports access events.
- Rate-limit or serialize high-cost calculation/release commands per run.

## 12. E2E Acceptance Matrix

Extend `scripts/e2e/suites/financePayroll.mjs` and focused payroll suites. Every new endpoint needs positive, negative, contract and side-effect coverage.

### Run identity

- Two pay groups can create scheduled runs in the same month.
- Weekly runs for multiple periods in one month do not collide.
- Off-cycle and correction runs can coexist with the scheduled run.
- Duplicate scheduled business keys are rejected atomically.
- Correction run must reference an eligible source run.

### Wizard and preflight

- Draft create/update/resume/delete.
- Unauthorized user cannot read or mutate another draft.
- Source changes after preflight are caught again during create.
- Missing statutory, bank and GL readiness appear with exact contract fields.
- Creation writes run, app event and audit atomically.

### Calculation versions

- Successful attempt publishes one current version.
- Retry with the same idempotency key does not duplicate results.
- Failed attempt commits failure evidence but no partial current lines/totals.
- Corrected source + new snapshot produces a new version; old version remains queryable.
- Compare endpoint returns exact version deltas.
- 300-employee and existing 1,100-employee cases have complete counts with no 1,000-row truncation.

### Findings

- Blocker prevents certification/submission.
- Authorized owner resolves with evidence.
- Unauthorized/non-assigned actor is denied where policy requires assignment.
- Waiver requires permission, reason and allowed severity.
- Resolution/waiver emits event, audit and notification where required.

### Approval

- Preparer cannot approve own run.
- Approver receives immutable package tied to the submitted version.
- Approve/return/reject each close the task exactly once.
- Return/reject require a reason.
- Concurrent decisions yield one winner and one `409`; no dangling task.
- Threshold route creates the correct second approval.
- Decision writes workflow, run transition, event, audit, notifications and outbox atomically.

### Release

- Release is denied before approved + locked.
- Changed current calculation version invalidates prior certification.
- Funding/bank/GL blockers prevent release.
- Successful release creates one certificate and expected output/outbox records.
- Same idempotency key returns the prior certificate.
- Reopen is denied while an active bank disbursement exists and leaves the run, current pointers
  and command receipts unchanged.
- Reopen is denied while an active statutory remittance exists and leaves the run, current pointers
  and command receipts unchanged.
- After the owning module cancels each blocker, reopen succeeds without deleting its history.
- A subsequent release preserves each cancelled downstream row and creates exactly one active
  replacement disbursement and exactly one active replacement per authority/contribution period.
- Export generation does not independently mark a run released.
- Export persistence stores SHA-256 in `checksum` and MD5 in `content_md5`; download detects a size,
  MD5 or SHA-256 mismatch before returning content.
- Released run cannot be reopened; correction uses a linked new run.

### Cleanup

Tag all created rows with `h.TAG` where the schema supports it and register cleanup with `h.onCleanup()`. Cleanup must include drafts, attempts, versions, findings, certificates, workflow records, app events, audit records, notifications and outbox rows.

## 13. Delivery Sequence

Implement only after the repository phase is approved:

1. Correct source schema and rebuild local database.
2. Add run identity, attempt/version and control/release tables with RLS/indexes.
3. Extract the backend payroll command/query boundaries and make route handlers thin.
4. Split DTOs, API wrappers and query hooks by payroll domain boundary.
5. Implement wizard drafts and authoritative preflight.
6. Implement calculation attempts/versions and controlled failure.
7. Implement findings and certification package.
8. Implement approval package integration with canonical workflow decisions.
9. Implement release transaction and durable outbox consumers.
10. Build shared payroll components.
11. Build the command center, five-step wizard, one full run workspace, approval and failure pages.
12. Build the complete Payroll Setup hierarchy and conditional pay-policy sections.
13. Cut all callers over, then delete the large drawer workspace, prototype-specific `crew-*` routes and superseded payroll API paths.
14. Add or extend all live E2E coverage, including generic and conditional-policy run paths.
15. Run typecheck during iteration; run the full test suite once at the final gate and fix every failure.

Do not ship a UI control before its backend contract is real. Do not accept an input that is ignored, and do not show a release/funding/checksum value that the backend does not persist and prove.

## 14. Pay Policies and Conditional Work-Pattern Controls

This section extends the same payroll control plane; it does not authorize a second payroll engine. Pay-policy production work remains subject to the repository build order and explicit Finance/Payroll phase approval. Offshore and marine behavior is an optional policy capability, not the parent model.

### 14.1 Product boundary

Use one clear split:

- **Payroll Setup** owns effective-dated Pay Policies, approvals, pay-group assignment and configuration validation.
- **Payroll** owns run creation, source snapshots, calculation, findings, certification, approval, release and correction.
- Every run is a normal `finance_payroll_run` selected through a pay group. Standard salaried, hourly/shift, project, offshore and marine groups resolve approved policy versions through the same mechanism.
- Offshore and marine runs gain roster, movement and asset controls only when the resolved policy enables those capabilities.
- A pay policy is not a payslip template, employee contract, roster or statutory rate table. It composes governed records from those domains.

The resolution hierarchy is:

```text
approved statutory profile version
  + approved pay-policy version
  + effective pay-group policy assignment
  + effective employee compensation/assignment and rates
  + required compensation, time, leave and optional crew sources
  -> immutable payroll-run policy and input snapshots
```

Do not let a processor manually choose a different policy inside a run. The server resolves the version from pay group + pay date. An authorized correction is a new effective assignment or policy version, followed by a new/correction run as policy requires.

Current delivery scope is local Trinidad and Tobago employees paid in TTD. Expat/foreign-worker determinations, reciprocal-agreement handling, foreign-currency rates and split-currency payments are explicitly deferred. Do not add dormant inputs, schema columns or blocked UI for those features until the user approves that scope.

### 14.2 Existing records to reuse

Reuse the current source-of-truth tables rather than copying their contents into policy-owned tables:

- `hr_rotation_patterns` for optional published 7/7, 14/14, 21/21, 28/28 and other cycle patterns.
- `hr_shift_templates` for shift start/end, cross-midnight behavior and paid hours.
- `hr_rosters` and `hr_shift_assignments` for expected shift/crew and work dates when the policy requires them.
- `finance_pay_groups` and effective membership for run frequency and population.
- `finance_pay_components` for earning/deduction catalogue definitions.
- `hr_employee_pay_items` for effective employee component values where applicable.
- The approved statutory-version model already used by payroll runs.

The repository currently has no authoritative pay-policy or crew-movement model. Those are real additions; do not fake them with policy JSON, employee notes or free-form run fields.

### 14.3 Source schema

Correct source migrations when this phase is approved. Every mutable table has `created_at`, `updated_at` and the canonical update trigger. Every user FK is `text` to `app_users(id)`. Enable RLS and grant only service-role access because browser ERP access remains behind authenticated Netlify APIs.

Add:

- `finance_pay_policies`
  - Stable policy identity: unique code, name, description, legal entity, worker relationship, workforce type, owner and lifecycle state.
  - Include an allowlisted policy type such as `standard_salary | hourly_shift | project | offshore_rotation | marine_voyage | standby_callout`. The type controls available configuration sections; it does not select another payroll engine.
  - Policy identity is mutable only while unused or through a governed metadata command; calculation rules live in versions.
- `finance_pay_policy_versions`
  - Policy FK, monotonic version number, `draft | pending_approval | active | superseded | rejected | retired`, effective from/to, optional work/rotation-pattern FK, timezone/day-boundary policy, statutory-profile binding policy, TTD payment policy, prepared/submitted/approved actors and times, canonical checksum.
  - Approved/active versions are immutable. A change creates a new version copied from the prior version in one transaction.
  - Prevent overlapping active effective periods for the same policy at the database layer.
- `finance_pay_policy_components`
  - Version FK, component FK, typed calculation basis, typed rate source, typed eligibility source, typed rule parameters, required/optional flag and sort order.
  - Unique `(policy_version_id, component_id)`. Do not store executable JavaScript, SQL or unvalidated formula text.
- `finance_pay_policy_source_rules`
  - Version FK, source type, owner role/team, required flag, reconciliation key type, cutoff policy, late-input policy, conflict severity and typed outcome.
- `finance_pay_policy_costing_rules`
  - Version/component family, required client/asset/project/work-order/cost-centre dimensions, resolution source and missing-dimension outcome.
- `finance_pay_group_policy_assignments`
  - Pay-group FK, policy FK/version policy, effective from/to, status and assignment approval evidence.
  - Prevent overlapping active assignments for the same pay group. A pay date must resolve exactly one approved version or preflight blocks run creation.
- `hr_crew_assignments`
  - Optional offshore/marine extension: employee, pay group, policy assignment, canonical client/contract and operational asset FKs, role, TTD contract/rate references, effective from/to, status and approval evidence.
  - Prevent overlapping active assignments where policy disallows simultaneous asset allocation.
- `hr_crew_movements`
  - Employee, `embark | disembark | transfer | mobilize | demobilize`, occurred timestamp, operational timezone, canonical asset/site, source system/reference, approval state and actor/time.
  - Unique source-system business key for idempotent imports. Index employee/time and asset/time queries.
- `finance_payroll_run_policy_snapshots`
  - Run FK, policy/version FKs, checksum, resolved rule manifest, statutory-version ID, created actor/time.
  - One snapshot per run. The manifest is audit evidence, not an alternate editable rule store.
Use canonical client, contract, site and operational-asset FKs when those records exist. Do not create duplicate free-form `vessel_name`, `platform_name` or `client_name` columns as permanent business identity.

### 14.4 Typed rule contract

Pay-policy rules are declarative and allowlisted. Suggested unions:

```ts
type PayCalculationBasis =
  | 'salary_period'
  | 'per_qualifying_day'
  | 'per_approved_shift'
  | 'approved_hours'
  | 'approved_event'
  | 'policy_multiplier';

type PayRateSource =
  | 'employee_contract'
  | 'employee_assignment'
  | 'policy_band'
  | 'approved_labour_policy';

type PayEligibilitySource =
  | 'effective_employment'
  | 'approved_compensation'
  | 'approved_time'
  | 'approved_leave'
  | 'roster_movement_time'
  | 'active_asset_assignment'
  | 'shift_template'
  | 'crew_movement'
  | 'approved_callout'
  | 'approved_holiday_shift';

type PayConflictOutcome =
  | 'exclude_unapproved_input'
  | 'create_review_finding'
  | 'block_employee_calculation'
  | 'block_input_lock'
  | 'create_correction_candidate';
```

Validate parameters for each union member at the API boundary and again in the activation transaction. Reject unknown combinations. Adding a new basis requires calculation-engine code and tests; it is not a data-only change.

Define the standard policies explicitly, then enable the additional crew policies only for the relevant policy type:

- Salary/hourly basis and partial-period proration.
- Approved compensation, time, leave and adjustment precedence.
- Shift, overtime, public-holiday and late-input handling.
- Offshore-day boundary and operational timezone.
- Partial-day bands or hour proration.
- Cross-midnight attribution and duplicate prevention.
- Mobilization/demobilization treatment.
- Standby and call-out qualification.
- Public-holiday candidate generation and approval.
- Roster vs movement vs approved-time precedence.
- Late source handling after input lock.

### 14.5 Run creation and calculation

Extend pay-group preflight with:

- Resolved policy/version/checksum and effective assignment evidence.
- Worker class and pay-basis support.
- Required-source readiness for the policy type.
- For crew-enabled policies: roster publication, expected crew, assignment, movement, approved-time and leave reconciliation totals.
- Missing/overlapping assignment counts.
- Missing/expired employee rate and statutory determination counts.
- TTD bank-account and disbursement readiness.
- Client/asset/work-order/GL allocation readiness.

Run creation transactionally writes the run, policy snapshot, app event and audit record. Input lock snapshots every referenced source ID/version/checksum. Calculation reads only the frozen snapshots and policy manifest; it must not reread mutable current policy rules halfway through a calculation.

The calculation produces explicit policy evidence per line: qualifying date/event, source record IDs, component rule, TTD rate source/version, amount and costing dimensions. Crew-enabled policies additionally retain roster, movement and asset evidence. One source event cannot create duplicate earnings through overlapping eligibility rules.

Raw source mismatches become normalized `finance_payroll_control_findings` with source references, owner, severity and resolution evidence. Medical, competency or HSE deployment alerts may create operational review findings, but must not automatically suppress pay already earned. Any pay effect requires an authorized payroll/employment decision recorded through its business process.

### 14.6 API contracts

Use the existing POST-only Hono/Netlify pattern with `requirePermission()`:

- `finance/payroll/policies/list|get|create-draft|copy-version|update-draft`
- `finance/payroll/policies/preflight|submit|activate|reject|retire`
- `finance/payroll/policies/versions/list|get|compare`
- `finance/payroll/policies/pay-groups/list|assign|end-assignment`
- `hr/crew/assignments/list|create|update|end`
- `hr/crew/movements/list|record|correct`
- Extend run-draft preflight, run creation, input snapshot and run workspace contracts with policy fields plus conditional crew source fields.

Policy submit/approval uses the canonical workflow engine. Activation must be one transactional mutation that locks the version/policy and any overlapping assignment rows, validates the full configuration, changes state, supersedes the prior version when applicable, emits `app_events`, writes `audit_logs`, advances workflow tasks, creates notifications and commits once. External publication/import work uses the durable outbox.

Movement correction never overwrites an approved historical event. Record a reversal/correction relationship so an already snapshotted run remains explainable.

### 14.7 Frontend implementation

Create the setup pages inside Finance payroll ownership:

```text
src/components/sections/Finance/payroll/
  setup/
    PayPolicyListPage.tsx
    PayPolicyPage.tsx
    create-policy/
      PayPolicyWizard.tsx
      steps/
  run/
    CrewPopulationControls.tsx
    CrewInputReconciliation.tsx
    CrewCostAllocation.tsx
```

Reuse the approved payroll shell components. `WIZSTEP-2` is appropriate for policy creation, with a unique right rail per step. The normal run page conditionally renders crew sections from typed workspace data; do not fork a second run state machine.

Use TanStack Query for protected API data. Persist policy drafts server-side with optimistic concurrency/version tokens. Preserve policy/run tab state in the URL. Policy tables and worker lists must be paginated and server-filtered.

### 14.8 Permissions and separation of duties

Add distinct permissions:

- View pay policies and aggregate usage.
- Draft pay policies.
- Submit policy versions.
- Approve work-pattern/source policy.
- Approve statutory policy.
- Approve accounting/activate policy versions.
- Assign policies to pay groups.
- Manage crew assignments.
- Record/correct crew movements.
- View employee-level crew pay evidence.

The version preparer cannot provide the final activation approval. The current policy flow only accepts employees with an approved local PAYE, NIS and Health Surcharge profile. Unsupported worker classifications are rejected rather than accepted and ignored.

### 14.9 E2E acceptance matrix

Add focused live suites for every policy, assignment, movement and extended-run endpoint:

- Draft create/update/resume/copy/version compare; unauthorized access denied.
- Unknown rule types and invalid parameter combinations rejected.
- Submission rejected for missing component, statutory, source-owner, costing or payment configuration.
- Concurrent activation yields one winner and one `409`; no overlapping active versions.
- Activation writes business state, workflow decision, event, audit and notifications atomically.
- Pay-group assignment cannot overlap and cannot reference an unapproved version.
- Pay date resolves the correct policy version at an effective boundary.
- Existing run keeps its policy checksum after a later version activates.
- Movement import is idempotent; correction preserves the original event.
- Roster without movement, movement without assignment and overlapping assignments produce exact blocker contracts.
- Unapproved overtime is excluded and creates the configured review finding.
- Cross-midnight shifts and mobilization/demobilization do not double count a qualifying day.
- Employee without complete local PAYE, NIS or Health Surcharge setup is blocked with an HR-owned finding.
- Missing approved TTD payment destination blocks release and appears in exact preflight fields.
- Client/asset/work-order totals reconcile to gross payroll and GL output.
- HSE advisory alone does not remove already earned pay.
- Policy and movement mutations assert all required `app_events`, `audit_logs`, workflow, notifications and outbox side effects.
- Cleanup removes policy drafts/versions, assignments, movements, snapshots, findings and platform side effects tagged with `h.TAG`.

### 14.10 Delivery order

After explicit Finance/Payroll phase approval:

1. Finalize canonical asset/client references and TTD disbursement ownership.
2. Correct/add source migrations for policies, versions, rules, assignments, movements and run snapshots.
3. Add DTO schemas and policy/source permissions.
4. Implement transactional draft, submit, workflow and activation commands.
5. Implement crew assignment and movement commands/import idempotency.
6. Extend run preflight, snapshots and calculation evidence.
7. Extend findings, certification, release and accounting outputs.
8. Build Payroll Setup policy pages and conditional crew run controls.
9. Add all live E2E cases, then typecheck and run the full suite once at the final gate.

## 15. Operational Workspace Completion Addendum

This section is authoritative for the completed `runs.html`, `exceptions.html`, `payslips.html`, `payslip-batch.html` and `reports.html` mockups. If an older section is less specific, use this section. Do not infer backend behavior from static demo values.

### 15.1 Page-To-Contract Map

Each production control maps to exactly one canonical protected API contract. Do not add a second list route, hide a mutation behind a query endpoint or let the browser join protected ERP datasets.

| Workspace | Canonical Protected Contracts | Notes |
|---|---|---|
| Payroll Runs | `finance/payroll/runs/list`, `finance/payroll/run-views/list|create|update|delete`, `finance/payroll/runs/calendar` | `runs/list` is the only run-register authority. Saved views contain filters, never cached payroll values. |
| Approvals And Exceptions | `finance/payroll/findings/work-queue`, `finance/payroll/findings/get`, `finance/payroll/findings/assign|escalate|comment|resolve|waive|reopen` | The queue combines workflow tasks and payroll findings in one authorized read model; decisions still use their canonical workflow/finding commands. |
| Payslip Batches | `finance/payroll/payslip-batches/list|get`, `finance/payroll/payslip-batches/recipients/list`, `finance/payroll/payslip-batches/schedule-delivery|complete`, `finance/payroll/payslips/retry-delivery|get-evidence` | The register and detail page are separate contracts. Never return all recipient rows in the batch summary. |
| Payroll Reports | `finance/payroll/reports/catalog`, `finance/payroll/reports/run|status`, `finance/payroll/reports/history/list`, `finance/payroll/report-schedules/list|create|update|delete` | Catalog keys, required parameters, permissions and output shapes are server-owned. The client does not invent report availability. |

Every request and response is schema-validated at the Netlify boundary. Use one shared contract definition per endpoint for route validation, API typing and contract tests.

### 15.2 Shared Query Contracts

All list endpoints use keyset pagination and deterministic ordering. Do not use an unbounded Supabase select or rely on the default 1,000-row cap.

```ts
interface PageRequest {
  cursor?: string;
  limit: number; // 1..100, default 25
}

interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  asOf: string;
}

interface PayrollRunListRequest extends PageRequest {
  search?: string;
  states?: PayrollRunState[];
  runTypes?: PayrollRunType[];
  payGroupIds?: string[];
  periodFrom?: string;
  periodTo?: string;
  archive: 'exclude' | 'only' | 'include';
  sort: 'pay_date_desc' | 'pay_date_asc' | 'updated_desc';
}

interface PayrollRunListItem {
  id: string;
  reference: string;
  runType: PayrollRunType;
  state: PayrollRunState;
  version: number;
  payGroup: { id: string; name: string; frequency: string };
  period: { startsOn: string; endsOn: string; payDate: string; cutoffAt: string | null };
  population: { included: number; excluded: number };
  totals: { currency: 'TTD'; gross: number | null; net: number | null };
  readiness: { percent: number; blockers: number; label: string };
  correctionOf: { id: string; reference: string } | null;
  archivedAt: string | null;
  retentionUntil: string | null;
  updatedAt: string;
}
```

`runs/list` returns server-calculated tab counts for the exact authorized filter scope. Search, filters, saved-view ID, page cursor and sort remain in the URL. A saved view stores a validated `PayrollRunListRequest` without cursor and limit. Team-visible views require a separate permission and cannot widen the viewer's data access.

`runs/calendar` returns scheduled calendar instances and linked run IDs for a bounded date window. The page must not derive expected runs by scanning existing run rows.

### 15.3 Findings Work Queue Contract

The work queue response contains compact rows plus one optional selected detail. Selection uses a finding/task ID in the URL so refresh and task deep links preserve context.

```ts
interface PayrollFindingQueueItem {
  id: string;
  kind: 'approval' | 'blocker' | 'warning';
  severity: 'critical' | 'high' | 'medium' | 'low';
  state: 'open' | 'resolved' | 'waived' | 'reopened';
  version: number;
  run: { id: string; reference: string; payDate: string };
  title: string;
  summary: string;
  owner: { type: 'user' | 'team'; id: string; displayName: string } | null;
  dueAt: string | null;
  impact: { currency: 'TTD'; amount: number | null; employees: number | null };
  allowedActions: Array<'review' | 'assign' | 'escalate' | 'comment' | 'resolve' | 'waive' | 'reopen'>;
}

interface PayrollFindingDetail extends PayrollFindingQueueItem {
  trigger: { ruleKey: string; threshold: string | null; observed: string };
  subject: { employeeId: string | null; displayName: string | null; scopeLabel: string };
  sourceEvidence: Array<{ type: string; id: string; label: string; occurredAt: string }>;
  requiredEvidence: string[];
  resolution: { actorId: string; note: string; resolvedAt: string } | null;
  activity: PageResult<PayrollFindingActivity>;
}
```

All state-changing finding commands accept `{ findingId, expectedVersion, idempotencyKey, ...commandFields }`. `assign`, `escalate`, `resolve`, `waive` and `reopen` lock the finding row and commit state, event, audit and required notification once. `comment` commits the comment, audit record and owner notification once. Return `409` with the current version and state for stale commands. A resolved row remains queryable in history; never overwrite or delete its evidence.

Approval queue items expose workflow task IDs, but approve/return/reject continue through the canonical workflow decision transaction. Do not implement those decisions in the findings service.

### 15.4 Payslip Batch Contracts And State Machine

Use one batch per locked payroll run plus template snapshot and generation intent. Enforce a unique business key over those immutable inputs.

```ts
type PayslipBatchState =
  | 'queued'
  | 'generating'
  | 'rendering'
  | 'ready_for_delivery'
  | 'delivery_scheduled'
  | 'delivering'
  | 'needs_attention'
  | 'completed'
  | 'archived';

interface PayslipBatchSummary {
  id: string;
  reference: string;
  version: number;
  state: PayslipBatchState;
  run: { id: string; reference: string; payGroupName: string; payDate: string; lockedVersion: number };
  template: { id: string; versionId: string; name: string; checksum: string };
  counts: { total: number; generated: number; rendered: number; delivered: number; held: number; failed: number; pending: number };
  delivery: { policyId: string; channelLabel: string; scheduledAt: string | null; startedAt: string | null; completedAt: string | null };
  owner: { id: string; displayName: string };
  retentionUntil: string | null;
  updatedAt: string;
}
```

Generation and delivery are durable jobs. A timed spinner is never success evidence. Per-recipient attempts are immutable; retry creates a new attempt for failed/held recipients only and never resends a successful recipient.

`schedule-delivery` requires an expected batch version, future AST timestamp, approved policy and a rendered/unheld recipient snapshot. It commits schedule state, event, audit, notification and outbox job once. The worker revalidates batch state before delivery.

`complete` is allowed only when generation and rendering have stopped, no recipient is actively delivering and every undelivered recipient has a persisted hold/failure disposition plus owner. It commits the completed state, final counts, manifest checksum, event, audit and retention metadata once. Completion does not hide exceptions. Archive is a later retention transition, not a substitute for completion.

Recipient list filters include delivery state, hold reason, employee search and attempt count. Employee-level payslip evidence and protected URLs require employee-level payroll permission; URLs are short-lived and never included in list responses.

### 15.5 Payroll Report Catalog And Results

The catalog exposes exactly these stable keys for this scope:

```ts
type PayrollReportKey =
  | 'payroll_register'
  | 'net_pay_summary'
  | 'payroll_cost_analysis'
  | 'gross_to_net_reconciliation'
  | 'variance_analysis'
  | 'overtime_allowance_analysis'
  | 'population_movements'
  | 'nis_exceptions'
  | 'export_audit_package';
```

Each catalog definition returns label, description, permission, parameter schema, allowed formats, aggregate/employee-level classification and whether scheduling is allowed. `reports/run` rejects unknown parameters and inaccessible report keys. It returns either a completed typed result or `{ jobId, state: 'queued' }`; queued work is polled through `reports/status`. Do not fabricate preview rows while a job is pending.

The three charts are limited to `payroll_cost_analysis`, `variance_analysis` and `overtime_allowance_analysis`. Their series must be returned in the same authorized result as the supporting table and control totals. The frontend verifies series/table scope identifiers match, then renders Chart.js with reduced-motion support. The other six reports remain table/evidence views.

Gross-to-net reconciliation returns each control source, register total, summary/output total, difference, tolerance and evidence reference. A visual `Balanced` state is legal only when every difference is within the persisted tolerance.

Scheduled reports store report key, validated parameters, format, AST schedule, owner, approved recipient-group IDs, state, next run and optimistic version. Recipient groups are resolved again when the job runs. Schedule mutations are audited and cannot grant report access to recipients who lack it. Generated artifacts store checksum, creator/job, scope, row count, retention class and permission class.

### 15.6 Frontend Ownership And Query Rules

Use these production page boundaries:

```text
src/components/sections/Finance/payroll/
  runs/PayrollRunRegisterPage.tsx
  exceptions/PayrollExceptionQueuePage.tsx
  payslips/PayslipBatchRegisterPage.tsx
  payslips/PayslipBatchPage.tsx
  reports/PayrollReportsPage.tsx
  reports/reportDefinitions.ts
  shared/dialogs/
```

Split API modules by the same ownership under `src/api/finance/payroll/`. Pages compose query hooks; row/detail components do not start unrelated fetches. TanStack Query keys include the complete validated request object. Mutations invalidate only affected list/detail, command-center summary and task counts.

The report UI may use a local typed presentation map for icons and layout only. Labels, availability, permission and parameter requirements come from the server catalog. Operational Runs, Exceptions and Payslip pages do not gain charts.

All dialogs use one accessible shell with focus trap, initial focus, Escape/Cancel, disabled confirmation until schema-valid, pending lockout, field-level server errors and restored trigger focus. A dialog close during a submitted command does not cancel the backend transaction; reopening refetches command status by idempotency key.

### 15.7 Defect-Minimizing Implementation Protocol

Claude must implement one vertical slice at a time in this order: contract, source schema/query, route, client API/hook, page state, focused E2E. Do not build all pages against guessed fixtures and connect the backend later.

For each slice, create and keep a control-to-contract checklist with these columns:

| UI Control Or Value | Response Field Or Command | Permission | Allowed Source States | Success Side Effects | Failure/Conflict UI | E2E Case |
|---|---|---|---|---|---|---|

The slice is incomplete if any visible control/value lacks a row. Static mockup values are examples, not defaults or fallback data.

Before editing:

1. Inspect the current route, service, migration, frontend caller and E2E coverage. Verify the canonical pattern against current code; do not copy a stale caller.
2. Identify the single existing authority to extend and the legacy path to delete after cutover.
3. Write request/response schemas and transition invariants first. Generate or infer TypeScript types from those schemas instead of duplicating hand-written shapes.
4. Add source migrations by correcting the authoritative migration during this pre-production phase. Do not stack a corrective shim over a broken source definition.

During implementation:

1. Make route handlers thin and keep one transaction boundary in the domain command/RPC.
2. Check every DB/IO result. A failed audit, event, notification, workflow or outbox write fails the major mutation atomically.
3. Require `expectedVersion` on mutable aggregate commands and content-derived idempotency keys on retriable commands.
4. Return typed domain errors: `400` invalid contract, `401` unauthenticated, `403` unauthorized, `404` inaccessible/missing, `409` stale state or duplicate business intent, `422` valid request blocked by business rules, `503` durable dependency unavailable.
5. Add loading, empty, unauthorized, validation, conflict, partial-job and retry states before considering the UI complete.
6. Remove the superseded route/caller in the same slice after all callers and tests move. Do not leave two authorities.

Verification for each slice:

1. Run TypeScript typecheck and fast contract/unit tests.
2. Run the focused live payroll E2E suite for the completed slice, including the negative path and required side effects.
3. Exercise the production page against the real local API, not mocked browser data.
4. Compare response fields consumed by the UI with contract assertions in E2E.
5. Continue to the next slice only when the focused suite is green.

Run the full E2E suite once after all payroll slices are complete, following the repository test cadence.

### 15.8 Required Live E2E Additions

Extend `scripts/e2e/suites/financePayroll.mjs` or split focused suites without duplicating setup helpers.

**Run register and saved views**

- Exact filter combinations, deterministic pagination, no duplicate/missing rows across cursors and authorized tab counts.
- Archive exclude/only/include, retention fields and correction-source link.
- Calendar returns expected scheduled instances even when no run exists yet.
- Personal/team saved-view CRUD; unauthorized team publication denied; a view never widens data access.

**Findings queue**

- Queue/detail contract, selected deep link and resolved history.
- Assign, escalate, comment, resolve, waive and reopen positive paths plus stale-version `409`.
- Unauthorized/non-owner denial where policy requires ownership.
- Each mutation asserts exact business row, event, audit and notification side effects; workflow decisions remain exactly once.

**Payslip batches**

- List, get and paginated recipient filters across queued, rendering, scheduled, delivering, attention, completed and archived states.
- Idempotent generation and schedule commands; concurrent schedule/complete produces one winner.
- Retry targets only failed recipients and cannot resend delivered recipients.
- Completion denied for active delivery or an undisposed recipient; success stores manifest, retention, event and audit.
- Protected evidence URL is denied without employee-level permission and expires as configured.

**Reports**

- Catalog returns all nine keys with exact parameter, permission and format metadata.
- Every report executes against a locked test run and asserts the exact frontend-consumed shape.
- Three analytical series reconcile to their supporting table/control scope; six non-chart reports do not return decorative series.
- Reconciliation cannot report balanced outside tolerance.
- Report schedules cover create/update/pause/delete, recipient authorization, AST next-run calculation and stale-version conflict.
- Artifact history asserts checksum, scope, permission and retention metadata.

**Dialog and failure behavior**

- Required fields and attestations block confirmation; pending commands cannot double-submit.
- `409` refreshes current state without discarding the user's reason/comment.
- `422` renders named business blockers; `403` does not expose protected values.
- Keyboard focus enters the dialog, remains trapped and returns to the trigger on close.

### 15.9 Final Acceptance Gate

Do not describe this scope as complete until all of the following are true:

- The five production workspaces use protected APIs with no mock fallback and no direct browser Supabase reads.
- Every visible value/control appears in the control-to-contract checklist.
- All nine report keys and three Chart.js analytical views use real typed results.
- Run, finding, payslip and report-schedule commands enforce version/state guards and required atomic side effects.
- All employee-level lists are server-paginated and permission-gated.
- Focused live E2E suites pass, then the full suite passes at the final gate.
- Superseded routes, callers and prototype-specific production names are removed.
