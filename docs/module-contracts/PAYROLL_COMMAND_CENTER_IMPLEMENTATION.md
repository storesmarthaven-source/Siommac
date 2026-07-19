# Payroll Command Center - Build-Ready Technical Implementation

Status: **APPROVED IMPLEMENTATION CONTRACT**

Scope: Payroll Command Center only. This is the first payroll UI vertical slice.

Primary visual reference:

- `mockups/payroll-enterprise/index.html` from
  `SIOMAC_Payroll_Enterprise_Mockups_and_Implementation_2026-07-16_214801.zip`
- Production design reference:
  `src/components/sections/Finance/StatutoryDashboard.tsx`

This document is authoritative for this slice. Where the mockup displays data that the
backend cannot prove, this contract wins: omit or show an explicit unavailable state.
Never manufacture dashboard values.

## 1. Outcome

Replace the current `PayrollOverview` dashboard behavior with an authenticated,
server-aggregated command center that lets a payroll operator answer, in one scan:

1. Is the payroll portfolio healthy?
2. What requires my action now?
3. What deadlines are approaching?
4. Is the next run ready to release?
5. What is the financial and employee impact?
6. Which run should I open next?

The page is operational, not analytical. It uses one readiness doughnut only. No
decorative trend charts, generic action queues, duplicate funding cards, or fake
week-over-week comparisons.

## 2. Current-State Problems This Slice Must Remove

`src/components/sections/Finance/PayrollOverview.tsx` currently:

- requests up to 500 complete run records;
- computes KPIs, tabs, search, sorting, and pagination in the browser;
- cannot provide workflow assignment, current findings, funding readiness, or release
  evidence without additional calls;
- mixes command-center, run-register, report, drawer, and wizard responsibilities;
- uses totals across every fetched run rather than a declared reporting window;
- silently becomes incomplete after the API limit.

The new command center must not extend this pattern. Aggregation, filtering, ordering,
counts, and bounded run-register projection belong on the server.

## 3. Required / Forbidden / Deferred

### Required

- Authenticated Netlify POST route.
- `finance.payroll.view_all` read gate.
- Server-authored action capabilities.
- One bounded command-center response with a single `asOf`.
- Stable IDs on every actionable item.
- Explicit TTD currency codes and ISO dates.
- Current calculation-version findings only.
- Current workflow task assignment only.
- Keyset pagination for the embedded run register.
- Existing widget-board persistence for the four operational widgets.
- Exact loading, empty, denied, error, and stale-data states.
- Live E2E coverage before the slice is considered complete.

### Forbidden

- Direct browser Supabase reads.
- Fetching all runs and aggregating in Preact.
- Offset pagination in the new endpoint.
- Raw `app_events.payload` returned to the browser.
- Client-side permission inference for command visibility.
- Calling run workspace once per table row.
- Calling release preflight once per table row.
- Fabricated cutoff dates, deadlines, trends, readiness scores, or owners.
- UI buttons without an implemented backend command.
- A new dashboard-only copy of payroll state-machine logic.
- A second Chart.js chart.

### Deferred

- Create-run draft persistence and preflight.
- Full runs register/calendar/saved views.
- Exceptions work queue.
- Payslip batch center.
- Report catalog and schedules.
- Pay-policy setup.
- Mobile-specific command-center composition. The production page must remain safe at
  narrow widths, but this slice is optimized and acceptance-tested for desktop.

## 4. Route Contract

### Endpoint

`POST /api/finance/payroll/control-center/get`

Route file:

`netlify/functions/routes/financePayroll.ts`

Permission:

`finance.payroll.view_all`

The route validates with Zod, obtains the authenticated actor, calls one service
function, and returns the standard envelope:

```ts
{ success: true, data: PayrollControlCenterResponse }
```

No mutation occurs. No idempotency key is accepted.

### Request

```ts
type PayrollRunRegisterTab =
  | 'all'
  | 'attention'
  | 'approval'
  | 'ready'
  | 'released';

interface PayrollControlCenterRequest {
  window: {
    from: string; // YYYY-MM-DD, inclusive
    to: string;   // YYYY-MM-DD, inclusive
  };
  payGroupIds?: string[]; // UUIDs, maximum 25
  register?: {
    tab?: PayrollRunRegisterTab;
    search?: string;      // trim, maximum 100 characters
    cursor?: string;      // opaque server cursor
    limit?: number;       // default 10, maximum 25
  };
}
```

