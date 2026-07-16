# SIOMAC HR Enterprise Technical Implementation

## 1. Purpose and authority

This document is the build-ready implementation specification for completing the
existing SIOMAC Human Resources module. It is derived from the current frontend,
API clients, Netlify functions, database migrations, workflow engine,
communications platform, handoff bus, and E2E suites.

This is not a greenfield HR redesign. Existing atomic workflow slices must be
preserved. The implementation must close the remaining lifecycle, communication,
cross-module, UI-state, and verification gaps without rebuilding working modules.

The following project rules remain authoritative:

- Protected ERP data is accessed through authenticated Netlify APIs.
- `app_users.id` and all user references are text.
- Significant mutations own a business record, event, audit, workflow work, and
  required downstream intent in one consistent lifecycle.
- Database-owned work commits atomically. External systems are handled through a
  durable saga or transactional outbox, never represented as already completed.
- No accept-and-drop inputs, swallowed errors, fake delivery states, duplicate work
  objects, or parallel legacy and replacement paths.
- Every completed slice requires live E2E verification.

## 2. Snapshot qualification

The codebase is actively being changed. This specification distinguishes three
states:

- **Preserve**: the current code calls an existing atomic workflow RPC and must not
  be returned to the legacy create/start or status/start/stamp sequence.
- **Active conversion**: a migration or service edit is in progress. Re-read the
  current file and verify the live migration before implementing adjacent work.
- **Remaining**: the current implementation still uses separate database calls,
  compensating cleanup, best-effort side effects, or HR-local handoff rows.

Migration presence in source control does not prove that it has been applied to the
live database. Each implementation slice must record source hash, applied migration,
PostgREST schema reload, backend build, and live E2E result.

## 3. Current HR surface

The current HR shell exposes these operational areas:

1. Employee Master
2. Onboarding
3. Organization
4. Documents
5. Offboarding
6. Leave and Absence
7. Transfers and Promotions
8. Attendance and Timekeeping
9. HR Requests
10. Shift Roster
11. Compensation
12. Overtime

Contract Management also has a substantial backend and typed frontend API but no
registered HR page. It is included in this implementation because it is useful for
an organization of this size and already exists. Recruitment, performance,
benefits, workforce planning, social features, and AI assistance are excluded.

## 4. Atomic coverage matrix

| Area | Current state | Required action |
|---|---|---|
| Workflow decision/finalization | Atomic engine RPCs already exist | Preserve; all HR approvals must use the engine |
| Compensation pay-item submit | Atomic Shape-A branch for `hr_employee_pay_items` | Preserve and verify live E2E |
| Statutory-profile submit | Atomic `workflow_submit_for_record_tx` branch | Preserve and verify live E2E |
| Timesheet submit | Atomic Shape-A branch for `hr_timesheets` | Preserve and verify live E2E |
| Overtime create and start | Atomic `workflow_create_and_start_tx` branch | Preserve; remove any stale fallback path |
| Approvable HR Request create and start | Atomic `workflow_create_and_start_tx` branch | Preserve; keep plain create for genuinely non-approvable request types |
| Leave create and start | Active conversion; current tree has both legacy references and an in-progress Shape-B track | Re-read current snapshot; finish one canonical path only |
| Organization change create and start | Active conversion | Finish and prove before implementing organization notifications/handoffs |
| Employee change create and start | Active conversion | Finish and prove before transfer/promotion downstream work |
| Employee creation | Database plus Supabase Auth provisioning saga | Redesign as durable provisioning lifecycle; cannot be one database transaction |
| Employee status changes | Separate record/history/event/audit operations | Add typed status-transition transaction and post-commit Auth action |
| Onboarding start | `runModuleMutation` plus compensating deletes and later optional actions | Replace with typed onboarding-start transaction |
| Onboarding lifecycle | Direct multi-call mutations | Add typed state-transition transactions by lifecycle family |
| Account provisioning | Auth, employee, invite, email and local handoff are sequential | Implement durable provisioning saga |
| Offboarding start | Case, tasks and HR-local handoffs with compensating deletes | Replace with typed offboarding-start transaction |
| Offboarding finalize | Employee status, history, local handoff and case completion are sequential | Replace with database transaction plus access-revocation outbox |
| Document management | Direct writes plus event/audit delivery | Transactionalize verification, archive, requirement and expiry-reminder intent |
| Roster creation/publish | Create adapter plus separate publish/notification work | Transactionalize publish/reopen and schedule impact intent |
| Attendance corrections/exceptions | Direct writes plus events/audits | Add typed correction and exception decision transactions |
| Contracts | Adapter/direct lifecycle mutations | Add typed issue/sign/activate/renew/terminate transactions |

