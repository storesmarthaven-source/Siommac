# HR Onboarding — full implementation reference

Everything that exists today (backend + frontend), verbatim from the live code, plus
the verified gap list. Written so another tool (Codex) can extend this module without
re-deriving conventions or conflicting with what's already built. Every claim below was
checked against the actual files in this repo, not assumed from a spec.

## Onboarding Command Centre — approved role-aware target (2026-08-01)

**Shared UI/widget reuse is a hard requirement.** The Command Centre KPI row must use the
same `@ui` `KpiTile` design and widget-board composition used by Employee Master, including
its icon chip, type scale, supporting line, drill action and matching skeleton shape. Only
the onboarding labels, values, tones and drill filters change. Do not introduce a parallel
`.summary-card` production component.

The mockup's Upcoming Deadlines and Tasks cards are references to existing registered
widgets, not new onboarding widgets:

- `enterprise.calendar.upcomingDeadlines`
- `enterprise.calendar.taskPlanner`

Install/render those definitions through `@ui/widgets` and configure their authorised
module scope for onboarding. Reuse their current loading, empty, error, permission and
interaction behaviour. If onboarding needs another filter, extend the shared widget's
configuration/data adapter at the source; do not fork its JSX or stylesheet.

**Scope permissions:** use `hr.onboarding.view_team` and
`hr.onboarding.view_all` (not `hr.onboarding.team.view` / `hr.onboarding.all.view`).
The base `hr.onboarding.view` request is own/assigned/participant scoped. Grant both new
scope keys to `hr_manager` and `admin`; `superadmin` receives them from the complete
catalogue. Do not grant them to `hr_staff` or generic `manager`. A generic line manager may
see only cases/work made visible through an explicit participant, task, handoff or
direct-report policy implemented server-side; role name alone never unlocks the HR team or
organisation scopes.

The authoritative visual reference is
`docs/mockups/onboarding-command-centre-core.html`. It is one permission-aware operating
surface, not separate staff and manager dashboards and not a manager-only page.

- **HR staff** default to **My Work**. Counts, deadlines, Upcoming Starts, Case Focus and
  the queue are limited to cases they own, work assigned to them, and cases they are
  authorised to coordinate. Team and all-onboarding scopes are hidden unless separately
  permitted. Staff can complete or coordinate permitted work but cannot perform
  manager-only reassignment, override, waiver, cancellation, package-management or
  unrestricted export actions.
- **HR managers** default to **My Work**, exactly like every other actor, and may explicitly
  widen to authorised team/all scopes,
  department and owner filters, workload routing, escalation, reassignment and governed
  oversight actions. Elevated actions remain independently permission-gated; the role
  label alone never grants them.
- Every summary, chart and list consumes the same server-returned scope. The frontend
  must not fetch all records and hide unauthorised rows after the fact.
- Keep **Upcoming Starts**. It is forward-looking cohort readiness and must not be
  renamed to My Work, which would duplicate both the scope selector and work queue. For
  staff it shows owned/coordinated starts; for managers it shows the permitted team
  cohort.
- The Team Work Queue becomes **My Work Queue** when staff scope is active, with the
  description and empty state changing accordingly. The underlying component and
  endpoint remain shared.
- The Work Queue drawer is a quick context surface, not a duplicate Case Detail page. It
  shows the employee, case, owning queue, accountable person, department, due state and
  status, with evidence approve/return only when that row and permission allow it. Complex
  work uses **Open in Case Detail**. It deliberately has no second tab system or history feed.
  Evidence exposes only authorised document metadata and review actions; Activity is
  the immutable operational history. The footer provides Open Full Case, Notify Owner
  and Complete Review. Reassign and escalation remain independently capability-gated
  and are not rendered for HR staff without those permissions.
- Complete Review is a real mutation contract, not a presentation-only dialog. It must
  require an outcome and reviewer confirmation, update the work item, recalculate case
  readiness, and write the required app event, audit log, workflow/notification and
  handoff side effects under one correlation ID before the UI reports success.
- Loading uses the shared skeleton and preserves the previous record until the newly
  selected scope or work item is ready. Never flash manager data while staff scope is
  resolving.

## Start Onboarding — approved implementation target (2026-07-30)

The authoritative visual reference is:
`docs/mockups/onboarding-start-implementation-ready.html`.

Claude must reproduce that mockup without adding extra wizard steps or restoring the
legacy modal composition. The approved workflow has **five steps**:

1. **Employee & Timing** — search Employee Master by employee name, employee number or
   work email and select one canonical employee record. Store its `employeeId`; do not
   copy the person into a second onboarding record. After selection, load worker
   category, employment type, department and role from the employee's current
   assignment and show them in a labelled read-only facts panel. These facts determine
   package eligibility and cannot be overridden here. Capture only onboarding-specific
   context: reason, target start date, priority and accountable case owner.
2. **Package** — return only active packages compatible with the employee's recorded
   worker type, department, site and role. Show the selected version, lead time and a
   concise read-only **What SIOMAC Will Create** summary covering required work, owners
   and Day-One gates. Required tasks and handoffs are package outputs, not separate
   wizard steps.
3. **Optional Work** — add approved extras from the selected package's action library.
   Managers may create a one-off case action without changing the reusable package.
   Ownership appears only when SIOMAC cannot resolve an accountable person. Every work
   item still has an owning team/queue; optional unassigned work may remain visibly
   queued, while required owner failures block launch.
4. **Documents** — one explicit decision per requirement: use existing, upload now,
   request from employee, or waive. Missing evidence creates governed follow-up work;
   package activation gates decide whether it blocks Day One. Waiver requires a dedicated
   elevated permission, reason and audit record; `hr.onboarding.start` is insufficient.
5. **Review & Launch** — one concise frozen-plan summary, accountable owners, document
   follow-ups and structural launch checks. The launch action appears here, not as a
   premature page-level action throughout the wizard.

### Required frontend behaviour

- Use the SIOMAC `WizardShell` / `Stepper`, shared form controls and page skeleton.
- The right-hand `WizardSummaryRail` must reuse the existing production onboarding
  wizard's status-rail composition and tokens: navy Case Preview kicker/identity hero,
  plain employee photo, Employee Master identity hierarchy, four white preview facts,
  Worker Verification, Duplicate Check, Required Documents and Generated Summary cards.
  Do not show a readiness ring or readiness score in the wizard summary. Adapt the datasets to this
  five-step contract; do not restyle it from the Employee Profile drawer or invent a
  third summary-rail pattern. On smaller viewports it moves below the main form.
- Duplicate status is shown only in the right-rail Duplicate Check card. Do not repeat a
  second success banner in Step 1; launch still revalidates the duplicate rule server-side.
- Reuse the UI kit's `PersonSearchSelect` for employee lookup; do not build a parallel
  search field or add a submit/search button. Results filter while the user types and
  show the profile photo (initials only when no photo exists), name, employee number,
  role and department. The control supports debounced async search, keyboard navigation,
  loading skeleton, no-results, error, selected and change-selection states.
- Selecting an employee fetches the canonical profile facts before Package unlocks.
  **Review in Employee Master** opens that employee's Employment tab. If the person does
  not exist, **Create Employee Record** opens Employee Master's existing create flow and
  returns the new `employeeId` to this wizard; onboarding must not create a shadow person.
- Load employee, compatible packages, intake preview, document requirements and owner
  preflight through authenticated Netlify APIs. Never query Supabase directly.
- Keep the previous step visible until the next step's required data is ready; do not
  flash partial cards or replace the whole page with a spinner.
- Loading, empty and error states are independent for employee search, packages, plan
  preview, documents and ownership routing.
- Form labels are at least 13px and normal body copy at least 14px. Do not port the
  legacy 8.5–11px typography.
- Package-generated required work is read-only. Only optional actions and authorised
  ownership exceptions are interactive.
- Do not show Save Draft or Scheduled Launch until the corresponding backend lifecycle
  is implemented and live-tested.

### Required backend additions before parity can be claimed

1. **Atomic launch command.** One transaction must create the case, frozen package
   snapshot, tasks with due dates, handoffs, document requests, selected case actions,
   app events, both audit records and participant notifications. Remove manual
   delete-compensation and best-effort custom-action creation.
2. **Request-scoped idempotency.** Use a stable intake/draft request id. The current
   employee+package key is not valid because the same employee can legitimately use the
   same package again for a later rehire or transfer.
3. **Frozen package contract.** Store package id, version and the generated launch
   snapshot. `package_key` alone does not preserve the approved plan.
4. **Compatibility resolver.** Validate worker type, department, site and role on the
   server. The frontend must consume the resolver result, not recreate it.
5. **Owner/account preflight.** Add `hr/onboarding/account-preflight` (or one combined
   intake-preflight contract) returning owning team, accountable person, fallback queue,
   access profile, proposed work email, invitation method/timing and blocking
   configuration errors.
6. **Task schedule generation.** Apply template due rules relative to launch, target
   start date, dependencies and Day-One milestones so portfolio deadlines are real.
7. **Dedicated document-waiver authority.** Add a narrow permission and validate it
   server-side with mandatory reason, actor and audit state.
8. **Settings convergence.** Either wire or remove the currently declarative draft,
   scheduled-launch, welcome-email, supervisor-notification, credential-method and
   auto-provision settings. Do not expose accepted inputs that are not honoured.

### Step 2 audit — Package

The current mockup has the correct broad structure—compatible package choices followed
by a read-only **What SIOMAC Will Create** summary—but the live contract does not yet
justify calling the results compatible.

**Keep**

- A small set of selectable package cards, one recommended option, version, lead time,
  task count and handoff count.
- A **What SIOMAC Will Create** summary directly below the selection. Required work is
  package output, not another set of wizard choices.
- A permission-gated **Manage Packages** link for package administrators only.

**Improve**

- Explain the match using the selected employee's actual facts: worker category,
  employment type, department, site and role.
- Show only active packages. Draft and retired packages never appear in the launch
  wizard.
- Replace a hard-coded “recommended” package-key rule with a server-returned match rank
  and concise reasons such as “Permanent employee · Administration · Project Manager”.
- Give each package one concise distinction—standard, safety-critical, contractor,
  manager, or site-specific—rather than repeating generic descriptions.
- Summarise the generated plan by operational area (HR, IT/Access, HSE, Payroll,
  Training), blocking gates, required documents and unresolved owners. Do not dump every
  task into the selection card.
- Provide independent loading, error and no-match states. A no-match state directs an
  authorised manager to Package Manager; normal HR staff see a clear escalation path,
  not a dead administration button.

**Remove**

- Any package the server has not approved for this employee.
- Client-side compatibility claims based only on `workerTypes`.
- Editable required tasks, handoffs or document rules in the wizard.
- Duplicate versioning explanations inside every package card; show one concise policy
  note after selection.