Validation rules:

- `from <= to`;
- maximum window is 366 days;
- duplicate pay-group IDs are rejected or normalized before hashing/querying;
- blank search becomes `undefined`;
- malformed cursor returns 422;
- cursor contains the deterministic order tuple, not arbitrary SQL.

Default window: first day of the current month through the last day of the next month,
computed by the frontend and sent explicitly. The backend never depends on a hidden
local-time assumption.

### Response

```ts
type HealthState = 'healthy' | 'attention' | 'at_risk' | 'critical';
type ReadinessState = 'not_started' | 'in_progress' | 'blocked' | 'ready' | 'released';

interface MoneyValue {
  amount: number;
  currency: 'TTD';
}

interface PayrollControlCenterResponse {
  asOf: string;
  window: { from: string; to: string };
  appliedFilters: { payGroupIds: string[] };
  capabilities: {
    canCreateRun: boolean;
    canManageRun: boolean;
    canApprove: boolean;
    canConfirmFunding: boolean;
    canRelease: boolean;
    canExport: boolean;
  };
  portfolioHealth: PayrollPortfolioHealth;
  kpis: PayrollCommandCenterKpis;
  assignedToYou: PayrollAssignedWork | null;
  recentActivity: PayrollActivityItem[];
  upcomingDeadlines: PayrollDeadlineItem[];
  nextScheduledRun: PayrollNextRun | null;
  runRegister: PayrollRunRegisterPage;
}
```

#### Portfolio health

```ts
interface PayrollPortfolioHealth {
  state: HealthState;
  score: number; // integer 0..100
  criticalCount: number;
  atRiskCount: number;
  openBlockerCount: number;
  overdueActionCount: number;
  primaryIntervention: {
    kind: 'finding' | 'approval' | 'funding' | 'deadline';
    title: string;
    detail: string;
    runId: string | null;
    targetId: string;
    dueAt: string | null;
  } | null;
}
```

Health scoring is deterministic and unit-tested:

- start at 100;
- subtract 20 for each run with an open blocker, capped at 60;
- subtract 10 for each overdue assigned workflow task, capped at 20;
- subtract 10 when a run due within three days lacks current funding confirmation;
- clamp to `0..100`;
- `critical` `< 50`, `at_risk` `< 70`, `attention` `< 90`, otherwise `healthy`.

The score is a display summary only. It never authorizes or blocks a payroll command.
Release authority remains `finance_payroll_release_preflight`.

#### KPI strip

```ts
interface PayrollCommandCenterKpis {
  nextPayDate: {
    date: string | null;
    runId: string | null;
    runNo: string | null;
  };
  activeRuns: number;
  employeesDue: number;
  grossPayroll: MoneyValue;
  netPayroll: MoneyValue;
  funding: {
    confirmed: MoneyValue;
    required: MoneyValue;
    gap: MoneyValue;
    state: 'not_required' | 'unconfirmed' | 'partial' | 'confirmed';
  };
}
```

All monetary KPIs are scoped to the requested window and filters. Employee count is
the sum of each included run's frozen/current calculation population; it is not an
organization headcount.

#### Assigned work and activity

```ts
interface PayrollAssignedWork {
  taskId: string;
  workflowId: string;
  runId: string;
  runNo: string;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
  assignee: {
    id: string; // app_users.id is TEXT
    displayName: string;
    photoUrl: string | null;
  };
  action: 'review_approval';
}

interface PayrollActivityItem {
  eventId: string;
  runId: string | null;
  runNo: string | null;
  eventType: string;
  label: string;
  actor: {
    id: string | null;
    displayName: string;
    photoUrl: string | null;
  } | null;
  occurredAt: string;
}
```

`assignedToYou` is the highest-priority open payroll workflow task assigned to the
authenticated actor. Do not return another user's task merely to populate the card.
If none exists, return `null`.

Activity is limited to three entries and allowlisted to payroll business events. The
service projects safe labels and identifiers. It never returns arbitrary payload JSON.

#### Deadlines

```ts
interface PayrollDeadlineItem {
  id: string;
  kind: 'cutoff' | 'pay_date' | 'approval' | 'funding' | 'release';
  runId: string;
  runNo: string;
  title: string;
  dueAt: string;
  state: 'overdue' | 'today' | 'upcoming';
}
```