The implementation must not create one large generic HR RPC. Use typed functions
per lifecycle family with explicit columns, status guards, lock order, event types,
audit shapes, and handoff contracts.

## 5. Target ownership model

Every user-visible operation must have one authoritative work object.

### 5.1 Workflow task

Use for approval, review, maker-checker, or ordered business decisions. Workflow
tasks remain owned by the workflow engine. Module services must not create a second
ticket for the same approval.

### 5.2 Platform handoff

Use when ownership moves to another SIOMAC module. The source transaction writes a
typed `handoff_outbox` row. The target receiver creates or updates its native target
record and writes the source/target link. An HR-local handoff table may remain as a
read projection only; it cannot be the delivery mechanism.

### 5.3 Ticket

Use for service work requiring an owner, SLA, evidence, comments, and resolution
when the receiving team does not have a native module record. The immediate example
is IT mailbox/device provisioning while no IT module exists. Tickets must carry
`source_module`, `source_entity_type`, and `source_entity_id`.

### 5.4 Record discussion

Use for human collaboration on a business record. Threads are user-created or
resolved on first use; a mutation must not create a discussion merely because a
record exists. One record has one canonical discussion thread.

### 5.5 Notification

Use for durable awareness or action directed to a known recipient. Notifications
must link to the source record or authoritative work object, respect preferences,
and use stable dedupe keys.

### 5.6 Toast

Use only for immediate feedback in the current browser session. A toast is never
proof that a notification, message, ticket, workflow, or handoff was delivered.

## 6. Toast standard

| Toast tier | Use |
|---|---|
| Standard | Validation, simple save, cancellation, archive, or immediate failure |
| Action | State transition with one useful next action such as Open Case or View Task |
| Rich | Import, export, generated file, multi-record operation, or background job |
| Loading updated in place | Commands with visible latency; update the same toast ID to success or failure |

Requirements:

- Replace page-local toast callbacks and plain untyped calls with the canonical
  toast API.
- Error toasts use the server's safe error message and do not claim rollback unless
  the transaction contract proves it.
- Action buttons navigate through the app router, not raw logical href strings.
- Bulk activity produces one summary toast, never one toast per employee.
- Destructive operations use a confirmation/action dialog before the mutation and a
  standard or action toast after the result.

## 7. Notification and deep-link foundation

Complete this foundation before adding HR notification volume:

1. Make the bell dropdown and full Notification Center call the existing target
   navigation helper after marking the record read.
2. Define one canonical action route for every HR entity:
   - `s-hr-employees`
   - `s-hr-onboarding`
   - `s-hr-organization`
   - `s-hr-documents`
   - `s-hr-offboarding`
   - `s-hr-leave`
   - `s-hr-transfers`
   - `s-hr-attendance`
   - `s-hr-requests`
   - `s-hr-roster`
   - `s-hr-compensation`
   - `s-hr-overtime`
   - `s-hr-contracts`
3. Carry source type and source ID separately from the section route.
4. Add HR-shell handling for `siomac:openRecord` and open the correct detail,
   drawer, tab, task, or case.
5. Validate route availability before displaying Open actions.
6. Add E2E coverage proving notification click -> section -> exact record.

Notification durability remains an engine-wide platform item. HR work must use the
same durable intent/worker design when that track lands, not invent an HR-only
delivery table.

## 8. Event and recipient policy