**Verified implementation gaps**

- `/onboarding/packages/list` currently returns every non-retired package, including
  drafts, and accepts no employee context.
- `OnboardingPackageSummary` omits department and site applicability even though Package
  Detail stores those rules.
- The wizard filters only `workerTypes`; it ignores department and site, and there is no
  role/employment-type applicability contract.
- `loadPackagePlan` and the launch command reject retired packages but still accept a
  draft package.
- The launch command validates only worker type. A direct request can bypass any
  department/site rule shown by the UI.
- The recommendation is currently a client-side package-key convention rather than a
  server-owned match result.
- Intake preview does not return the match decision or match reasons, so the UI cannot
  explain why a package is eligible.

Claude must close these at the source with one authenticated compatibility/read-model
contract used by package selection, preview and launch validation. Do not build a second
client-only rules engine.

### Step 3 audit - Optional Work

Step 3 is not a second package builder. Its only purpose is to let HR add genuinely
optional work and resolve ownership exceptions that the selected package could not
resolve automatically. Required package work stays read-only. Account provisioning is
not performed in this step; the step only previews who will own that work and whether
the organisation's account policy can be executed.

**Approved user flow**

1. Start with the optional actions already selected for this case and a clear
   **Add Optional Action** button. The button opens the approved action library for the
   selected package. Search and filtering operate against the server-returned template
   list; the wizard must not hard-code the production library.
2. Each action row states what it creates (task, handoff, approval, document request,
   training request or notification), its owning team and whether it blocks Day One.
   Required actions are not repeated because they were already accepted with the package.
3. Actors with `hr.onboarding.custom_actions.create` additionally see
   **Create One-Off Action**. It creates case-specific work only and must not silently
   add or change a reusable action template.
4. Show an **Ownership exception** section only when a selected action has an unresolved
   route. Hide the entire section once all visible actions resolve; do not show an empty
   success container.
5. Selecting **Assign person** opens one focused dialog. Team/queue is selected first and is
   always required. The accountable person is selected second from capability-eligible
   members of that team. A non-blocking optional item may remain visibly unassigned in
   its queue; a required item may not launch without the ownership required by policy.
6. Show a compact **Account setup policy** preview only when the package includes
   account/access work. It displays the operating model, owning team, accountable person,
   access profile, proposed work email and invitation timing. It is read-only here.
   Provisioning happens from the case after launch or automatically when a live,
   authorised setting says so.

**Keep**

- Optional package action selection.
- A searchable approved-action library rather than exposing every option in the page.
- A manager-only one-off action flow for genuinely exceptional case work.
- The team/queue plus accountable-person ownership model.
- A visible unresolved state and a direct assignment action.
- A read-only account-policy preview for packages that include account/access work.
- One clear warning that distinguishes a launch blocker from follow-up work.

**Improve**

- Replace the current mixed required/optional checklist with accessible checkbox rows
  for optional work only. Show a selected count and preserve keyboard operation.
- Show the action's operational result, not an internal action-type code.
- Resolve owners server-side and label the source: package default, organisation policy,
  manager override or fallback queue.
- Collapse successfully resolved owners into a short summary. Keep attention on the
  exceptions HR must act on.
- Make the assignment dialog capability-aware and permission-gated. HR staff may view
  routing and select permitted optional work; only an authorised manager may override
  a package or organisation-level route.
- Revalidate action availability, package membership, ownership and account policy when
  the case launches. A stale wizard preview is never authority.

**Remove**

- The required **Manager welcome call** from the selectable action list. Required work
  belongs to the frozen package preview.
- The full list of already-resolved handoffs. It duplicates Step 2 and makes the user
  hunt for the one exception.
- Editable account provisioning controls from the wizard. This step must not create a
  login, mailbox or invitation.
- Any generic success message that says ownership is resolved without identifying the
  team, accountable person and source of that resolution.
- A second free-text "Case Owner" concept. The case coordinator must be a real user id;
  operational work ownership is represented separately by queue and assignee.

**Verified backend gaps**

- There is no `/onboarding/account-preflight` endpoint. The operating model, team,
  accountable person, access profile, proposed email and invitation timing displayed by
  the mockup currently have no single authoritative read contract.
- `owner_department_id` is stored on action templates but is discarded by
  `specFromTemplate()` and never used by `instantiate()`. The current backend therefore
  cannot honour the department/queue ownership shown by Step 3.
- The launch route accepts arbitrary `includeActionTemplateIds`. `addCaseAction()` looks
  up each id but does not prove that the template is active or belongs to the selected
  package. A direct request can attach another package's action.
- Required action templates are enforced only by a disabled frontend checkbox. The
  backend does not add the package's required actions independently, so a direct request
  can omit them.
- Selected actions are created after the case transaction. Each failure is caught,
  logged and dropped while the launch still returns success. This is a prohibited
  accept-and-drop path.
- The launch contract accepts only `includeActionTemplateIds`. It cannot carry a
  case-specific one-off action, even though `actions/case/add` supports one after a case
  exists. Add a typed `oneOffActions` launch input gated by
  `hr.onboarding.custom_actions.create`, validate its owning queue and operational result,
  and create it inside the same launch transaction. Do not launch first and call
  `actions/case/add` afterward.
- `instantiate()` creates a task, handoff or workflow before inserting the matching
  `hr_onboarding_case_actions` row. If that final insert fails, the generated work is
  orphaned. Selected actions must join the atomic launch transaction.
- Action due dates are calculated from the server's current date rather than the case
  launch date, target start date or generated milestone schedule.
- `require_owner_on_start` is not an effective fail-closed control. The code defaults
  the owner to the actor, while the wizard separately sends the display string
  `"HR Operations"` as `caseOwner`. A truthy label can satisfy the check even though it
  is not a user id.
- `account_default_credential_method` and
  `auto_provision_account_on_start` exist in Settings but are not consumed by the start
  command. The account service currently implements the invite-link path only.
- Account provisioning can create Auth, update the employee, revoke/create invites and
  create an IT handoff through separate writes. That existing command must be made
  atomic before automatic provisioning is enabled.

**Required backend contract**

Add one authenticated Step 3 preflight response rather than separate client-side rules.
For each work item it returns:

- action/template id, label, action outcome, required/optional and launch-blocking state;
- owning team/queue id and label;
- accountable user id, name and photo when resolved;
- resolution source and whether the current actor may override it;
- unresolved reason, fallback queue and `launchBlocking`;
- for account work: operating model, access profile, proposed work email, credential
  method, invitation timing and provisioning authority.

The launch command must consume the same resolver, reject foreign/inactive template ids,
add required templates itself, and commit selected actions plus all generated work and
side effects in the same transaction as the case.

**Step 3 acceptance gate**

- HR staff and managers see only the actions and override controls their capabilities
  allow.
- A required unresolved owner blocks launch with an actionable message; an optional
  unassigned action remains in a named queue.
- A selected action cannot disappear while the case still returns success.
- Direct requests cannot omit required actions or attach an action from another package.
- Queue, assignee, due date and account policy shown in Step 3 exactly match the frozen
  case created at launch.
- Live E2E covers HR-managed and IT/Admin-managed account ownership, no-IT fallback,
  foreign/inactive action rejection, required-action enforcement, unresolved ownership,
  authorised override and rollback on child-write/side-effect failure.

### Step 4 audit - Documents

Step 4 is a decision surface, not a second document register. It shows only requirements
that apply to the selected employee and frozen package. Verified Employee Master records
are reused automatically and collapsed under **Ready documents**. Missing, expired or
unverified requirements appear under **Needs action** with their launch and Day-One
impact stated plainly.

**Approved user flow**

1. Show a compact summary: required, ready and needs-action counts.
2. Collapse verified reusable records. Expanding the group shows document type, verified
   state and expiry date; there is no redundant action control.
3. For every unresolved requirement, show why it applies, its current state, whether it
   blocks case launch and whether it may block Day-One readiness.
4. Require one explicit disposition:
   - **Upload document now** — signed upload, malware/type/size checks, document commit,
     then link the committed Employee Master document to the requirement.
   - **Request from employee** — confirm recipient and due date, then create a scoped,
     single-use upload request and participant notification at launch.
   - **Use eligible existing document** — available only for a server-validated document
     belonging to the employee and matching the required type.
   - **Authorised waiver** — shown only when the requirement permits it and the actor has
     `hr.onboarding.documents.waive`; reason is mandatory.
5. Keep the launch-impact statement beside the decision. A follow-up requirement may
   continue into the case; a launch-blocking requirement keeps Continue disabled until
   verified evidence or an authorised waiver exists.

**Verified backend gaps**

- `uploadedFilePath` is accepted by the launch schema but is never read by
  `createOnboardingDocumentRequests()`. The row is labelled `uploaded` with
  `document_id = null`; no Employee Master document is committed or linked. This is an
  accept-and-drop defect.
- There is no intake-document upload URL/commit contract. The task-evidence upload route
  belongs to an existing task and cannot be repurposed before a case exists.
- `use_existing` trusts the submitted `existingDocumentId`. Launch does not prove the
  document belongs to the selected employee, matches the required type, is visible to
  the actor, or remains valid.
- The start endpoint is gated only by `hr.onboarding.start`. Any caller can submit
  `action: "waive"`; launch validation treats it as satisfied without checking
  `canWaive`, elevated permission or a non-empty reason.
- A `present_unverified` document currently satisfies a launch-blocking requirement.
  Blocking evidence must meet the requirement's verified/valid rule rather than merely
  exist.
- The backend does not require one disposition per unresolved requirement. Missing
  selections silently become pending requests.
- `request_from_worker` inserts a pending request row but does not atomically create the
  secure employee upload token, due-date work, targeted notification and delivery
  record represented by the UI.
- Intake classifies only missing/expired/unverified. It does not compare expiry against
  the target start date, so a document valid today but expiring before Day One can appear
  ready.
- Document-request rows are inserted through compensating cleanup rather than the same
  database transaction as the case, tasks, handoffs, events and notifications.

**Required backend contract**

Extend the authenticated intake preflight with a per-requirement decision contract:
eligible existing document ids, verification/expiry state, launch impact, Day-One impact,
allowed dispositions, `canWaive`, request recipient and a server-derived recommended due
date. Add a pre-launch signed upload/commit flow that creates a real Employee Master
document before its id can be selected.

The atomic launch command must re-resolve every requirement and validate every submitted
decision. It must reject foreign/stale documents, ignored upload paths, unauthorised
waivers, blank waiver reasons and unresolved launch blockers. Employee requests must
commit their request row, scoped token, due work, notification, delivery signal, event
and audits with the case under one idempotency key.

**Step 4 acceptance gate**

- Ready counts cannot reveal restricted document records and reconcile with the visible,
  authorised requirement set.