Deadline sources must be persisted evidence:

- `cut_off_date`;
- `pay_date`;
- workflow-task `due_at`;
- finding `due_at`.

Funding/release deadlines are only emitted when an explicit persisted date exists.
Do not infer a date from the mockup.

Return at most five deadlines ordered by:

1. overdue before non-overdue;
2. `dueAt ASC`;
3. `runId ASC`;
4. `id ASC`.

#### Next scheduled run

```ts
interface PayrollReadinessGate {
  key:
    | 'inputs_locked'
    | 'calculation_current'
    | 'findings_clear'
    | 'approval_certified'
    | 'funding_confirmed'
    | 'journal_posted'
    | 'bank_accounts_ready';
  label: string;
  state: 'pass' | 'warning' | 'fail' | 'not_applicable';
  detail: string;
  targetId: string | null;
}

interface PayrollNextRun {
  run: PayrollRunRegisterItem;
  readiness: {
    state: ReadinessState;
    percent: number;
    passed: number;
    applicable: number;
    gates: PayrollReadinessGate[];
  };
  releaseImpact: {
    employees: number;
    gross: MoneyValue;
    net: MoneyValue;
    employerNis: MoneyValue;
    fundingGap: MoneyValue;
  };
}
```

Select the earliest non-cancelled, non-released scheduled run with a pay date on or
after `window.from`. Tie-break by `pay_date`, `period_start`, and `id`.

Readiness gates must reuse the existing release/certification authorities:

- current input snapshot and calculation version;
- current actionable findings;
- current valid certification;
- current funding confirmation;
- posted GL evidence;
- bank-account readiness;
- `finance_payroll_release_preflight` where the run is eligible for that check.

Do not copy the release preflight rules into Preact. Do not execute preflight per run;
only evaluate it for `nextScheduledRun`.

Readiness percent:

`round(pass gates / applicable gates * 100)`.

`not_applicable` gates are excluded from the denominator. A `fail` gate makes the
overall state `blocked`. A released run is `released`.

#### Run register

```ts
interface PayrollRunRegisterItem {
  id: string;
  runNo: string;
  runType: 'scheduled' | 'off_cycle' | 'correction' | 'final_pay';
  payGroup: { id: string | null; name: string | null };
  periodStart: string;
  periodEnd: string;
  payDate: string | null;
  employeeCount: number;
  gross: MoneyValue;
  net: MoneyValue;
  status: string;
  readiness: {
    state: ReadinessState;
    percent: number | null;
    blockerCount: number;
    warningCount: number;
  };
  updatedAt: string;
}

interface PayrollRunRegisterPage {
  items: PayrollRunRegisterItem[];
  nextCursor: string | null;
  total: number;
  tabCounts: Record<PayrollRunRegisterTab, number>;
}
```

Deterministic order:

`pay_date DESC NULLS LAST, period_end DESC, run_no DESC, id DESC`.

The cursor encodes the complete order tuple and filter fingerprint. A cursor replayed
with different filters returns 422.

Tab definitions:

- `all`: every run in the window except cancelled;
- `attention`: current blocker, failed calculation, returned, or overdue action;
- `approval`: pending approval or an open approval task;
- `ready`: approved/locked with every applicable readiness gate passing;
- `released`: exported/released evidence exists.

Create one shared server projection for run-register rows. The command center and
`runs/list` must not implement competing status/readiness definitions.

## 5. Backend Design

### Files

Create:

- `netlify/functions/lib/finance/payroll/controlCenter.ts`
- `netlify/functions/lib/finance/payroll/runReadModel.ts`

Modify:

- `netlify/functions/routes/financePayroll.ts`
- `netlify/functions/lib/finance/payrollRuns.ts` only to delegate shared run-row
  projection where practical; do not change existing route response shape in this slice.

### Service entry point

```ts
export async function getPayrollControlCenter(input: {
  actorId: string;
  window: { from: string; to: string };
  payGroupIds: string[];
  register: {
    tab: PayrollRunRegisterTab;
    search?: string;
    cursor?: string;
    limit: number;
  };
  capabilities: PayrollControlCenterCapabilities;
}): Promise<PayrollControlCenterResponse>
```