| Event family | Primary recipients | Durable action? | Additional behavior |
|---|---|---|---|
| Employee created | HR owner if different from actor | No | Optional onboarding action toast to actor |
| Employee change submitted | Workflow assignee | Yes | Employee notified only when policy permits |
| Employee change decided | Requester and affected employee | No | Deep-link to employee/change record |
| Onboarding started | Case owner and supervisor | Owner only | No automatic discussion |
| Onboarding task assigned | Assigned user | Yes | Due date from task |
| Onboarding blocker raised | Owner and blocker owner | Yes | Escalate by policy, not immediate ticket |
| Onboarding handoff failed | Case owner and target-module owner | Yes | Retry opens handoff detail |
| Onboarding completed | Employee, owner, supervisor | No | Activation readiness summary |
| Account setup requested | IT ticket assignee or Access receiver | Yes | Never say external mailbox is complete |
| Document expiring | Employee, then HR by escalation window | Conditional | Dedupe by document/window/recipient |
| Contract issued | Employee/signatory | Yes | Open contract signature view |
| Contract activated/terminated | Employee and HR owner | No | Feed downstream lifecycle events |
| Leave submitted | Resolved approver | Yes | Employee gets local submit feedback only |
| Leave approved/rejected/returned | Employee/requester | No | Publish roster/attendance/payroll impact event |
| Timesheet submitted | Workflow assignee | Yes | Existing atomic submit owns business event |
| Timesheet decided | Employee and manager where relevant | No | Payroll eligibility may change |
| Roster published/revised | Affected employees | No | Use grouped delivery and one schedule version |
| Attendance exception assigned | Responsible supervisor/HR user | Yes | No ticket unless escalated outside HR |
| Transfer/promotion submitted | Workflow assignee | Yes | Preview impact before submit |
| Transfer/promotion applied | Employee, old/new managers | No | Create typed downstream handoffs |
| Pay item submitted | Workflow assignee | Yes | Preserve existing atomic submit |
| Pay item decided | Employee only if policy allows compensation disclosure | No | Payroll consumes approved state |
| Overtime submitted | Workflow assignee | Yes | Preserve existing atomic create/start |
| Overtime decided | Employee and supervisor | No | Payroll consumes approved item once |
| HR request submitted | Assigned fulfiller or approver | Yes | Do not duplicate as ticket by default |
| HR request fulfilled | Requester | No | Attach artifact/reference where applicable |
| Offboarding started | Case owner and supervisor | Yes | Target teams receive native work/handoffs |
| Offboarding blocker | Case owner and target owner | Yes | Escalate according to exit date |
| Offboarding finalized | HR owner and employee if policy permits | No | Access revocation must be separately confirmed |

## 9. Cross-module contract catalogue

Each contract requires a versioned payload schema, source status, target receiver,
target record type, idempotency key, completion callback, failure policy, and E2E
test. Free-form `target_module` plus arbitrary JSON is not sufficient.

### 9.1 Onboarding contracts

| Contract | Target | Target ownership |
|---|---|---|
| Payroll readiness | Payroll | Employee payroll-readiness intake/checklist |
| NIS/statutory verification | Payroll/Finance | Existing statutory verification workflow |
| Safety induction | HSE | Training/induction assignment |
| Required training | Training/HSE | Native training assignments |
| PPE issue | HSE | Employee PPE issue record |
| SIOMAC access profile | Access Control | User role/profile grant request |
| External mailbox/device | IT ticket queue | Ticket with SLA, assignee and evidence |
| Initial roster eligibility | Roster | Eligibility/update event after activation |

### 9.2 Transfer and promotion contracts

| Contract | Target | Target ownership |
|---|---|---|
| Cost centre/pay group change | Payroll | Effective-dated payroll assignment |
| Role/access change | Access Control | Permission profile change request |
| Site/schedule change | Roster | Effective-dated roster eligibility update |
| Safety/training delta | HSE/Training | New requirements generated from position/site |
| Manager/reporting change | HR Organization | Assignment history and reporting-line update |

### 9.3 Leave, attendance, roster and overtime contracts

- Approved leave publishes one effective-dated absence event consumed by Roster,
  Attendance, and Payroll.
- Roster publication creates one immutable schedule version. Attendance reads the
  expected shift from that version.
- Attendance approval publishes payable time, exception and unpaid-absence facts.
- Approved overtime publishes one immutable payroll input keyed by overtime ID.
- Reversal/cancellation publishes a compensating fact; consumers do not delete
  history silently.

### 9.4 Offboarding contracts