- Uploaded evidence produces a real linked document; no `uploaded` request may have a
  null document id.
- Foreign, mismatched, expired and unverified documents cannot satisfy a blocking gate.
- Waiver denial and approval are tested separately, including `canWaive`, permission,
  reason and audit state.
- Employee request delivery, token scope, expiry, due work and notification are proven
  through live E2E.
- Expiry before the target start date changes the decision state before launch.
- Any document child or side-effect failure rolls the whole launch back.

### Step 5 audit - Review & Launch

Step 5 is the final decision surface, not another onboarding dashboard. It must not
repeat the employee profile, intake facts or document register already visible in the
summary rail and earlier steps.

**Approved user flow**

1. Re-run an authoritative server preflight when Review opens and immediately before
   launch. Show one plain **Ready to launch** or **Launch blocked** banner from that
   result; never derive it from browser-held counts.
2. Show the frozen launch plan: package version, required tasks, team handoffs, optional
   actions, document decisions and account-setup policy. Counts must reconcile with the
   records the launch command will create.
3. Promote only unresolved, non-blocking follow-ups. Each shows the requirement, action,
   accountable queue/person and due date, with a link back to its wizard step.
4. Keep passed technical checks collapsed. They are useful for inspection but should not
   compete with the launch decision.
5. Launch once. Disable the action while the request is pending, route any validation
   error back to its owning step and show success only after the authoritative command
   returns.
6. Do not add a second confirmation modal. Review & Launch is already the confirmation
   step.

**Verified backend gaps**

- There is no final preflight contract shared by Review and Launch. The UI can therefore
  display a ready state that the launch route later rejects, or remain stale after source
  data changes.
- The launch idempotency key is based on `employeeId:packageKey`. That blocks a legitimate
  later onboarding cycle for the same employee and package instead of deduplicating only
  a repeated intake request.
- The selected package id, published version and generated policy snapshot are not frozen
  as one immutable launch input. A package edit between preview and launch can change the
  created work.
- Generated tasks do not receive real due dates from the target start date and package
  timing rules.
- Launch performs sequential writes with compensating deletes. Child-action errors can be
  swallowed, and handoff events are emitted after the primary result rather than inside
  the same transaction.
- Notifications, delivery signals and handoff outbox rows are not committed atomically
  with the case.
- `caseOwner` can be submitted as a display label even though downstream ownership needs
  a stable user id or queue id.
- Document, one-off-action and account-provisioning gaps from Steps 3 and 4 remain launch
  defects until they are part of the same command.

**Required backend contract**

Add an authenticated final preflight that returns `ready`, structural blockers,
non-blocking follow-ups, frozen package id/version, exact generated counts, resolved
owner ids and labels, document decisions, account policy and `validatedAt`. The launch
command must invoke the same resolver again and consume a stable, client-generated
`intakeRequestId`; it must not trust the preview response as authority.

One transaction must create the case, immutable package snapshot, dated tasks, team
handoffs/outbox, document links and requests, optional and one-off actions, account
provisioning intent, `app_events`, `audit_logs`, HR audit, workflow tasks, notifications
and delivery signals. Any required write or side-effect failure rolls back everything.

**Step 5 acceptance gate**

- A retry with the same `intakeRequestId` returns the same case and creates no duplicates.
- A later legitimate onboarding cycle for the same employee and package is allowed.
- Stale package versions, foreign records and unresolved ownership are rejected.
- Preview counts, launch response counts and committed rows reconcile exactly.
- An injected failure at every child-write boundary leaves no case or side effects.
- Employee follow-up notification, scoped token and delivery state are proven live.
- The UI reports success only after all required records and side effects commit.

### Launch blockers

Structural blockers are: active duplicate case, missing/invalid package, incompatible
package, unresolved required owner/queue, invalid start timing, or failed account-policy
preflight. Missing documents normally create tracked work; they block activation only
when the frozen package marks them as activation gates.

### Permission split

- `hr.onboarding.start` — prepare and launch a permitted case.
- `hr.onboarding.packages.manage` — maintain organisation-wide package policy.
- `hr.onboarding.documents.waive` — elevated evidence waiver with reason.
- `hr.onboarding.provision_account` — perform eligible account provisioning.

HR staff may start and coordinate a case without automatically receiving package-policy,
document-waiver or account-administration authority.

### Completion gate

Implementation is not complete until live E2E proves:

- compatible-package filtering and backend rejection of an incompatible direct request;
- duplicate and unresolved-required-owner rejection;
- atomic rollback when any generated child/side effect fails;
- safe idempotent retry and a later legitimate second cycle;
- package version/snapshot immutability;
- correct dated tasks, queues, assignees and document requests;
- waiver permission denial/approval with audit;
- account preflight for HR-managed and IT/Admin-managed organisations;
- exact side effects: `app_events`, `audit_logs`, HR audit, notifications, workflow tasks
  and handoff/outbox rows.

## 0. Non-negotiable conventions — read this before writing any code

Get these wrong and new code will not integrate with what exists:

1. **Response envelope**: every route returns `c.json({ success: true, data })` or
   `c.json({ success: false, message }, statusCode as 200)`. Never `{ ok: true }`.
2. **Request envelope**: the frontend's `apiPost` wraps the body as `{ args: payload }`.
   Every route reads `const body = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};`
   then validates with Zod (`zv(c, Schema, body(c))`). Reading the raw body breaks the route.
3. **Auth/permission**: `const actor = await requirePermission(c, 'permission.key');` —
   ONE call, takes the Hono context directly, returns the actor (`{ id, role, ... }`).
   There is no separate `requireAuth` step. Read-only endpoints that don't need an actor
   use `await requirePermission(c, 'key');` without capturing the return value, or
   `await requireUser(c)` when there's no specific permission (e.g. "assignee can act on
   their own task").
4. **camelCase contract**: `types/hrOnboarding.ts` is the ONE shared DTO shape, imported
   by both backend (`netlify/functions/lib/hr/onboardingQueries.ts` et al.) and frontend
   (`src/api/hr/onboarding.ts`). All fields are camelCase (`caseId`, `employeeId`,
   `progressPercent`). Backend service files map snake_case DB columns → camelCase DTOs
   at the query boundary; nothing downstream ever sees snake_case. Never add a
   per-endpoint mapper or a second aliased shape.
5. **`app_users.id` is TEXT, not UUID.** Every user-referencing column/FK is `text
   references app_users(id)`. Every other primary key in this module is
   `uuid default gen_random_uuid()`.