The route computes capabilities with the canonical backend permission helper. The
browser's `can()` result is presentation-only and must not be the response authority.

### Query plan

Use explicit columns and bounded queries. Never use `select('*')` in the new service.

Execute independent reads in parallel:

1. scoped run IDs and aggregate columns;
2. current calculation versions and totals;
3. current actionable finding aggregates;
4. current workflow task assigned to actor;
5. allowlisted recent payroll events;
6. current funding/certification/release evidence;
7. run-register page and tab counts.

Then evaluate release preflight once for `nextScheduledRun` when a current calculation
version exists and the run state makes preflight meaningful.

Every Supabase error is checked and thrown with route-safe context. No empty-array
fallback on query failure. The command center fails as a unit with HTTP 500/503 rather
than displaying a healthy-looking partial dashboard.

### Existing authorities to reuse

- `netlify/functions/lib/finance/payroll/workspace.ts`
  for workspace/readiness source shapes;
- `netlify/functions/lib/finance/payroll/findings.ts`
  for finding states, domains, and mapping;
- `finance_payroll_release_preflight(uuid)`
  for release eligibility;
- `finance_payroll_control_findings`
  for current calculation findings;
- `finance_payroll_calculation_versions`
  for frozen totals and population;
- `finance_payroll_certifications`;
- `finance_payroll_funding_confirmations`;
- `finance_payroll_release_certificates`;
- workflow instances/tasks for current approval assignment;
- `app_events` for allowlisted activity.

Do not derive release readiness from the legacy `finance_payroll_runs` totals when a
current calculation version exists.

### Database changes

No migration is automatically required for the read model.

Before adding an index:

1. run `EXPLAIN (ANALYZE, BUFFERS)` with a production-scale fixture;
2. verify an equivalent index does not already exist;
3. add only the index proven necessary;
4. allocate the next migration number from the reconciled migration history.

Likely access paths to verify:

- runs by `pay_date`, `period_end`, status, and pay group;
- findings by `run_id`, `calculation_version_id`, state, severity, due date;
- workflow tasks by assignee/status/due date and workflow source record;
- app events by source module/entity and `created_at`.

Do not create a materialized dashboard table in this slice.

### Performance budget

With 10,000 runs and 300 employees in the next run:

- response payload under 150 KB;
- endpoint p95 under 750 ms on the live development stack;
- no query returns more than 25 register rows, 5 deadlines, 3 activities, or 1 assigned
  task;
- no query count grows with register row count;
- no N+1 calls.

## 6. Frontend API

Create:

`src/api/finance/payroll/controlCenter.ts`

It owns:

- the request and response TypeScript contracts;
- `getPayrollControlCenter`;
- `payrollControlCenterQueryKey`;
- `usePayrollControlCenter`.

Query key must include normalized window, sorted pay-group IDs, register tab, search,
cursor, and limit.

Recommended query behavior:

- `staleTime: 15_000`;
- refetch on window focus;
- 30-second polling only while the document is visible;
- keep the prior page while a register cursor changes;
- do not auto-retry 401/403/422;
- invalidate after successful payroll lifecycle, finding, approval, funding, release,
  or export mutations.

Supabase Realtime may invalidate/refetch this query. It may not inject payroll data
into the cache.

## 7. UI Composition

### Files

Create:

- `src/components/sections/Finance/PayrollCommandCenter.tsx`
- `src/ui/widgets/registry.financePayroll.tsx`
- `src/ui/widgets/payrollCommandCenterWidgets.css`

Modify:

- `src/components/sections/Finance/PayrollOverview.tsx`
  to become the section router/container or replace it cleanly after its drawer/report
  responsibilities are moved to their owned pages;
- `src/components/sections/Finance/FinanceSection.tsx`
  only if a separate payroll subsection route is required.

Do not put the command-center implementation into the already large API or page file.

### Fixed page regions

These regions are not movable:

1. Standard `PageHeader`.
2. Portfolio-health urgency band.
3. Six equal KPI tiles.
4. Payroll run register.

Header actions:

- primary `New Payroll Run`, visible only when `canCreateRun`;
- secondary refresh icon;
- widget customize action.

Do not add a generic `Pay Policies` shortcut in this slice. The current permission
catalog has separate component, pay-group, overtime-rule, and statutory authorities,
not one payroll-policy permission or destination.