| Contract | Target | Target ownership |
|---|---|---|
| Final-pay preparation | Payroll/Finance | Native final-pay case, not generic cost entry |
| SIOMAC access revocation | Access Control | Timed revoke request and confirmation |
| External account/device recovery | IT ticket queue | Ticket with checklist, evidence and due date |
| PPE return | HSE | PPE return/clearance record |
| Roster removal | Roster | Future-assignment cancellation/replacement review |
| Final documents | HR Documents/Contracts | Generated/issued document records |

## 10. Account provisioning lifecycle

The UI and backend must distinguish SIOMAC access from external work accounts.

### 10.1 SIOMAC login

1. Reserve employee identity and work-email alias in the HR database transaction.
2. Write a provisioning outbox row with a stable idempotency key.
3. A worker creates or reconciles the Supabase Auth user.
4. The worker writes the Auth ID and creates a single-use invitation.
5. Invitation delivery is recorded as sent, failed, or surfaced.
6. Password acceptance consumes the token once and activates the SIOMAC account.
7. Reconciliation detects Auth-created/DB-not-linked and DB-invited/Auth-missing states.

The worker must be retry-safe. Re-running must resolve the existing Auth user by
stable identity rather than creating a second account.

### 10.2 External mailbox, directory, badge and equipment

- Without a real provider connector, create a source-linked IT ticket.
- The ticket stores requested services, target date, employee, site, manager,
  permission profile, equipment profile and evidence requirements.
- Completion requires the IT reference and evidence. It updates the onboarding
  handoff projection through the platform source/target link.
- A provider adapter may later automate Microsoft 365 or Google Workspace, but the
  same contract and states remain.
- The UI labels are `Provision SIOMAC Access` and `Request Work Account Setup`.
  They are not one ambiguous Provision button.

### 10.3 Offboarding revocation

- Database status and SIOMAC authorization eligibility change atomically.
- Auth session/token revocation runs through a durable external-action outbox.
- External account revocation and device recovery remain IT-owned work.
- Finalization cannot claim access is removed until the required revoke contracts
  are completed or explicitly waived by an authorized role with a reason.

## 11. Module implementation requirements

### 11.1 HR Overview and Work Queue

Build a restrained operational landing page, not a chart dashboard.

Required content:

- Assigned approvals and tasks
- Overdue onboarding/offboarding work
- Failed cross-module handoffs
- Expiring critical documents/contracts
- Payroll-readiness blockers
- Attendance/leave exceptions needing action
- Upcoming employee starts, contract ends and exits

Only decision-useful trends belong here: backlog age, onboarding delay and absence
or coverage trend. Transaction pages do not need decorative charts.

### 11.2 Employee Master

Preserve the register, profile drawer, create/import and action dialogs. Complete:

- Full profile route/drawer with identity, employment, assignment, contact,
  statutory, compensation summary, contracts, documents, training, leave,
  attendance, onboarding/offboarding, workflow and timeline tabs
- Effective-dated assignment and status history
- Record discussion
- Source-linked service tickets
- Payroll-readiness explanation and blocker navigation
- Permission-aware field masking and compensation visibility
- Employee creation result state that separately reports employee, SIOMAC login and
  onboarding outcomes

### 11.3 Contracts

Expose the existing contract service through a dedicated HR page:

- Command/list view with status, employee, contract type, start/end, signatures and
  expiry risk
- Contract detail with terms, signatories, attachments, timeline, discussion and
  linked employee/onboarding/offboarding records
- Create from template wizard
- Issue, sign, activate, renew, terminate and cancel dialogs
- Template manager
- Expiry sweep and renewal work queue
- Employee self-service contract view where permission allows

Do not implement a legal document authoring suite. Templates, controlled fields,
attachments, signatures/status and audit history are sufficient.

### 11.4 Organization

Preserve tree, positions, cost centres and change requests. Complete:

- Replace raw IDs with authorized searchable selectors
- Vacant/filled position state and headcount budget context
- Effective dates for approved moves
- Impact preview covering employees, workflows, roster, payroll, access and training
- Detail/timeline for high-risk change requests
- Typed downstream handoffs after approval
- Discussion only on change requests, not static units/positions

### 11.5 Documents

Complete:

- Register, employee document view, requirements, compliance and expiry queue
- Upload, verify/reject, replace, archive and secure-download dialogs
- Restricted-tier permission and download audit
- Requirement scope by worker type, position, site and employment type
- Reminder schedule with durable dedupe and escalation
- Document request linked to onboarding, contracts or offboarding
- No general-purpose messaging inside the document register

### 11.6 Onboarding

Preserve the existing command center, cases, case detail, tasks, blockers, handoffs,
packages, reports, custom actions and communications. Complete:

- Atomic case, task, document-request, package-action and handoff-intent creation
- Package version snapshot on each case
- Dependency-aware task readiness and blocking rules
- Real target-module delivery and target record links
- Separate SIOMAC and external account setup
- Case discussion and linked IT tickets
- Scheduled starts and escalation worker
- Activation gate based on required tasks/handoffs/documents
- Completion summary and employee/supervisor notifications
- No manual Accept/Complete controls for work owned by another module; those states
  must come from the target receiver

### 11.7 Leave and Absence

Preserve request, balance, accrual, calendar, leave type and report services.
Complete:

- Finish and verify the active create-and-start atomic slice
- Manager/team approval queue and employee request detail
- Conflict/coverage preview using published roster and approved leave
- Balance reservation, approval consumption, rejection release and cancellation
  reversal in typed transactions
- Attachments where leave policy requires evidence
- Employee and approver notifications
- Approved-absence event consumed by Roster, Attendance and Payroll
- No tickets or automatic discussion for ordinary leave requests

### 11.8 Attendance and Timekeeping

Preserve records, punches, imports, exceptions, timesheets, policy and reports.
Complete:

- Timesheet detail and approval state using the existing atomic submit
- Correction request/decision transaction
- Exception ownership, SLA and escalation
- Expected-vs-actual shift context from Roster
- Leave and holiday explanation on affected days
- Import review, row errors and commit summary using a rich toast
- Payable-time publication to Payroll after approval
- Record discussion only for timesheets and disputed exceptions

### 11.9 Shift Roster

Preserve rosters, templates, rotations, coverage and My Shifts. Complete:

- Searchable site, unit, position and employee selectors; remove raw ID entry
- Schedule grid with keyboard-accessible assignment editing
- Coverage gap and rest-rule validation
- Leave synchronization before publication
- Atomic publish/reopen with immutable version number
- Grouped employee notifications for published changes
- Attendance expected-shift and Payroll premium integration
- Change summary before republishing

### 11.10 Overtime

Preserve the existing atomic create-and-start workflow. Complete:

- Overtime detail with source shift/timesheet context
- Rule/rate preview without allowing HR to override Payroll's authoritative pricing
- Approver queue and employee history
- Duplicate/overlap and future-date guards
- Approval/rejection notifications
- Immutable payroll-input link and compensating cancellation before payroll lock
- No chart required

### 11.11 Transfers and Promotions

Complete:

- Request wizard for position, unit, site, manager, grade, compensation and effective date
- Before/after impact summary
- Approval detail and discussion
- Atomic request/workflow creation and atomic approved apply
- Effective-dated assignment history
- Typed Payroll, Access, Roster and Training handoffs
- Target completion status and failures visible in the request detail
- Employee and old/new manager notifications

### 11.12 Compensation and Statutory Profile

Preserve atomic pay-item and statutory-profile submission. Complete:

- Pay-item register/detail, maker-checker history and effective-date overlap guard
- Employee compensation summary with strict field permissions
- Payroll component/rule references rather than duplicated rate logic
- Statutory profile verification status and Finance task link
- Approved pay-item publication to Payroll exactly once
- Employee notification only when compensation disclosure policy permits
- Keep statutory profile as a separate subview even if it shares the page shell

### 11.13 HR Requests

Preserve atomic create-and-start for approvable request types. Complete:

- Configured request catalogue with required fields, approval and fulfilment owner
- My Requests, triage, approval detail and fulfilment views
- Attachments and fulfilment artifact/reference
- Requester notifications on return, reject, approve and fulfil
- Optional conversion to a ticket only for a genuine service queue lacking a native
  HR fulfilment record
- No duplicate HR Request and ticket for ordinary HR work