6. **No URL router for this module.** HR's two sections (Employee Master, Onboarding)
   are switched by `HRSection.tsx` listening for a `siomac:section` window event +
   `localStorage['siomac_hr_section']`. Within Onboarding, drill-ins (case detail,
   package manager, package detail) are plain conditional-render state
   (`useState<string|null>`) in the parent component — not routes, no URL params, not
   deep-linkable today (see Gap #15).
7. **Board for the dashboard; a fixed tab shell for the case.** (Corrected 2026-08-03 —
   this item previously said Case Detail was a board and "NOT a tabbed page", which is
   wrong and contradicts the approved mockup.)
   - **Command Centre is a WidgetBoard dashboard** — an `@ui/widgets` `WidgetBoard`
     (drag/resize grid, `WidgetLibraryModal` to add/remove widgets, layout persisted
     server-side per `pageKey` in `ui_layout`).
   - **Case Detail is a permanent SEVEN-TAB operating shell** — Overview · Tasks ·
     Handoffs · Blockers · Communications · Timeline · Audit. The six operational tabs are
     permanent workspaces: they are not widgets, are not offered by the Widget Library and
     cannot be removed or reordered. `Audit` is gated on `hr.onboarding.audit.view` and is
     absent, not disabled, without it.
   - **Only Case Detail's Overview tab contains a customizable WidgetBoard**, whose default
     layout is the four approved widgets (Priority Tasks, Activation Readiness, Readiness
     by Domain, Key Blockers — see "Case Detail focus pass").

   Authority: `docs/mockups/onboarding-case-detail-implementation-ready.html` and
   `docs/ONBOARDING_UI_PAGES_SPEC.md` §2.

   Package Manager / Package Detail, by contrast, are plain CRUD screens (table + modal
   forms) — no widget board, because they're admin configuration, not a dashboard.
8. **Mutation side-effects**: every mutation that changes state calls, in order:
   the DB write → `emitAppEvent({...})` (fire-and-forget `void`, except audit writes
   which are awaited) → `writeHrAudit({...})` (from `netlify/functions/lib/hr/employeeCore.ts`,
   THROWS on failure — a failed audit fails the mutation, never swallowed).
9. **Idempotent creates** (case start) go through `runModuleMutation` (`netlify/functions/lib/moduleServiceAdapter.ts`)
   with a content-derived `idempotencyKey`. Status-transition mutations (pause/resume/
   complete/cancel/block/unblock/reassign) do NOT use `runModuleMutation` — they're
   direct row updates with the error checked, an event, and an audit row. Forcing a
   transition through `runModuleMutation` would be ceremony.
10. **Settings**: read via `resolveSettingValue(sb, 'hr_onboarding.<key>', { moduleKey: 'hr_onboarding' }, fallbackValue)`
    (`netlify/functions/lib/settings/resolveSetting.ts`) — it returns the fallback if the
    catalog isn't synced/set yet, so behavior never breaks on a missing row.
11. **Testing cadence**: `tsc --noEmit` while iterating; full jest/vitest/E2E suite once
    at the end. New endpoints/flows need coverage added to
    `scripts/e2e/suites/` (see `communications.mjs` as the reference suite shape).

---

## 1. Database schema (all tables, real columns, as actually migrated)

### `hr_onboarding_cases` (`20260709000000`, extended `20260714000000`, `20260710000001`)
```sql
id             uuid primary key default gen_random_uuid()
case_no        text unique not null              -- generated via nextRef(prefix), e.g. "ONB-2026-0053"
employee_id    text references app_users(id) on delete cascade
worker_type    text                              -- 'employee' | 'contractor' | free text
package_key    text not null                     -- FK-by-value to hr_onboarding_packages.package_key
status         text not null default 'in_progress'
               check (status in ('draft','open','in_progress','blocked','paused',
                                  'ready_for_activation','completed','cancelled'))
owner_id       text references app_users(id) on delete set null
due_at         timestamptz
started_by     text references app_users(id) on delete set null
started_at     timestamptz not null default now()
completed_at   timestamptz
paused_at      timestamptz
cancelled_by   text references app_users(id) on delete set null
cancelled_at   timestamptz
reason         text                              -- 'new_hire' | 'transfer' | ... (intake, v36 §10)
priority       text
target_start_date date
launch_mode    text
case_owner     text
metadata       jsonb not null default '{}'
created_at     timestamptz not null default now()
updated_at     timestamptz  -- via trg_hr_onboarding_cases_updated_at
```
Index: `(employee_id, status)`.

### `hr_onboarding_tasks` (`20260709000000`, extended `20260714000000`)
```sql
id                uuid primary key default gen_random_uuid()
case_id           uuid not null references hr_onboarding_cases(id) on delete cascade
task_key          text not null
task_title        text not null
owner_role        text                            -- 'hr' | 'supervisor' | 'it' | 'hse' | 'training' | 'payroll' | ...
assigned_to       text references app_users(id) on delete set null
module_key        text                            -- categorization hint (see onboardingTaskCategory.ts)
status            text not null default 'pending'
                  check (status in ('pending','open','in_progress','blocked','completed','skipped','cancelled'))
due_at            timestamptz
completed_by      text references app_users(id) on delete set null
completed_at      timestamptz
is_blocking       boolean not null default false
requires_evidence boolean not null default false
dependency_keys   jsonb not null default '[]'
sort_order        int not null default 0
priority          text
blocked_reason    text
metadata          jsonb not null default '{}'
created_at        timestamptz not null default now()
updated_at        timestamptz
```
Index: `(case_id, status)`.

### `hr_onboarding_handoffs` (`20260709000000`, extended `20260714000000`)
```sql
id             uuid primary key default gen_random_uuid()
case_id        uuid not null references hr_onboarding_cases(id) on delete cascade
target_module  text not null                     -- 'hr' | 'it' | 'hse' | 'training' | 'payroll' | ...
handoff_type   text
handoff_key    text
status         text not null default 'pending'
               check (status in ('pending','sent','accepted','blocked','delivered','completed','failed','cancelled'))
owner_id       text references app_users(id) on delete set null
payload        jsonb not null default '{}'
accepted_at    timestamptz
completed_at   timestamptz
failure_reason text
last_event_at  timestamptz
created_at     timestamptz not null default now()
updated_at     timestamptz
```
Index: `(case_id)`. **No retry/accept/complete mutation exists yet — see Gap #2.**
Delivery to target modules (HSE/Training/Payroll receivers) is intentionally NOT built;
handoffs are recorded `pending` and never faked as delivered.

### `hr_onboarding_blockers` (`20260714000000`)
```sql
id              uuid primary key default gen_random_uuid()
case_id         uuid not null references hr_onboarding_cases(id) on delete cascade
task_id         uuid references hr_onboarding_tasks(id) on delete set null
handoff_id      uuid references hr_onboarding_handoffs(id) on delete set null
blocker_key     text not null
blocker_title   text not null
blocking_module text not null
severity        text not null default 'medium' check (severity in ('low','medium','high','critical'))
status          text not null default 'active'
                check (status in ('active','acknowledged','waiting_on_owner','escalated','resolved','waived'))
owner_id        text references app_users(id) on delete set null
due_at          timestamptz
resolved_by     text references app_users(id) on delete set null
resolved_at     timestamptz
waiver_reason   text
metadata        jsonb not null default '{}'
created_at      timestamptz not null default now()
updated_at      timestamptz
```
Index: `(case_id, status)`. No `notify_owner` action exists (Resolve/Escalate/Waive only
— see Gap #14).

### `hr_onboarding_packages` (`20260714000002`)
```sql
id                     uuid primary key default gen_random_uuid()
package_key            text unique not null       -- auto-slugified from label at create, immutable after
package_name           text not null
description            text
worker_types           jsonb not null default '[]'
default_sla_days       int not null default 10
default_owner_role     text
applies_to_departments jsonb not null default '[]'
applies_to_sites       jsonb not null default '[]'
status                 text not null default 'draft' check (status in ('draft','active','retired'))
version_no             int not null default 1
metadata               jsonb not null default '{}'
created_by             text references app_users(id) on delete set null
created_at             timestamptz not null default now()
updated_by             text references app_users(id) on delete set null
updated_at             timestamptz
```

### `hr_onboarding_task_templates` (`20260714000002`)
```sql
id                uuid primary key default gen_random_uuid()
package_id        uuid not null references hr_onboarding_packages(id) on delete cascade
task_key          text not null
task_title        text not null
owner_role        text not null
module_key        text
due_rule          jsonb not null default '{}'
is_required       boolean not null default true
is_blocking       boolean not null default false
requires_evidence boolean not null default false
dependency_keys   jsonb not null default '[]'
sort_order        int not null default 0
metadata          jsonb not null default '{}'
created_at        timestamptz not null default now()
unique (package_id, task_key)
```
**Real DELETE, no soft-delete column** — safe because case-start reads templates once,
at start time; a deleted template never affects an already-started case.

### `hr_onboarding_handoff_templates` (`20260714000002`)
```sql
id               uuid primary key default gen_random_uuid()
package_id       uuid not null references hr_onboarding_packages(id) on delete cascade
handoff_key      text not null
target_module    text not null
handoff_type     text not null
trigger_rule     jsonb not null default '{}'
payload_template jsonb not null default '{}'
is_required      boolean not null default true
sort_order       int not null default 0
metadata         jsonb not null default '{}'
created_at       timestamptz not null default now()
unique (package_id, handoff_key)
```
Same real-DELETE reasoning as task templates.

### `hr_onboarding_action_templates` (`20260714000004`) — Custom Onboarding Actions
```sql
id                       uuid primary key default gen_random_uuid()
package_id               uuid not null references hr_onboarding_packages(id) on delete cascade
action_name              text not null
action_type              text not null check (action_type in (
                           'custom_task','custom_handoff','custom_document_request',
                           'custom_training_request','custom_approval','custom_notification',
                           'custom_checklist_item','custom_external_action'))
description              text
instructions             text
owner_type               text not null default 'role' check (owner_type in ('role','employee','department','system','external'))
owner_role               text
owner_employee_id        text references app_users(id) on delete set null
owner_department_id      uuid                     -- soft ref, no FK (avoids coupling)
due_offset_days          int
priority                 text not null default 'normal' check (priority in ('low','normal','high','critical'))
is_required              boolean not null default true
is_active                boolean not null default true   -- HAS soft-delete (retire), unlike task/handoff templates
blocks_onboarding        boolean not null default false
requires_evidence        boolean not null default false
document_type_id         uuid                     -- soft ref (documents subsystem not built)
training_requirement_id  uuid                     -- soft ref (training subsystem not built)
workflow_template_id     uuid references workflow_templates(id) on delete set null
notification_template_id uuid                     -- soft ref
external_system_key      text
external_action_url      text
display_order            int not null default 100
created_by / updated_by / retired_by   text references app_users(id) on delete set null
created_at / updated_at / retired_at   timestamptz
```
Index: `(package_id, is_active)`. **No Duplicate action, no explicit reorder UI — see
Gaps #13.**

### `hr_onboarding_case_actions` (`20260714000004`)
```sql
id                          uuid primary key default gen_random_uuid()
case_id                     uuid not null references hr_onboarding_cases(id) on delete cascade
source_template_id          uuid references hr_onboarding_action_templates(id) on delete set null
action_name                 text not null
action_type                 text not null
status                      text not null default 'open' check (status in ('open','in_progress','completed','cancelled','blocked'))
linked_task_id              uuid references hr_onboarding_tasks(id) on delete set null
linked_handoff_id           uuid references hr_onboarding_handoffs(id) on delete set null
linked_workflow_instance_id uuid references workflow_instances(id) on delete set null
linked_document_request_id  uuid                  -- soft ref
linked_training_request_id  uuid                  -- soft ref
added_by / completed_by / cancelled_by  text references app_users(id) on delete set null
added_at / completed_at / cancelled_at  timestamptz
metadata                    jsonb not null default '{}'
```
Index: `(case_id, status)`.

### `app_users` additions (`20260714000006`) — account provisioning
```sql
work_email      text
account_status  text          -- null | 'invited' | 'active' | 'disabled'
provisioned_at  timestamptz
provisioned_by  text references app_users(id) on delete set null
```

### `hr_onboarding_account_invites` (`20260714000006`)
```sql
id          uuid primary key default gen_random_uuid()
user_id     text not null references app_users(id) on delete cascade
case_id     uuid references hr_onboarding_cases(id) on delete set null
token_hash  text not null unique          -- sha256(raw); raw token is only ever emailed, never stored
work_email  text
delivery    text                          -- 'email' | 'surfaced'
status      text not null default 'pending' check (status in ('pending','accepted','expired','revoked'))
expires_at  timestamptz not null
created_by  text references app_users(id) on delete set null
created_at  timestamptz not null default now()
accepted_at timestamptz
```

### Permission grant migrations
`role_permissions (role_name, permission)` — flat table, **no role inheritance**. See §4.

---

## 2. Shared type contract — `types/hrOnboarding.ts`

One file, imported by both sides. Key shapes (already implemented, do not redeclare):
`OnboardingCaseStatus | OnboardingTaskStatus | OnboardingHandoffStatus |
OnboardingBlockerStatus | OnboardingSeverity`, `OnboardingPackageSummary` (incl. `id`),
`OnboardingCaseRow`, `OnboardingCaseListArgs/Result`, `OnboardingDashboardStatsArgs`,
`OnboardingDashboardStats` (`activeCases`, `blockingTasks`, `dueThisWeek`,
`activationReadiness`, `packageReadiness[]`), `OnboardingTaskListArgs/Row`,
`OnboardingHandoffListArgs/Row`, `OnboardingBlockerListArgs/Row`,
`OnboardingActionType | OnboardingOwnerType | OnboardingActionPriority`,
`OnboardingActionTemplate`, `OnboardingCaseAction`, `OnboardingAuditRow`,
`OnboardingPackageDetail`, `OnboardingTaskTemplateRow`, `OnboardingHandoffTemplateRow`,
`CreatePackageArgs/UpdatePackageArgs/SetPackageStatusArgs`,
`CreateTaskTemplateArgs/UpdateTaskTemplateArgs`,
`CreateHandoffTemplateArgs/UpdateHandoffTemplateArgs`.

Any new endpoint's request/response shape must be added here first, then imported by
both the route and the frontend hook — never redeclared per side.

---

## 3. Backend service files (`netlify/functions/lib/hr/`)

| File | Owns |
|---|---|
| `onboardingCore.ts` | `startOnboardingCase()` — the ONE path that creates a case + tasks + handoff intents + (best-effort) selected custom actions. Reused by both `/onboarding/start` and the Create-Employee-wizard's inline onboarding intent. Goes through `runModuleMutation` for idempotency. Reads 2 settings gates (`enabled`, `require_owner_on_start`) and the case-number prefix setting. |
| `onboardingQueries.ts` | All READ aggregation: `listOnboardingCases`, `getOnboardingDashboardStats` (incl. `packageReadiness` grouping), `listOnboardingTasks`, `listOnboardingHandoffs`, `listOnboardingBlockers`, `listRecentOnboardingActivity`. Progress %, open/blocking counts, and readiness are COMPUTED here from live task/blocker rows — never denormalized. |
| `onboardingMutations.ts` | Case/task/blocker state transitions: `addOnboardingTask`, `blockOnboardingTask`, `unblockOnboardingTask`, `completeOnboardingCase`, `pauseOnboardingCase`, `resumeOnboardingCase`, `reassignOnboardingOwner`, `markOnboardingReady` (enforces the 4 activation-gate settings), `resolveOnboardingBlocker`, `escalateOnboardingBlocker`, `waiveOnboardingBlocker` (settings-gated), `listOnboardingAudit`, `recomputeCaseStatus` (shared blocked↔in_progress flip). |
| `onboardingPackageService.ts` | `loadPackagePlan` (the single instantiation source for case-start), `listPackageSummaries`, `packageLabelMap`, `getPackageDetail`, `createPackage`, `updatePackage`, `setPackageStatus`, `create/update/deleteTaskTemplate`, `create/update/deleteHandoffTemplate`. |
| `onboardingCustomActions.ts` | Template CRUD (`listActionTemplates`, `createActionTemplate`, `updateActionTemplate`, `retireActionTemplate`) + case-action CRUD (`listCaseActions`, `addCaseAction`, `updateCaseAction`, `completeCaseAction`, `cancelCaseAction`) + `instantiate()` — the switch that turns a template into a real task/handoff/workflow-request/notification based on `action_type`. |
| `onboardingTaskCategory.ts` | Pure function `taskCategory(task)` → `profile\|documents\|training\|access\|payroll\|hse\|other`, used by both readiness % and the activation gates — one classifier, not duplicated. |
| `accountProvisioning.ts` | Phase 6: `provisionAccount` (derives work email from settings, creates the Supabase Auth login, issues a single-use sha256-hashed invite token, emails it via Resend to the PERSONAL email, raises a `pending` IT handoff for the real mailbox) and `acceptAccountInvite` (public, sets the password via the token). |

---

## 4. API routes — `netlify/functions/routes/hrOnboarding.ts` (all real, all mounted under `/api/hr/onboarding/...` unless noted)

| Route | Permission | Notes |
|---|---|---|
| `POST /onboarding/preview-package` | `hr.onboarding.view` | wizard preview |
| `POST /onboarding/packages/list` | `hr.onboarding.view` | |
| `POST /onboarding/start` | `hr.onboarding.start` | see `onboardingCore.ts` |
| `POST /onboarding/task/complete` | assignee OR `hr.onboarding.task.manage` | auto-completes case when 0 open tasks remain |
| `POST /onboarding/task/reassign` | `hr.onboarding.task.manage` | |
| `POST /onboarding/cancel` | `hr.onboarding.cancel` | |
| `POST /onboarding/get` | `hr.onboarding.view` | by caseId or employeeId |
| `POST /onboarding/dashboard-stats` | `hr.onboarding.view` | Overview KPIs |
| `POST /onboarding/list` | `hr.onboarding.view` | Cases table |
| `POST /onboarding/tasks/list` | `hr.onboarding.view` | |
| `POST /onboarding/handoffs/list` | `hr.onboarding.view` | |
| `POST /onboarding/blockers/list` | `hr.onboarding.view` | |
| `POST /onboarding/task/add` | `hr.onboarding.case.manage` | |
| `POST /onboarding/task/block` | `hr.onboarding.task.manage` | |
| `POST /onboarding/task/unblock` | `hr.onboarding.task.manage` | |
| `POST /onboarding/complete` | `hr.onboarding.complete` | |
| `POST /onboarding/pause` | `hr.onboarding.case.manage` | |
| `POST /onboarding/resume` | `hr.onboarding.case.manage` | |
| `POST /onboarding/reassign-owner` | `hr.onboarding.case.manage` | |
| `POST /onboarding/ready` | `hr.onboarding.case.manage` | enforces activation gates |
| `POST /onboarding/blocker/resolve` | `hr.onboarding.case.manage` | |
| `POST /onboarding/blocker/escalate` | `hr.onboarding.case.manage` | |
| `POST /onboarding/blocker/waive` | `hr.onboarding.case.manage` | reason required |
| `POST /onboarding/audit` | `hr.onboarding.audit.view` | one case's audit rows |
| `POST /onboarding/actions/templates/list` | `hr.onboarding.custom_actions.view` | |
| `POST /onboarding/actions/templates/create` | `hr.onboarding.custom_actions.create` | |
| `POST /onboarding/actions/templates/update` | `hr.onboarding.custom_actions.update` | |
| `POST /onboarding/actions/templates/retire` | `hr.onboarding.custom_actions.retire` | |
| `POST /onboarding/actions/case/list` | `hr.onboarding.view` | |
| `POST /onboarding/actions/case/add` | `hr.onboarding.custom_actions.case_add` | |
| `POST /onboarding/actions/case/update` | `hr.onboarding.custom_actions.case_update` | |
| `POST /onboarding/actions/case/complete` | `hr.onboarding.custom_actions.case_complete` | |
| `POST /onboarding/actions/case/cancel` | `hr.onboarding.custom_actions.case_cancel` | |
| `POST /onboarding/packages/get` | `hr.onboarding.view` | full package + templates |
| `POST /onboarding/packages/create` | `hr.onboarding.packages.manage` | |
| `POST /onboarding/packages/update` | `hr.onboarding.packages.manage` | |
| `POST /onboarding/packages/set-status` | `hr.onboarding.packages.manage` | draft/active/retired — no separate "publish" |
| `POST /onboarding/packages/task-templates/{create,update,delete}` | `hr.onboarding.packages.manage` | |
| `POST /onboarding/packages/handoff-templates/{create,update,delete}` | `hr.onboarding.packages.manage` | |
| `POST /onboarding/activity/recent` | `hr.onboarding.view` | cross-case feed, powers the Recent Activity widget |
| `POST /onboarding/provision-account` | `hr.onboarding.provision_account` | |
| `POST /onboarding/accept-invite` | PUBLIC (token-authenticated) | |

**Current operating routes:** handoff retry/accept/complete/cancel and blocker Notify Owner
are implemented. Case Detail reads the generic cross-module
`/api/orchestration/timeline/get` with audit excluded because Audit has its own permissioned
tab. Package duplicate/reorder commands remain outside the current contract.

---

## 5. Permissions catalogue (`netlify/functions/lib/permissions.ts` + mirrored in `src/lib/permissions.ts`)

```
hr.onboarding.view
hr.onboarding.start
hr.onboarding.task.manage          -- ONE key covers complete/reassign/block/unblock (not split)
hr.onboarding.cancel
hr.onboarding.case.manage          -- covers add-task/pause/resume/reassign-owner/ready/blocker-actions
hr.onboarding.complete
hr.onboarding.audit.view
hr.onboarding.custom_actions.view
hr.onboarding.custom_actions.create
hr.onboarding.custom_actions.update
hr.onboarding.custom_actions.retire
hr.onboarding.custom_actions.case_add
hr.onboarding.custom_actions.case_update
hr.onboarding.custom_actions.case_complete
hr.onboarding.custom_actions.case_cancel
hr.onboarding.provision_account
hr.onboarding.packages.manage      -- ONE key, plural "packages", covers package + all template CRUD
```

**Role resolution is DB-driven and flat — `loadRolePermissions(roleName)` does
`role_permissions.eq('role_name', roleName)` with NO inheritance.** Every role's grant
list must be a complete, standalone set. Current grants (from migrations, cumulative):
- `superadmin` — everything (code-driven allow-all, doesn't need a DB row).
- `admin`, `hr_manager` — `view/start/task.manage/cancel/case.manage/complete/
  audit.view/custom_actions.*/provision_account/packages.manage`.
- `manager` — `view` only (never got the deeper case-management keys).
- `hr_staff` (execution-tier, `20260714000013`) — `view/start/task.manage/case.manage/
  complete/cancel/custom_actions.{view,case_add,case_update,case_complete,case_cancel}`
  — deliberately NOT `custom_actions.{create,update,retire}` (template authoring) or
  `packages.manage` (both are oversight-tier).
- `hse_staff` — no onboarding grants (different module).

There is no separate `.view`/`.manage` split for packages, no `.task.complete` /
`.task.reassign` / `.task.override` split, and no `.reports.*` or `.settings.*`
permission namespace.

---

## 6. Settings — `netlify/functions/lib/settings/manifests/onboarding.manifest.ts`

Module key `hr_onboarding`, gated by the existing `hr.settings.manage` (no new settings
permission). Reached via the app's global Settings page (generic manifest-driven
renderer), NOT a tab inside `/hr/onboarding` (see Gap notes). All keys prefixed
`hr_onboarding.`:

**Confirmed wired into real logic** (verified via `resolveSettingValue` call sites):
`enabled` (onboardingCore — blocks case start), `require_owner_on_start` (onboardingCore),
`case_no_prefix` (onboardingCore, feeds `nextRef`), `block_activation_until_documents_complete`,
`_training_complete`, `_hse_complete`, `_payroll_complete` (all 4 in onboardingMutations'
`markOnboardingReady`), `allow_blocker_waiver` (onboardingMutations' `waiveOnboardingBlocker`),
`work_email_domain`, `work_email_pattern` (accountProvisioning).

**Present in the manifest, not yet confirmed wired to behavior** (safe defaults apply):
`allow_draft_cases`, `task_completion_requires_evidence`, `auto_start_after_employee_create`,
`blocker_waiver_requires_workflow`, `escalate_overdue_blocking_tasks`,
`send_employee_welcome_email_default`, `notify_supervisor_default`,
`account_default_credential_method`, `auto_provision_account_on_start`, `retention_years`.
Default package selection lives in `employees.manifest.ts`
(`employees.onboarding_default_package`), not duplicated here.

---

## 7. Frontend API client + hooks — `src/api/hr/onboarding.ts`

`hrOnboardingApi` object wraps every route above 1:1 via a shared `call<T>()` helper
(throws on `success:false` — fixed this session, previously silently returned
`undefined`). TanStack Query hooks, all invalidating `['hr','onboarding']` broadly on
any mutation: `useOnboardingDashboard`, `useOnboardingCases`, `useOnboardingTasksList`,
`useOnboardingHandoffsList`, `useOnboardingBlockersList`, `useOnboardingPackages`,
`useOnboardingAudit`, `useOnboardingRecentActivity`, `useOnboardingPackageDetail`,
`useOnboardingActionTemplates`, `useOnboardingCaseActions`, plus one mutation hook per
route (`useOnboardingCompleteTask`, `useOnboardingAddTask`, `useOnboardingCreatePackage`,
`useOnboardingCreateTaskTemplate`, etc. — see the file for the full list, ~35 hooks).

---

## 8. Frontend pages — `src/components/sections/HR/` (flat, not nested under an `Onboarding/` folder)

| File | Role |
|---|---|
| `OnboardingOverview.tsx` | Landing page. Widget board: 5 KPI tiles (Active Cases, Due This Week, Blocked Cases, Activation Readiness, Onboarding Health) + Package Readiness + Recent Activity widgets + a page-local Cases table widget (search/status/advanced-filter/pagination). Toolbar has "Packages" (permission-gated) and "Start Onboarding". Drill-in state: `selectedCase` → renders `OnboardingCaseDetail`; `packagesOpen`/`openPackageKey` → renders `OnboardingPackageManager`/`OnboardingPackageDetail`. |
| `OnboardingCaseDetail.tsx` | Focused case workspace. Default Overview has Priority Tasks, Activation Readiness, Readiness by Domain and Key Blockers. Account setup is an Access-owned Priority Task, never a standalone widget. Recent Activity, Handoff Summary and Case Actions are optional library widgets; Timeline, Handoffs and Tasks remain authoritative. Header exposes View Employee Record + Review Readiness, with Customize/Reassign/Pause/Cancel in More. |
| `StartOnboardingWizard.tsx` | Full-page five-step `WizardShell`: Employee & Timing → Package → Optional Work → Documents → Review & Launch. Implement against the approved target above; do not restore the legacy modal or its separate Preview/Tasks/Handoffs ceremony. |
| `OnboardingPackageManager.tsx` | A 2 × 2 visual register shows all four package cards at the top of the main column. Search/status/worker-type filters, large package-type icons, New Package dialog, shared SIOMAC skeleton. The page-level context rail begins beside the register; no persistent left package rail. |
| `OnboardingPackageDetail.tsx` | Selected-package workspace with 7 tabs: Overview, Work Plan, Handoffs, Requirements & Gates, Worker Portal & Account, Communications and Governance & Versions. A persistent right rail carries Package Health, Operating Defaults and draft/review state across every tab; it does not repeat quick settings. Published versions are read-only; changes begin from an isolated draft. |
| `EmailTemplateStudioPage.tsx` + `EmailTemplateBuilder.tsx` | Dedicated routed editor opened from Package Detail → Communications. It replaces the package page rather than rendering below it. Use the native Preact-owned ordered block editor inside the Payslip Studio-themed shell; do not reuse the payslip free-position canvas or introduce React Email/GrapesJS. Email uses approved blocks and responsive rows, visible insertion guides, nested columns, contextual properties, governed employee-profile/image blocks, desktop/mobile preview, outline, revisions, test delivery, draft save and review. It returns to the package Communications register and never becomes a global settings or Case Detail editor. |
| `onboardingStatus.ts` | Shared status-pill presentation + `humanize`/`fmtDate`/`fmtDateTime` — one source for both Overview and Case Detail. |
| `onboardingCase.helpers.tsx` | Shared task matchers/bucketing (`matchDocs`, `matchTraining`, `matchProvision`, `isOpen`, `daysUntil`, etc.) used by both the page and `registry.hrOnboardingCase.tsx` widgets. |
| `onboardingCase.css` | Plain-table/pill/button classes (`.obx-*`) shared by Case Detail, Package Manager, and Package Detail. |

**Elsewhere (pre-existing, confirmed present):**
- `CreateEmployeeWizard.tsx` — step `cur.key === 'onboarding'` ("6. Onboarding Handoffs"):
  a "start onboarding case on create" checkbox, package selector, and `ONBOARDING_REQS`
  checkboxes; submits `{ createOnboardingCase, onboardingPackage, onboardingReqs }`
  which the employee-create route turns into a call through `onboardingCore.ts`.
- `ProfileDrawer.tsx` — `MORE_TABS` includes `'Onboarding'`; `OnboardingTab` (line ~434)
  shows the case summary via `useHrOnboardingCase(employeeId)` and allows completing
  tasks inline (`useCompleteOnboardingTask`) and cancelling (`useCancelOnboarding`) —
  these are the OLDER employee-scoped hooks (`hr/onboarding/get` by `employeeId`), a
  separate, thinner path from the case-management hooks above.
- `src/ui/widgets/registry.hrOnboarding.tsx` — Overview's 7 KPI/analytics widgets.
- `src/ui/widgets/registry.hrOnboardingCase.tsx` — Case Detail's KPI-tile widget
  catalog (10 widgets; only 4 are in the default layout, the rest are library-addable).
- `src/store/onboardingCase.ts` — the zustand store that publishes the active case to
  detached widget-board roots (they don't inherit React context).

---

## 9. Navigation map (no router — see convention #6)

```
Sidebar → HR → Onboarding  (HRSection.tsx, siomac:section event)
  OnboardingOverview
    ├─ click a case row     → OnboardingCaseDetail   (selectedCase state)
    ├─ "Start Onboarding"   → StartOnboardingWizard   (full page)
    └─ "Packages" (gated)   → OnboardingPackageManager (packagesOpen state)
                                 └─ click a package row → OnboardingPackageDetail (openPackageKey state)
```
Also reachable: Employee Master → Create Employee wizard (onboarding intake step) and
Employee Profile Drawer → "Onboarding" tab (summary + task actions).

Additional approved surfaces:

- **OnboardingMyWork** — person-first work queue with a permissioned department view;
  it projects existing tasks, handoffs and evidence reviews rather than creating another
  work store.
- **WorkerOnboarding** — token-scoped pre-hire experience for worker-safe tasks, forms,
  uploads, key people and Day-One guidance. It never renders internal blockers, routing,
  audit or specialist controls.

---

### Case Detail focus pass

The Case Detail Overview is an exception-focused operating surface, not a miniature copy
of every case tab. Its default saved layout contains exactly four widgets:

1. Priority Tasks
2. Activation Readiness gauge
3. Readiness by Domain
4. Key Blockers

Recent Activity is removed from the default because Timeline is authoritative. Handoff
Summary is removed because Handoffs owns that workflow. Case Actions are not a separate
task system; they are labelled case-specific rows in Tasks. Those summaries may be
re-added from the widget library without changing the authoritative workspace.

The header exposes View Employee Record and Review Readiness. Customize Overview,
Reassign Owner, Pause and Cancel live in the More menu with independent permission
checks. The profile strip is locked to Concept 01, **Navy Identity Anchor**: one navy
employee-identity cell followed by four equal white cells for Package, Case Owner,
Current Stage and Status. It does not repeat Department as a standalone cell; it retains
employee, package, case owner, current stage and case status. Port the same visual
contract as Employee Master's drawer facts: restrained icon tiles, title-case labels,
readable values, secondary context and the case owner's profile photo beside the name.

Priority Tasks is a neutral aligned work list with Task, Owner, Due and Action columns.
Only the compact semantic status tag uses colour, uses title case and remains medium
weight. Icons, row surfaces and buttons remain neutral so the queue does not compete
visually with blocker severity. Render due dates as compact calendar facts; only overdue
helper text uses warning colour. Do not render `View all tasks` or a footer task-workspace
link because the persistent Tasks tab is the single navigation path. Keep the account
setup row action compact (`Set up` or `Request`) and place the full workflow wording in
the governed dialog.

Readiness by Domain uses a SIOMAC navy header across Requirement, Profile, Documents,
Training, HSE, Access and Payroll. The body remains white; domain status tags carry the
semantic state colour.

Do not rebuild the former seven-stage Onboarding Progress strip. The Current Stage cell
contains the compact stage progress bar with its percentage aligned on the right. Join
the tab navigation as a separate full-width card beneath the profile strip. The active
tab fills its complete equal-width segment with a quiet grey surface and no accent line;
do not render a floating active pill. Task and handoff counts remain neutral; only the
Blockers count is red. Use one neutral 16px icon per tab and keep the bar to 44px high.
Priority Tasks
begins directly below. The right rail starts with the semantic
red–amber–green Activation Readiness gauge; widget chrome and domain icons stay neutral
so status colour remains meaningful.

Account Activation is not a default widget. Render the action as an Access-owned Priority
Task only while provisioning or an account-support request needs attention. That row
opens the existing governed provisioning dialog. The configured operating model decides
whether HR provisions directly or requests completion from IT/Admin; after activation,
the durable account record is managed in Employee Master → Access.

### Account provisioning operating contract

Industry references converge on HR data triggering a governed joiner workflow, while an
identity service or authorised operator creates the account and auditable lifecycle tasks
handle activation and access. Relevant primary references:

- Microsoft Entra Lifecycle Workflows separates HR-driven account creation/attribute
  updates from follow-on joiner tasks and supports time-based execution, group/license
  work, temporary access and audit history:
  <https://learn.microsoft.com/en-us/entra/id-governance/understanding-lifecycle-workflows>
- Microsoft's deployment guidance treats inbound HR provisioning as a prerequisite and
  models enable-account, welcome-email, group, Teams and license tasks separately:
  <https://learn.microsoft.com/en-us/entra/id-governance/lifecycle-workflows-deployment>
- SAP SuccessFactors guides HR, managers, IT and the worker through distinct onboarding
  activities and converts a limited pre-hire user into an internal user on day one:
  <https://help.sap.com/docs/successfactors-onboarding/implementing-onboarding/onboarding-process-overview>
  and
  <https://help.sap.com/docs/successfactors-onboarding/implementing-onboarding/configuring-day-one-conversion-job-in-provisioning>

SIOMAC therefore implements the following state model:

`not_started → queued → identity_created → activation_pending → active`

`failed` is a recoverable state with a safe operator-facing reason and retry/escalation;
`cancelled` terminates the onboarding intent without deleting an independently active
identity.

The case launch writes a provisioning **intent/work item**, not an unconditional account.
The provisioning command must:

1. re-read the employee, current assignment, start date and organisation policy;
2. verify the personal delivery address and work-email uniqueness;
3. resolve the approved access profile and accountable operating owner;
4. fail closed when any required input or owner is missing;
5. atomically create/request the identity, provisioning transition, audit/event records,
   notifications and handoff/outbox work;
6. record mailbox/directory confirmation explicitly rather than inferring it from a work
   email string;
7. send only a single-use activation mechanism—never a password visible to HR;
8. keep application entitlements, MFA health and later support in Employee Master →
   Access after activation.

Operating models are settings-driven:

- **Automated directory** — SIOMAC calls the configured connector; IT/Admin owns failures.
- **IT/Admin managed** — HR submits and monitors; the configured queue/person completes.
- **Delegated HR** — for smaller organisations only; requires
  `hr.onboarding.provision_account` and still uses the same audited command.

The dialog shows the same milestones for every model and changes only the accountable
owner and primary action. Account activation may precede onboarding completion, but it
does not mark Access—or the whole case—ready until the required access tasks and gates
are complete.

The default layout and loading skeleton must both derive from
`reactGridDefaults`/the saved widget layout. Do not hard-code the old seven-widget board
or render removed widgets briefly before the saved layout resolves.

## End-to-end onboarding operating contract

Primary product research supports a role-separated journey rather than one overloaded
HR page:

- SAP models initiation, manager review/tasks, worker checklist/forms and eventual
  conversion of the pre-hire into an internal employee as separate stages:
  <https://help.sap.com/docs/successfactors-onboarding/implementing-onboarding/onboarding-process-overview>
- SAP's dashboard is an operational portfolio with task status, due-state filters,
  nudges and target-population permissions:
  <https://help.sap.com/docs/SAP_SUCCESSFACTORS_ONBOARDING/c94ed5fcb5fe4e0281f396556743812c/onboarding-dashboard?locale=en-US>
- SAP package/program rules select work using employment criteria and route tasks to
  responsible groups:
  <https://help.sap.com/docs/successfactors-onboarding/implementing-onboarding/onboarding-tasks?source=redirect>
- Oracle Journeys models tasks with performer, owner, target duration, expiry,
  prerequisite tasks and manual/application task types:
  <https://docs.oracle.com/en/cloud/saas/human-resources/25a/faijh/implementing-and-using-journeys.pdf>
- Microsoft Entra separates HR-driven identity provisioning from timed joiner workflow
  tasks and their audit history:
  <https://learn.microsoft.com/en-us/entra/id-governance/understanding-lifecycle-workflows>

SIOMAC therefore owns the following lifecycle:

`configure → select worker → generate plan → preflight → launch → execute → verify gates → complete → retain`

### Surface ownership

| Surface | Owns | Must not own |
|---|---|---|
| Settings | operating model, routing, escalation and authority policy | individual case work |
| Packages | versioned eligibility, required work and gate definitions | live-case progress |
| Employee Master | canonical person/employment facts and durable post-onboarding records | onboarding task history |
| Start wizard | case context, package choice, approved extras, document decisions and launch review | editing Employee Master or package definitions |
| Portfolio | cross-case priorities, deadlines, queues, blockers and saved views | specialist evidence decisions |
| Case Detail | one case's work, handoffs, blockers, communications, readiness and audit | worker self-service or technical access administration |
| My Work / team queue | work assigned to the current person or accountable team | all-company case visibility |
| Worker Onboarding | secure forms, uploads, e-signatures, welcome content, key people and worker tasks | internal audit, routing and specialist controls |

### Launch boundary

The selected employee id is the identity anchor. The preflight must re-read the current
assignment and:

1. reject an unresolved active duplicate;
2. resolve a published compatible package version;
3. validate start-date lead time and mandatory owners;
4. resolve every required task, handoff, document request, communication and gate;
5. freeze the plan and create all business records and required side effects atomically;
6. return one case id only after the full launch commits.

The launch wizard previews the generated plan but does not persist browser-derived work
definitions.

### Execution and authority

- A team owns the routing queue; a person is accountable for the current assignment.
- HR coordinates across queues. Completion or approval remains with the permissioned
  department unless organisation settings explicitly delegate that authority.
- Task completion, evidence submission and evidence approval are distinct states.
- Readiness is recalculated from required gates after every material transition.
- Due dates follow the package's relative schedule and rebase through a governed
  start-date-change command. Completed evidence is never silently rewritten.
- Communications, reminders and escalations reference the authoritative task, handoff or
  blocker rather than creating untracked parallel work.

### Completion and continuity

- Account activation may precede case completion, but domain readiness still controls
  Day-One status.
- Complete Case requires all mandatory gates ready or an authorised exception with a
  reason and audit entry.
- Completion writes durable employee outcomes to their owning modules and retains the
  frozen case history.
- Rehire, internal transfer, delayed start, cancellation and restart use explicit case
  types/transitions. They reuse the Employee Master id and never clone the employee.

### Missing journey surfaces/contracts

1. **Worker Onboarding experience** — secure pre-hire invitation, personal-data forms,
   document upload, e-signature, worker checklist, key people and Day-One guidance.
2. **Role-specific My Work** — person and department queues with delegation, bulk
   actions where safe, and target-population permissions.
3. **Start-date change/rebase** — one governed command that recalculates incomplete
   relative deadlines, notifications and escalations without rewriting completed work.
4. **Explicit case types** — new hire, rehire, internal transfer and contractor need
   deliberate eligibility/rules rather than being inferred from package names.
5. **Restart and cancellation policy** — define what is revoked, retained or reissued,
   including invitations and independently active accounts.
6. **Completion handoff** — an atomic, auditable close that writes durable outcomes to
   Employee Master and owning modules while preserving the onboarding record.

## 10. Verified remaining gap list

This list was reconciled with the current routes and frontend on 2026-07-30. Do not
rebuild features that are already present: Reports and the unified cross-case Work Queue
exist; the former separate Tasks, Handoffs and Blocked workspaces were deleted after queue
parity; handoff retry/accept/complete/cancel exists; case
communications exists; blocker Notify Owner exists; the generic orchestration timeline
has an onboarding client adapter; and the dedicated Audit tab has a read endpoint.

**Case Detail**

1. `OnboardingHandoffRow` now exposes the first-class `dueAt`, owning module queue and
   accountable-person id/name used by Case Detail. Expected outcome and handoff-specific
   evidence progress are still not first-class fields; do not infer them from display copy
   or loosely typed payload.
2. Handoffs can be retried, accepted, completed and cancelled, but there is no dedicated
   reassignment command. Build one atomic command that changes the accountable person,
   preserves the owning queue and evidence history, emits the event/audit records and
   notifies the new owner.
3. Restricted onboarding evidence can be attached, but Case Detail does not yet have a
   specialist review/read contract with explicit HSE or medical authority. Add a
   permission-scoped read plus an approve/return decision command; HR coordination alone
   must never imply specialist approval authority.
4. `OnboardingAuditRow` exposes actor, action, reason, previous/new state and time, but
   not correlation id, source entity, workflow id or request/security context. The Audit
   target shows correlation/source information, so extend the authorised projection
   before rendering those columns.
5. There is no onboarding audit-history export endpoint. Build an audited CSV/PDF export
   that re-reads the case audit server-side, requires a business reason and uses
   `hr.onboarding.audit.view`; do not export browser-held rows.
6. The generic timeline returns heterogeneous metadata but does not guarantee a
   `sourceTab` and `sourceRecordId` pair. Add a stable adapter/projection so each timeline
   entry can reliably open its authoritative Task, Handoff, Communication or Audit row.
7. Case Detail is still state-switched rather than URL-routed. A specific case and tab
   cannot be bookmarked or shared until the HR onboarding router owns case id + tab.
7a. The approved Case Detail dialog contract adds dedicated commands for task
    reassignment, task unblock, blocker escalation, specialist evidence review,
    handoff reassignment, handoff evidence, handoff completion and authorised evidence
    download. Do not route these through one generic mutation payload: each command has
    different permissions, validation and side effects. Nested dialogs return to their
    source record and refetch its authoritative tab after success.

**Package Manager**

8. Package matching needs one server-owned evaluator shared by package register testing,
   wizard eligibility, preview and launch validation. It must rank compatible packages,
   explain matched Employee Master facts and report equal-priority conflicts.
9. Work-plan tasks need explicit stage, performer audience, accountable queue, relative
   due rule, prerequisite, completion evidence and worker-visibility fields. Do not infer
   these from task labels or modules. Add server filtering for search and accountable
   team; bulk updates must target a draft version and write one governed change reason.
10. Handoffs need explicit queue ownership, person-resolution rule, expected outcome,
    relative due rule, evidence expectation, fallback and escalation SLA.
11. Package-bound document requirements and Day-One gates need separate persisted
    associations. Requirements own format/expiry/reviewer/waiver rules; gates own linked
    conditions, activation impact and accountable reviewer. Return requirement category
    and a stable satisfied-by projection so the UI can filter across Documents, Training,
    HSE, Access and Payroll without guessing from labels.
12. Worker-portal blocks, invitation timing and package communication templates need
    persistence, preview, language and delivery-failure handling. Global Settings remains
    the only source of provisioning authority and routing; the package stores only timing,
    content and the readiness gate. Store template bodies as validated structured blocks,
    not unrestricted HTML. Server rendering sanitises text and permits action buttons to
    use only allow-listed secure destinations. Organisation branding, sender identity and
    security footer are resolved from Onboarding Settings at render time. Image blocks
    reference governed communication-asset ids rather than browser data URLs. Uploads go
    through an authenticated Netlify route, validate PNG/JPEG/WebP and size limits, scan
    content, store an organisation-scoped object, and require accessible alternative text.
13. Package status is currently a direct draft-to-active-to-retired transition. Add the
    reviewed-draft/publish contract for maker-checker organisations and preserve the
    immutable definition used by each active case.
14. Package-version history needs a permission-gated read model with actor, reviewer,
    reason, changed-area summary and affected-case counts. The publish read model must
    also report eligibility conflicts, unowned work, unlinked gates and reviewer status.
15. Reordering and duplication remain absent. Implement reordering only inside draft
    versions and duplicate into a new draft; never mutate a published definition.
16. The package-detail read model must return the Operational Defaults rail explicitly:
    default accountable queue id + resolved label, secure-invitation enabled state,
    invitation offset in days, review cadence and next policy-review date. Do not derive
    these values from display copy or duplicate organisation provisioning ownership.
17. The mockup also exposes bulk task update, duplicate package, compare versions and
    communication test delivery. Each needs its own authenticated command/read route.
    Bulk update and duplicate operate only on drafts; test delivery must not emit a real
    onboarding case event; version comparison is read-only.
18. Package dialogs are part of the contract, not presentation-only examples. Create,
    draft, retire and publish validate lifecycle state server-side; task/handoff/
    requirement/gate dialogs persist every displayed policy field; employee matching,
    preview and comparison reuse server read models; communication tests create a test
    delivery record but never a case communication or onboarding event. Email template
    create/edit is intentionally a full-page package workspace rather than a dialog.
19. Package preview has two read-only depths backed by the same authoritative generated-
    plan read model: a concise summary and a full stage/outcome/ownership view. Opening
    the full plan creates no case records, tasks, handoffs, events or notifications.
    Communication preview resolves template tokens without delivery; **Send Test** uses
    the governed test-delivery command. Version comparison returns the complete changed-
    rule set inside the dialog rather than a second placeholder destination.

**Email Studio backend contract**

Read `docs/ONBOARDING_EMAIL_STUDIO_AUDIT.md` before implementation. Build the editor
natively in Preact/Vite/TypeScript within SIOMAC's Payslip Studio theme. The discarded HTML
mockup editor, React Email and GrapesJS/MJML editor proposals are not design or code sources.
SIOMAC owns the block schema, ordered canvas, contextual inspector, governed assets, merge
fields, backend compilation, permissions and revision lifecycle.

**Production composition (reuse, do not fork)**

- Reuse the Payslip Studio full-screen shell, toolbar/status geometry, dark palette treatment,
  dotted stage, inspector patterns and geometry-matched skeleton. The native editor owns
  selection, history, visible drag/drop positions, outline/layers, assets and commands.
- Email-owned files include the routed Studio page, `EmailTemplateBuilder.tsx`, shared
  `EmailEditorSchema`, `emailTemplateDocument.ts`, governed asset adapter and future server
  compiler/compatibility-profile modules. Register only approved components and row layouts;
  disable raw HTML, scripts, iframes and remote embeds.
- Never reuse Payslip Studio's free positioning, page-size model, PDF renderer or
  coordinate-based snapping. Email blocks use ordered responsive flow; width and minimum
  height controls persist bounded semantic values rather than x/y coordinates.
- Persist `EmailDesign { schemaVersion, subject, preheader, blocks, settings }`;
  never persist arbitrary browser DOM or `contenteditable.innerHTML`. The design adapter
  accepts only registered component types, assets are ids, links are approved destinations
  and tokens are allow-listed identifiers.
- `settings.brand` stores only controlled package overrides: approved logo asset id,
  header label, approved palette token and optional footer context. Sender identity and
  the required security notice resolve from Onboarding Settings and cannot be removed by
  the package editor.
- The Employee Profile block stores presentation options only. At preview/delivery the
  server resolves Employee Master's approved photo asset, full name and job title from the
  chosen sample or real case. No external avatar URL or duplicated employee data is stored.
- The compiler interface owns a versioned compatibility profile. A candidate compiler
  release is pinned and security-reviewed, then must pass strict compilation, representative
  fixture snapshots, HTML/accessibility checks and the supported client matrix before the
  profile version changes. “Latest” means the latest SIOMAC-approved profile, never a
  floating package version or a runtime update.
- Generate a multipart message: useful plain text plus deterministic HTML. HTML uses a
  bounded 600–620 px table body, inline critical styles, responsive stacking, declared
  image dimensions/alt text and narrowly scoped client fallbacks. Preview and test must
  compile through this exact path so the browser canvas cannot claim unsupported fidelity.
- The routed studio uses the shared page skeleton. Its shell is shaped as left resource
  rail + wide centre canvas + right inspector, so loading does not flash a different
  composition before the editor state arrives.

- `packages/communications/get` returns template metadata, structured blocks, asset
  references, revision and autosave token for one package draft.
- `packages/communications/upsert` validates the package is editable, checks optimistic
  revision, validates every block/token/link/asset, writes the template and audit record,
  and never stores the browser's generated HTML.
- `packages/communications/preview` resolves sample tokens and renders the same
  server-authoritative email markup used for delivery. It returns HTML, plain text,
  compatibility-profile id and structured validation/accessibility diagnostics. Desktop/
  mobile are presentation widths over the same render, not separate templates.
- `packages/communications/test` creates a test-delivery record and queues delivery to the
  nominated internal recipient without writing a case communication or onboarding event.
- `packages/communication-assets/list|upload|replace|archive` manage organisation-scoped
  image assets. Upload/replace accept only PNG/JPEG/WebP within the configured size limit,
  verify the decoded file type, scan it, persist dimensions/storage metadata and return an
  asset id. Templates reference that id and required alternative text.
- Autosave is a draft update with optimistic concurrency and a short debounce. Publish
  freezes the template blocks and asset-version references with the package version.
- Permissions remain narrow: package view, package manage, communication test-delivery and
  asset manage are checked independently. Every mutation writes `audit_logs`; publish and
  real delivery retain their existing events/notification side effects.

The approved Package Management UI does not edit a published package in place. It shows
the published version read-only, then creates an isolated draft version with a mandatory
reason. Publishing must freeze that definition for future cases while active cases retain
their launch version. The package also owns worker-experience content and timing; Global
Settings continues to own organisation-wide provisioning authority and routing.

The package list is a full-width visual register at the top of the main column above the
selected package, not a narrow left library. The page-level context rail begins beside
the register. Package cards use large package-type icons. The selected-package workspace
uses a main configuration column and a persistent contextual right rail for health,
accountable queue, invitation timing, account ownership and review state.
Do not duplicate those operational facts inside Package Definition.
Every tab has a complete add/edit destination in the approved mockup. Most actions use
dialogs; package email create/edit uses `OnboardingEmailTemplateEditor.tsx`. Claude must
wire every destination to authenticated endpoints or leave the affected action
unavailable until its contract exists—never accept and drop.

Package register search/status/worker-type filters and bounded work-plan search/team/
stage filters must react immediately. Worker-journey toggles expose their persisted
boolean state with `aria-pressed`. These controls are not decorative mockup chrome.

**Interaction rule**

Case-specific communication filters can remain client-side because the endpoint is
already case-scoped and the dataset is bounded. Tasks use their existing server-side
query/status/owner/module/due filters. Handoffs and Blockers use their existing
status/module/severity filters. Do not add a second task, handoff, blocker,
communications, timeline or audit store.

## Production UX acceptance reference

Use `docs/ONBOARDING_PRODUCTION_UX_AUDIT.md` for the final page responsibilities,
role-aware navigation, visual scale, redundancy removals and interaction acceptance
rules. Exploratory concept files are not implementation targets. The canonical targets
are the implementation-ready pages plus `onboarding-command-centre-core.html`,
`onboarding-command-centre-analytics.html` and `onboarding-worker-implementation-ready.html`.

---

## Document accuracy + build-order discrepancy (recorded 2026-08-02)

**AGENTS.md build order is stale, and is deliberately left unchanged.** Its "Build Order"
section still describes the older HSE-first sequence and defers "HR / Finance / Operations
full UI". The currently approved scope is the HR Onboarding production implementation
(Command Centre, Manager Insights, Work Queue, Case Detail, Start Onboarding wizard,
Package Management, Onboarding Settings, Worker Onboarding experience), with Email Studio
explicitly DEFERRED and its files not to be modified. AGENTS.md is the worktree's standing
build instruction file, so it is not rewritten to match a single approved workstream; this
note is the record of the divergence.

**Two corrections to THIS document, verified against source on 2026-08-02:**

1. §4's route table and its "Does not exist" paragraph are STALE. `hrOnboarding.ts` mounts
   63 routes. Already present despite being listed as missing: `handoff/{accept,retry,
   complete,cancel}`, `blocker/notify-owner`, `communications/{list,send,resend,preview}`,
   `reports/{list,run,export}`, `task/{get,add-note,attach-evidence,evidence-upload-url}`
   and `intake-preview`.
2. §8 cites `src/ui/widgets/registry.hrOnboarding.tsx` and `registry.hrOnboardingCase.tsx`.
   Neither exists. The registered widget modules are `registry.calendarPlanning.tsx`,
   `registry.hrEmployeeDashboard.tsx`, `registry.hrEmployeeMaster.tsx` and
   `registry.weather.tsx`.

Verify against source before building on any claim in this file.

## Onboarding read scope (implemented 2026-08-02)

Scope is resolved server-side by `netlify/functions/lib/hr/onboardingScope.ts` — the single
resolver consumed by every onboarding read. `my` = base `hr.onboarding.view` (owned,
started, assigned, participant, permitted direct-report). `team` requires
`hr.onboarding.view_team`; `all` requires `hr.onboarding.view_all`. An unauthorised
requested scope returns 403 and is never silently downgraded. Counts and charts are
computed from the same scoped case population as the register, so a total can never
include a row the actor may not list.

## Implemented operating slice status (2026-08-03)

The currently implemented operating slice connects three surfaces; this is not the
completion claim for the full onboarding implementation target:

- **Command Centre** — permission-aware `My / Team / All` scope, shared KPI tiles and
  registered planning widgets, focused-case and blocker summaries, upcoming starts, and
  a server-authoritative work-queue summary. Scope changes refetch every dependent read.
- **Work Queue** — one server-paginated queue for tasks, handoffs, blockers and evidence
  reviews. It defaults to Assigned to Me, supports manager scope widening, filters,
  sorting, saved views and quick review, and opens the owning case for full action.
- **Case Detail** — the permanent seven-tab operating shell: Overview, Tasks, Handoffs,
  Blockers, Communications, Timeline and permission-gated Audit. Overview alone is a
  customizable widget board; operational tabs are permanent and are not widgets.

Case ownership and accountable work ownership remain separate throughout the UI. Queue or
department identifies the accountable team; the assigned person identifies who must take
the next action. The Work Queue and Case Detail consume the same backend contracts rather
than maintaining duplicate client-side work models.

Email Studio remains a separate workstream and is not part of this implementation gate.

Full product completion still requires the remaining Start Onboarding backend gates,
the unified seven-tab Package workspace, Manager Insights, Onboarding Settings and the
Worker Onboarding experience, plus every backend and E2E item in the Completion gate and
Verified remaining gap list above.

## Start Onboarding implementation update (2026-08-04)

The five-step production wizard is now the active frontend contract. Employee and owner
lookup reuse the shared async `PersonSearchSelect`; package eligibility is server-owned;
required package actions cannot be omitted; foreign or inactive optional actions are
rejected; managers can add typed one-off case work; and account routing is exposed through
`hr/onboarding/account-preflight`. Review & Launch consumes
`hr/onboarding/launch-preflight` and re-runs it immediately before launch.

Document readiness now treats only a verified record that remains valid through the target
start date as reusable. Every unresolved requirement needs an explicit disposition.
Unverified, expired and foreign records cannot satisfy a launch blocker. Waivers require
the dedicated permission and a non-empty reason. The old `uploadedFilePath` and shadow
`workerTypeDetails` inputs were removed because neither was an authoritative record.

The source migration `20260804024501_hr_onboarding_atomic_launch.sql` defines the pending
atomic launch boundary: request-scoped idempotency, employee-level concurrency locking,
frozen package id/version/snapshot, dated tasks, handoffs/outbox, document requests,
selected and required actions, participant notifications, platform audit, HR audit and
events commit together. The migration is **not applied yet** and the new launch E2E gate
has not run; this slice must not be described as production-complete until both happen.

Still open in the wizard contract: governed pre-case document upload/commit, a scoped
single-use worker upload token and delivery record for document requests, and atomic
automatic account provisioning (which remains disabled). The corresponding unused draft,
automatic-start, notification-default, credential-method and auto-provision settings were
removed from the catalogue rather than advertised as working controls.
