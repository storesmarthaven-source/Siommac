# Payroll Pay-Policy Setup — Contract-to-Code Map

**Status:** Approved Phase A design, pre-implementation  
**Branch/base:** `codex/payroll-policy-setup` / `f4659c3f9f34ad64c54975e866f0eb317d906b4e`  
**Authority:** `docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md` §§9.4 and 14

## 1. Delivery boundary

Phase A delivers the governed setup path for local Trinidad and Tobago employees paid in TTD:

- Pay-policy directory, server-filtered pagination, status filters, and policy drill-through.
- Server-persisted create/edit wizard for `standard_salary` and `hourly_shift`.
- Effective-dated versions with typed component and source rules.
- Preflight, certification, central workflow submission, independent approval, activation,
  rejection, retirement, version comparison, and audit history.
- Effective pay-group assignment with overlap prevention.
- Reuse of `finance_pay_groups`, `finance_pay_components`, active TT statutory versions,
  workflow engine, `app_events`, `hr_audit_log`, notifications, and `handoff_outbox`.

Phase B is not exposed: `project`, `offshore_rotation`, `marine_voyage`,
`standby_callout`, crew assignments/movements, roster or asset rules, run-policy snapshots,
calculation evidence, and run-engine resolution. Payroll runs continue to use their existing
contracts until Phase B is approved and delivered end-to-end.

## 2. Existing capability map

| Concern | Existing source | Phase A decision |
|---|---|---|
| Pay groups | `finance_pay_groups`; `/finance/payroll/pay-groups/*` | Reuse identity/list; add policy-assignment endpoints only. |
| Pay components | `finance_pay_components`; `/finance/payroll/components/list` | Reuse approved active catalogue rows; never duplicate component definitions. |
| Statutory schedule | `finance_statutory_versions` | Resolve active approved TT version during preflight/activation; do not copy rates. |
| Overtime | `finance_overtime_rules` | Remains its own governed setup; policy source rules refer to approved time, not duplicate multipliers. |
| Workflow | `module_workflow_bindings`, template versions, workflow tasks/decisions | Add one pay-policy binding; submission and approvals remain workflow-native. |
| Platform evidence | `app_events`, `hr_audit_log`, notifications, `handoff_outbox` | Written transactionally by policy commands or the workflow transition/final activation owner. |
| UI shell | Statutory configuration and Payroll Command Center shells | Reuse page header, underline tabs, dense white-header registers, drawers/modals, toast/dialog conventions. No widget board for the fixed wizard/detail workspace. |
| Protected data | Authenticated Netlify POST APIs | No browser Supabase reads. |

There is no current `finance_pay_policies` model or policy API. A canonical migration and
transactional RPCs are therefore required.

## 3. Phase A canonical data

| Object | Purpose | Key invariants |
|---|---|---|
| `finance_pay_policies` | Stable identity | Unique uppercase code; local employee scope; type is `standard_salary` or `hourly_shift`; creator is text FK. |
| `finance_pay_policy_versions` | Effective governed version | Draft optimistic version token; approved/active immutable; TTD and `America/Port_of_Spain`; no overlapping active period per policy. |
| `finance_pay_policy_components` | Component bindings | FK to canonical component; unique per version; allowlisted basis/rate/eligibility combinations. |
| `finance_pay_policy_source_rules` | Input ownership and conflict handling | Allowlisted sources/outcomes; one source type per version. |
| `finance_pay_policy_costing_rules` | Phase A payroll costing control | Only employee cost-centre resolution; no generic chart/accounting builder. |
| `finance_pay_group_policy_assignments` | Effective group resolution | Active version only; no overlapping assignment per pay group; effective periods are closed, never overwritten. |
| `finance_pay_policy_command_receipts` | Idempotency | Same key/hash returns original; changed hash conflicts. |

The single legal entity is persisted as `SIOMAC-TT` and rendered read-only because the
repository has no canonical legal-entity registry. The browser does not submit a legal-entity,
currency, jurisdiction, or foreign-worker choice.

## 4. API-to-code map

All paths are POST-only under `/api/finance/payroll/policies`. Every schema is strict and reads
`body.args ?? body`.