The portfolio band is approximately 80 px high, horizontal, and uses status color as
an indicator rather than a red outer border. Only explicit actions are clickable.

KPI order:

1. Next Pay Date
2. Active Runs
3. Employees Due
4. Gross Payroll
5. Net Payroll
6. Funding

The run register has six visual columns:

1. Run
2. Pay Group / Population
3. Pay Date
4. Net Payroll
5. Readiness / Stage
6. Action

The row opens the existing run workspace/drawer. The action menu exposes only commands
that are implemented and permitted.

### Movable widget board

Page key:

`finance.payroll.commandCenter.v1`

Zone:

`main`

Widget IDs:

- `finance.payroll.assignedWork`
- `finance.payroll.deadlines`
- `finance.payroll.releaseReadiness`
- `finance.payroll.releaseImpact`

Default 12-column layout:

```ts
[
  defInst(W_ASSIGNED,   0, 0, 5, 22, 'wide'),
  defInst(W_DEADLINES,  5, 0, 4, 22, 'standard'),
  defInst(W_READINESS,  9, 0, 3, 22, 'standard'),
  defInst(W_IMPACT,     0, 22, 12, 10, 'wide'),
]
```

Use the existing `WidgetBoard`, `WidgetBoardToolbar`, `WidgetLibraryModal`,
`useBoardLayout`, and auto-registering `registry.*.tsx` convention. Do not introduce a
second grid library.

The Assigned Work widget includes the actual assigned user's photo when available and
up to three recent payroll activities. The deadlines widget contains at most five
rows. Release Impact is a slim horizontal card. Release Readiness contains the only
Chart.js visualization: an animated doughnut with a text fallback and reduced-motion
support.

### Visual rules

- Follow Statutory spacing, border, table, tabs, icon, and button language.
- Use Lucide icons through the existing icon wrapper.
- Title Case for headings and action labels.
- Body text minimum 14 px; metadata minimum 12 px.
- No nested cards.
- Card radius at most 8 px.
- No gradients, bokeh, decorative blobs, or dark full-page theme.
- Navy is allowed only for the portfolio urgency band or focused run identity.
- Status cannot rely on color alone.
- Icons and labels align to stable grid tracks.
- Controls do not resize the board when values load.

### States

The page must render:

- skeletons preserving final geometry;
- no-runs empty state with `New Payroll Run` only when permitted;
- no-assigned-work success state, not a blank card;
- no-next-run state;
- permission-denied state;
- route error with retry;
- stale-data indicator using `asOf`;
- widget-specific error boundary without pretending other data is current.

## 8. Interaction Contract

| UI control | Required behavior |
|---|---|
| New Payroll Run | Opens the existing wizard for fields already honored by `runs/create`; do not expose draft persistence, preflight, or new mockup fields until their later slice is real |
| Refresh | Refetches control-center query and announces completion |
| Portfolio intervention | Opens exact finding, approval task, funding action, or run workspace using returned IDs |
| Assigned approval | Opens workflow decision surface for `taskId`; never approves directly from the card |
| Deadline row | Opens the owning run and relevant workspace section |
| Readiness gate | Opens the source finding/evidence section when `targetId` exists |
| Run row | Opens run workspace/drawer |
| Register tabs | Reset cursor and refetch server counts/items |
| Search | 300 ms debounce, reset cursor, server query |
| Customize | Uses existing widget-board edit/save/reset behavior |

All lifecycle commands continue to use their existing atomic RPC-backed routes. This
read-model slice does not create alternate mutation paths.

## 9. E2E Suite

Create:

`scripts/e2e/suites/payrollControlCenter.mjs`

Do not add these cases to the already broad `financePayroll.mjs` suite.

Required cases:

### Authentication and authorization

- unauthenticated request returns 401;
- plain employee returns 403;
- finance payroll viewer receives 200;
- response capabilities match actor permissions;
- another user's workflow task is not exposed.

### Contract

- exact top-level response fields;
- ISO dates and `currency: 'TTD'`;
- stable IDs on actions, deadlines, activities, and register rows;
- no raw app-event payload;
- no nullable field omitted contrary to the contract;
- `asOf` is present and parseable.

### Aggregation correctness