### 11.14 Offboarding

Rebuild the current thin page around the existing data, not as a second system:

- Command center/list, case detail, tasks, clearances, assets/access, final pay,
  documents, exit interview, communications and timeline
- Configurable exit packages rather than a permanent code-defined standard plan
- Atomic start with tasks and platform handoff intents
- Target-owned final pay, PPE, roster and access work
- Scheduled cutoff dates and escalation relative to last working day
- Required completion/waiver gates
- Atomic HR finalization plus durable SIOMAC Auth revocation
- Completion evidence and final summary

## 12. Atomic slice plan

Implement each slice as migration -> service cutover -> frontend contract -> E2E.
Never wire a route before the operator applies the migration.

### Foundation F1: current-state lock

- Record hashes for existing atomic migrations and their service callers.
- Run static grep gates proving no legacy workflow start in preserved slices.
- Reconcile in-progress Leave, Organization and Employee Change work before creating
  any new migration numbers.

### Foundation F2: notification navigation and HR shell

- Canonical routes and open-record handlers
- Permission-driven HR navigation, including HR Staff/HR Manager access mapping
- Contract page registration
- Canonical toast usage

### Backbone B1: typed handoff contracts

- Versioned contract catalogue
- HSE/Training, Payroll, Access Control and IT-ticket receivers
- Source/target record links
- Retry, failure, dead-letter and reconciliation worker behavior
- Replace manual target-state controls with receiver acknowledgements

### Employee E1: status and lifecycle transaction

- Employee status history + employee state + event + audit + outbox intent
- Separate Auth action outbox for disable/revoke
- Idempotent transition contract and effective-date guard

### Employee E2: provisioning saga

- Durable provisioning command and attempt ledger
- Auth reconciliation and invitation lifecycle
- IT ticket creation for external services
- Failed-step recovery and admin reconciliation UI

### Onboarding O1: atomic start

- Case + case number + package version snapshot + tasks + document requests + custom
  package actions + platform handoffs + business event + audit
- No post-commit best-effort package action creation
- Same-key retry returns the same case and creates no duplicates

### Onboarding O2: lifecycle transitions

- Task complete/block/unblock/reassign
- Case pause/resume/ready/complete/cancel
- Blocker resolve/escalate/waive
- Enforce legal status transitions and required evidence

### Time T1: finish active workflow slices

- Leave create/start
- Organization and employee change create/start
- Preserve overtime, timesheet, requests, pay-item and statutory submit

### Time T2: leave balance and attendance decisions

- Leave reservation/consume/release/reversal transactions
- Attendance correction/exception decisions
- Payable-time and approved-absence event contracts

### Roster R1: publication

- Publish/reopen transaction
- Schedule version and affected-employee set
- Notification batch intent and downstream facts

### Contracts C1: lifecycle

- Create/issue/sign/activate/renew/terminate/cancel transactions
- Signature and expiry notification intent
- Renewal linkage and supersession

### Transfer X1: approved apply

- Lock request and employee assignment
- Apply effective-dated HR change
- Write event, audit and downstream handoffs
- Mark workflow source transition through the existing outbox worker

### Offboarding F1: atomic start

- Case + package snapshot + tasks + handoffs + event + audit
- Duplicate active-case guard

### Offboarding F2: finalization and revocation

- Gate validation
- Employee/status history update + case completion + event + audit + Auth outbox
- Final-pay/access/PPE/roster completion or authorized waiver required

## 13. Frontend implementation pattern

Each module uses the same interaction contract:

1. Overview/list with server filtering, loading, empty, error and permission states.
2. Dedicated detail surface for records with lifecycle, tasks, discussion or handoffs.
3. Enterprise form modal/wizard for create and structured updates.
4. Action dialog for status transitions, decisions, waivers and destructive actions.
5. Timeline containing business events, audits, workflow, handoffs, messages and tickets.
6. Discussion button only on collaborative records.
7. Linked ticket panel only when tickets exist or the user can create a valid service ticket.
8. Actionable notification routes open the exact record.
9. Canonical standard/action/rich toast according to Section 6.

Do not put every capability on the overview. Overview pages support scanning and
queue work; detail pages support decisions and evidence.

## 14. API and permission requirements