| ID | Path | Permission | Service/RPC | Response |
|---|---|---|---|---|
| API-PPS-001 | `/list` | `finance.payroll.policies.view` | `listPayPolicies` | Cursor page + aggregate counts. |
| API-PPS-002 | `/get` | view | `getPayPolicy` | Policy workspace DTO: current version, rules, versions, assignments, audit. |
| API-PPS-003 | `/create-draft` | `finance.payroll.policies.draft` | `finance_pay_policy_draft_command_tx(create)` | Persisted identity/version/rules and version token. |
| API-PPS-004 | `/update-draft` | draft | `finance_pay_policy_draft_command_tx(update)` | Updated draft; stale token returns `409`. |
| API-PPS-005 | `/preflight` | view | `finance_pay_policy_preflight` | Exact blockers/warnings/checksum; no fake score. |
| API-PPS-006 | `/submit` | `finance.payroll.policies.submit` | `finance_pay_policy_submit_tx` + canonical workflow primitive | Pending version + workflow/task evidence. |
| API-PPS-007 | `/activate` | `finance.payroll.policies.activate` | `finance_pay_policy_activate_tx` | Active immutable version; supersedes overlap; notifications/handoff. |
| API-PPS-008 | `/reject` | policy approver permission selected by current workflow step | Canonical `decideTask(rejected)` | Rejected workflow/version after transition finalization. |
| API-PPS-009 | `/retire` | activate | `finance_pay_policy_retire_tx` | Retired policy/version; effective assignments ended. |
| API-PPS-010 | `/versions/list` | view | `listPayPolicyVersions` | Bounded version history. |
| API-PPS-011 | `/versions/get` | view | `getPayPolicyVersion` | Immutable version manifest. |
| API-PPS-012 | `/versions/compare` | view | `comparePayPolicyVersions` | Server-derived field/rule changes. |
| API-PPS-013 | `/pay-groups/list` | view | `listPayPolicyAssignments` | Effective assignments with group names and member counts. |
| API-PPS-014 | `/pay-groups/assign` | `finance.payroll.policies.assign` | `finance_pay_policy_assignment_tx(assign)` | Effective assignment. |
| API-PPS-015 | `/pay-groups/end-assignment` | assign | `finance_pay_policy_assignment_tx(end)` | Closed assignment. |

## 5. UI-to-contract map

| Surface | Real controls | Contract |
|---|---|---|
| Policy directory | Status tabs, search, page size/cursor, refresh, new policy, row open | API-PPS-001/002 |
| New/edit wizard | Identity; effective controls; component bindings; source controls; cost/payment certification; save draft; preflight; submit | API-PPS-003–006 |
| Policy overview | Stable identity, active/pending version, effective period, validation state | API-PPS-002/005 |
| Components | Immutable active bindings and draft bindings | API-PPS-002/011 |
| Source controls | Owner, match key, cutoff/late-input/conflict outcome | API-PPS-002/011 |
| Cost & Payment | TTD, primary bank destination, missing-bank blocker, employee cost-centre rule | API-PPS-002 |
| Versions | Create next draft, view, compare | API-PPS-003/010–012 |
| Usage | Assign/end pay group, effective group population | API-PPS-013–015 |
| Audit | Bounded policy-specific `app_events`/audit rows | API-PPS-002 |

Unsupported mockup actions are removed, not stubbed: audit-package export, create payroll run
from a policy, crew worker lists, movements, assets, work orders, and conditional crew KPIs.

## 6. State and side-effect ownership

`draft -> pending_approval -> approved -> active -> superseded|retired`

- Draft create/update: business rows + one business event + one audit row, one transaction.
- Submit: validates full configuration, starts the central two-step workflow (HR source review,
  then Finance statutory review), updates the version, and writes business event/audit in one
  transaction. Workflow owns tasks and workflow audit/events.
- Workflow completion: adapter transaction sets `approved` and writes source event/audit.
- Activation: an independent actor with activation permission revalidates and locks the policy,
  version, active overlaps, and assignments; sets active/superseded state; writes event, audit,
  recipient notifications, and a Finance Payroll handoff in one transaction.
- Assignment/end/retire: each has a command receipt, business write, event, and audit in one
  transaction. Assignment activation also emits a payroll handoff.

External delivery is represented only by durable database intent; no network call occurs while
locks are held.

## 7. Decisions and deviations

1. Phase A deliberately excludes conditional crew/run behavior because it cannot be safely
   delivered without HR crew sources and payroll snapshot/calculation changes.
2. Only `standard_salary` and `hourly_shift` are accepted. Unknown/Phase B policy types are
   rejected by API and database checks.
3. Currency is TTD, jurisdiction is TT, timezone is `America/Port_of_Spain`, relationship is
   local employee, and payment destination is primary bank account. These are persisted,
   server-owned values rather than dormant UI inputs.
4. A fixed form/wizard and detail workspace are not widget boards. The directory uses the
   established Statutory register language.
5. Employee loans are removed from Payroll Setup navigation because they are employee/payroll
   operations, not pay-policy setup. Their existing API and feature remain untouched.