- window and pay-group filters affect all sections consistently;
- KPIs reconcile to seeded current calculation versions;
- employee totals are not organization headcount;
- funding confirmed/required/gap reconcile exactly;
- health score and state match the documented formula;
- only current-version actionable findings count;
- released/cancelled runs do not contaminate active KPIs.

### Assignment and activity

- actor's open payroll approval task is selected;
- overdue priority ordering is deterministic;
- assignee profile shape includes nullable photo;
- no task returns `assignedToYou: null`;
- activity is allowlisted, ordered, and capped at three.

### Deadlines and next run

- persisted cutoff/pay dates produce deadlines;
- absent dates do not produce invented deadlines;
- overdue/today/upcoming classification is correct at a fixed test date;
- next scheduled run selection and tie-break are deterministic;
- readiness gates agree with release preflight;
- blocker resolution followed by recalculation changes readiness on refetch;
- funding confirmation changes the funding gate without changing historical evidence.

### Run register

- each tab returns the correct items and count;
- search and pay-group filters work server-side;
- first and second keyset pages have no duplicate or missing row;
- malformed cursor returns 422;
- cursor with different filters returns 422;
- limit maximum is enforced;
- ordering remains stable when two runs share a pay date.

### Failure behavior

- a required source-query failure returns an error, not a partial healthy dashboard;
- empty database/window returns a valid empty response;
- read operation writes no business row, event, audit, task, notification, or handoff.

### Cleanup

- use `h.TAG`;
- use synthetic payroll actors only where deterministic payroll math requires it;
- remove workflows, tasks, findings, calculation evidence, funding evidence, and runs
  in foreign-key-safe order;
- rerun this suite once after success to prove cleanup and isolation.

## 10. Unit and Component Tests

Backend unit tests:

- health scoring boundaries;
- cursor encode/decode and filter fingerprint;
- deadline classification;
- readiness percentage excluding not-applicable gates;
- event allowlist projection.

Frontend tests:

- denied and error states;
- capabilities hide unsupported controls;
- register tab/search resets cursor;
- empty assigned-work and next-run states;
- widget action routes by returned IDs;
- Chart.js canvas has a textual readiness equivalent;
- reduced-motion disables chart animation;
- layout default/reset behavior.

Do not snapshot the entire page. Assert contracts and behavior.

## 11. Implementation Sequence

1. Add shared TypeScript contract and server projection types.
2. Implement `runReadModel.ts` with deterministic filters, counts, ordering, and cursor.
3. Implement `controlCenter.ts` aggregation and health/readiness pure helpers.
4. Add route validation, permission gate, and server-authored capabilities.
5. Add `payrollControlCenter.mjs`.
6. Run backend `tsc --noEmit` and `node --check` during iteration.
7. Run the new live E2E suite and fix all failures.
8. Add frontend API/hook.
9. Add fixed page regions and data states.
10. Add four registered widgets and persisted default board.
11. Wire actions to existing real surfaces only.
12. Run frontend typecheck and focused component tests.
13. Visually verify desktop at 1440x900, 1600x900, and 1920x1080.
14. Run the focused E2E suite again for cleanup proof.
15. Run the repository's required final regression gate once.

The UI implementation starts only after steps 1-7 are green.

## 12. Definition of Done

The slice is complete only when:

- the command center no longer requests 500 runs for browser aggregation;
- every displayed value has a named backend source;
- every displayed action has a real permission and route;
- readiness agrees with release preflight;
- current findings and workflow assignment are actor-correct;
- the register is keyset-paginated and stable;
- no N+1 query exists;
- the focused live E2E suite passes twice;
- typechecks and focused frontend tests pass;
- the final regression gate passes;
- Playwright screenshots show no overlap, clipping, tiny text, or misaligned icons at
  the required desktop viewports;
- implementation notes and `docs/REPO_MAP.md` are updated with the new route, service,
  API hook, component, widget registry, and suite.

## 13. Explicit Non-Goals

This command-center contract does not declare the whole payroll module complete. The
following remain separate vertical slices:

1. run drafts and create-run wizard;
2. run workspace and lifecycle dialogs;
3. approval and exception work queues;
4. payslip batches;
5. reports and schedules;
6. pay-policy setup;
7. bank disbursement handoff views.

Each must receive its own backend contract, E2E suite, frontend API, UI implementation,
and final verification. They must not be simulated inside this command center.