- Every route remains POST-only and calls `requirePermission` before loading
  protected records.
- Detail routes enforce record scope, not only broad module permission.
- Employee self-service routes enforce `employee_id = actor.id` unless the actor has
  the explicit manage permission.
- Compensation, statutory, medical, identity and restricted documents use separate
  granular permissions.
- HR module navigation must not rely on the current four-role frontend type when the
  backend recognizes HR Staff and HR Manager roles. Resolve role visibility through
  capability or normalized role mapping.
- Ticket and discussion creation require both communications permission and view
  permission for the linked HR record.
- Handoff receivers run as service-role workers but validate contract type/version,
  source module, source entity and required payload fields.
- Public invite acceptance reveals one generic invalid/expired response and never
  discloses account existence.

## 15. E2E standard

Existing HR suites provide broad endpoint coverage but do not consistently prove
notifications, platform handoffs, discussions or tickets. Extend the current suites;
do not replace them with a single oversized HR suite.

Every mutation test must assert applicable rows exactly, not `>= 1`:

- Business row and status
- Satellite rows
- One business `app_events` row
- One module audit row
- Workflow instance and first tasks when required
- `handoff_outbox` contract rows when required
- Durable notification intent/notification rows for named recipients
- Target module record after handoff processing
- Source/target record link
- Ticket and ticket event when a ticket is the target work object
- No automatic message thread unless the test explicitly creates a discussion

Required negative/concurrency coverage:

- Unauthorized and out-of-scope access denied
- Illegal transition rejected with source unchanged
- Missing or malformed idempotency key rejected
- Same key/same input returns original result
- Same key/different input returns conflict
- Concurrent same operation creates one result and one side-effect set
- Forced satellite failure rolls back the database transaction
- Forced handoff delivery failure leaves committed source plus retryable outbox state
- External Auth failure leaves a recoverable provisioning command, not a fake active account
- Notification click opens the exact HR record
- Target module rejection/failure appears in the source case

Run static typechecks and `node --check` during implementation. Run each affected live
suite after its complete slice, then the full E2E suite once at the final gate.

## 16. Rollout order

1. Reconcile and finish active atomic HR conversions.
2. Notification navigation, HR role visibility and contract page registration.
3. Typed handoff contracts and target receivers.
4. Employee status/provisioning foundation.
5. Employee Master, Contracts, Organization and Documents UI completion.
6. Onboarding atomic start/lifecycle and full downstream integration.
7. Leave, Attendance, Roster and Overtime integration group.
8. Transfers, Promotions, Compensation and Statutory integration.
9. HR Requests completion.
10. Offboarding start-to-close implementation.
11. HR Work Queue and cross-module operational summaries.
12. Full E2E, security, accessibility and desktop visual regression gate.

Offboarding is deliberately late because it depends on access, payroll/final pay,
HSE/PPE, roster, documents, contracts and account provisioning.

## 17. Explicit exclusions

Do not add these in this program:

- Recruitment/ATS
- Performance reviews and goals
- Benefits administration
- Workforce forecasting
- Expense claims or budgeting inside HR
- Employee social feed
- AI recommendations or automatic HR decisions
- Decorative charts on transaction pages
- Automatic message threads for every record
- Tickets duplicating workflow tasks or native module records
- Claimed Microsoft 365/Google Workspace provisioning without a real connector
- Generic dynamic-SQL mutation RPCs
- Dual legacy/new mutation paths after cutover

## 18. Definition of done

An HR module is complete only when:

- Every visible command is backed by a real authorized API operation.
- Every lifecycle transition has a documented legal state and concurrency guard.
- Database-owned side effects commit atomically.
- External actions have durable retry/reconciliation state.
- Notifications open the exact record and use the correct recipient/dedupe policy.
- Discussions and tickets appear only where their ownership model applies.
- Cross-module work produces a real target record and source/target link.
- Loading, empty, error, permission, conflict, partial external failure and completed
  states are designed and implemented.
- The module's live E2E suite proves the record, event, audit, workflow, notification,
  handoff, target record and access-control contracts.
- Legacy mutation and manual handoff paths are deleted.
- No unresolved P0/P1 security, atomicity or data-loss finding remains.

