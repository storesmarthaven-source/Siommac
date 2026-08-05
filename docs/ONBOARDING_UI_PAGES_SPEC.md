# HR Onboarding — page-by-page UI reference (for mockup work)

This documents every real page/surface in the HR Onboarding module as it is actually
built and wired today — the fields, tables, and actions each one shows — so it can be
used as a reference for producing a mockup elsewhere. Example values below are real
seeded data from the dev environment, not placeholders.

## Navigation map

```
Sidebar → HR → Onboarding
  └─ Overview (landing page)
       ├─ click a case row        → Case Detail
       ├─ "Start Onboarding"      → Start Onboarding wizard (full page)
       └─ "Packages" button       → Package Manager (list)
                                        └─ click a package row → Package Detail (3 tabs)
```

Package Manager / Package Detail are only visible to users holding
`hr.onboarding.packages.manage` (admin / hr_manager / superadmin — an oversight-tier
permission, not given to day-to-day HR staff).

The connected journey also includes **My Onboarding Work** for the signed-in internal
participant and a separate **Worker Onboarding** experience reached through the secure
invitation. Neither surface is a duplicate Case Detail page.

---

## 1. Onboarding Overview

**Purpose:** the landing dashboard — case health at a glance + the full case list.

**Header**
- Icon + "HR" eyebrow + title "Onboarding"
- Subtitle: "Activation readiness, active cases & onboarding health — a customizable board."
- Meta chip: case count, e.g. "1 cases"
- Profile pill (current user name + role) + notification/message/ticket icon buttons
- "Customize" button (manager+ only) — toggles drag/resize edit mode on the widget board

**KPI tiles (top row, 4 compact tiles)**
1. **Active Cases** — big number (total active cases), delta line ("↑/↓ N% over recent weeks"), sub-line ("N new · N transfers · N contractors"), small sparkline chart of the last 8 weeks.
2. **Due This Week** — big number (tasks due in next 7 days), delta line (overdue count, red if >0), sub-line ("N today · N overdue · N critical"), small bar chart.
3. **Blocked Cases** — big number (cases with an open blocker), sub-line ("N docs · N training · N HSE · N payroll" — breakdown of what's blocking), small bar chart.
4. **Activation Readiness** — big number (% of cases ready to activate), sub-line ("N% profile · N% training · N% access"), small ring/donut chart.

*(A 5th tile, "Onboarding Health", is available as an optional add — a derived Good/Watch/At Risk label with a trend chart, not shown by default alongside the four above.)*

**Analytics widgets (below the cases table)**
5. **Package Readiness** — one row per active package: package label + active-case count, a percentage bar, and the readiness %. Example rows: "Standard Employee (34) — 82%", "Contractor Worker (19) — 64%".
6. **Recent Activity** — a feed of the last 8 onboarding events across ALL cases and packages: an icon, a humanized action label (e.g. "Package created", "Task completed"), the actor's name (or "System"), and a relative timestamp ("2h ago").

**Toolbar (above the cases table)**
- Search box — placeholder "Search employee, case no, package…"
- Status dropdown — "All statuses" / Draft / Open / In Progress / Blocked / Paused / Ready / Completed / Cancelled
- "Advanced filters" button — opens a tabbed dropdown with 3 tabs:
  - **Package** — multi-select checkboxes, one per active package
  - **Worker Type** — multi-select checkboxes (full_time, contractor, etc.)
  - **Status** — single-select groups for Due (Overdue / Due Today / Due This Week), Blocking (Blocked / Not Blocked), Readiness (Ready / Not Ready)
- "Packages" button (gated, see above)
- "New Case" button (red, primary) — opens the wizard

**Cases table**
| Column | Content |
|---|---|
| Employee | avatar + name, case no + employee no underneath (e.g. "Ervin Baptiste" / "ONB-2026-0053 · EMP-0019") |
| Package | package label (e.g. "Standard Employee") |
| Owner | owner's name, or "Unassigned" |
| Due Date | formatted date or "—" |
| Progress | thin progress bar + percentage (e.g. "17%") |
| Blockers | red count pill if >0, else "—" |
| Status | status pill (In Progress / Blocked / Ready / Completed / etc., color-coded) |

Row click → opens Case Detail. Pagination footer: "Showing X to Y of Z results", page
buttons, rows-per-page selector (10/25/50).

---

## 2. Start Onboarding wizard (full page)

Opened via "Start Onboarding". This is a full-page `WizardShell`, not a modal. It
captures only decisions HR must make; package-generated work remains read-only.

1. **Employee & Timing** — search Employee Master by name, employee number or work email
   and select one canonical employee record. The selected result shows name, number,
   role and department. A separate read-only facts panel shows worker category,
   employment type, department and role from the employee's current assignment; these
   values drive package eligibility and cannot be overridden here. Incorrect facts are
   corrected through **Review in Employee Master**. If no employee record exists,
   **Create Employee Record** opens the existing Employee Master create flow and returns
   the new employee to the wizard. This step captures only reason, target start date,
   priority and accountable case owner as onboarding-specific inputs.
2. **Package** — choose from active packages compatible with the employee's worker type,
   department, site and role. Each card shows version, lead time and generated totals.
   The selected card expands a concise generated-plan preview.
3. **Optional Work** — add approved extras from a searchable package action library.
   Managers additionally see **Create One-Off Action** for case-specific work that does
   not change the reusable package. Ownership appears only for unresolved routes:
   team/department owns the queue and a named person is accountable when available.
   Required package work remains locked.
4. **Documents** — show a required/ready/needs-action summary, collapse verified
   Employee Master documents, and require one disposition for every unresolved
   requirement: upload a real committed document, request it securely from the employee,
   use an eligible existing record, or record an authorised waiver. Each card states
   case-launch and Day-One impact. Waiver is separately permission-gated and requires a
   reason; outstanding evidence becomes tracked work rather than disappearing.
5. **Review & Launch** — show one server-authoritative Ready or Blocked banner, the
   frozen work SIOMAC will create, and only the unresolved follow-ups that continue after
   launch. Passed technical checks are collapsed for inspection. The employee summary is
   not repeated because it remains in the wizard rail. Launch disables after one click,
   re-runs the same preflight used by the page, creates the complete governed case
   atomically and opens Case Detail only after every required record and side effect
   commits. A validation error returns the user to the relevant step; there is no
   redundant confirmation modal.

The page uses the shared SIOMAC skeleton while its employee, package, preview, document
and ownership datasets load. Save Draft and Scheduled Launch are not visible until their
backend lifecycles exist.

---

## 3. Onboarding Case Detail

**Purpose:** the focused operating page for one case. The default Overview answers four
questions only: what needs action next, what blocks readiness, which domains are ready,
and whether account activation needs action. Detailed history and work management stay
in their dedicated tabs.

**Header**
- Back link: "← Onboarding Cases"
- Icon + "HR · Onboarding" eyebrow + employee name as title (e.g. "Ervin Baptiste")
- Subtitle: case no + package label (e.g. "ONB-2026-0053 · Standard Employee")
- Meta chips: status ("In Progress"), progress ("17% complete"), due date ("Due —")
- Primary actions: **View Employee Record** and **Review Readiness**.
- A **More** menu contains Customize Overview, Reassign Owner, Pause and Cancel. This
  keeps destructive and infrequent controls out of the primary action row.
- The joined profile strip uses approved Concept 01, **Navy Identity Anchor**: the
  employee identity is the only navy cell, followed by package, case owner, current
  stage and case status in equal white operational cells. Department is not repeated as
  its own cell because it is already part of the employee identity. Match Employee
  Master's drawer treatment: each operational label has a restrained icon tile,
  title-case copy, a readable value and one secondary line; the case owner retains the
  profile photo beside the name.

**Focused default Overview (4 widgets)**

1. **Priority Tasks** — only the next urgent work, with status, owner, deadline and direct
   action. The complete task list, including package and case-specific actions, lives in
   Tasks. Use a neutral white work-list with aligned Task, Owner, Due and Action columns.
   State icons, buttons and row surfaces remain neutral; semantic colour is reserved for
   the compact status tag only. Due dates use a quiet calendar fact treatment, with only
   overdue helper copy using warning colour. Tags use title case and medium weight. Do
   not repeat task-workspace links because the Tasks tab is persistent navigation.
2. **Activation Readiness** — a compact semantic gauge in the right rail. Its
   red–amber–green treatment is reserved for readiness meaning; surrounding widget
   decoration remains neutral.
3. **Readiness by Domain** — the approved six-domain matrix with gate status,
   completion, task coverage, blockers and accountable team.
4. **Key Blockers** — compact critical/high issues first, with owner, age and drill-down.

The former seven-stage Onboarding Progress strip is removed. Current Stage owns a compact
progress bar inside the profile strip, with its percentage placed to the right. The case
navigation remains a separate full-width card beneath the profile strip. Its active tab
fills the complete tab segment with a quiet grey surface and no accent line. Task and
handoff counts use neutral badges; only the Blockers count uses red because it signals
an active issue. The compact 44px navigation uses one neutral 16px icon per section;
icons inherit navy only on hover or when active. Priority Tasks begins directly beneath
the navigation.

Account Activation is not a standalone widget. When action is required, it appears as an
Access-owned Priority Task and opens the governed provisioning/request dialog. After
provisioning, ongoing account details belong to Employee Master → Access.

The provisioning dialog follows one visible lifecycle:

1. **Preflight** — verify the Employee Master record, start date, personal delivery
   address, unique proposed work email, access profile and configured operating model.
2. **Queued** — create one accountable work item for automation, IT/Admin, or delegated
   HR. HR can monitor it but does not gain technical permissions merely by coordinating.
3. **Identity created** — the SIOMAC identity and approved baseline exist. External
   mailbox creation is a separately confirmed outcome and is never inferred from the
   proposed email address.
4. **Activation pending** — send a single-use activation method to a verified destination;
   HR never sees or chooses the employee's password.
5. **Activated** — keep remaining day-one access work in onboarding, then manage durable
   MFA, account health, access assignments and support in Employee Master → Access.

An account may be created and activated before the onboarding case is complete. Activation
does not bypass document, HSE, training, payroll or application-access gates.

**Case dialogs**

Every visible case action opens a complete dialog; no action may end in a generic prompt
when it needs ownership, evidence, authority or routing data. The approved dialog set is:

- blocker detail, escalation and tracked owner notification;
- restricted evidence preview, download and specialist approve/return decision;
- task detail, reassignment, unblock, add task, replacement evidence and task note;
- handoff detail, reassignment, completion and workstation-evidence confirmation;
- case-owner reassignment, message compose/preview, failed-delivery recovery and audit
  export;
- account-provisioning lifecycle, readiness review and the generic confirmation used
  only for simple pause/cancel-style case transitions.

Nested dialogs return to their originating task, handoff or blocker. Specialist decisions
remain capability-gated; HR coordination never implies HSE, medical or IT approval.

Recent Activity, Handoff Summary, Case Actions, Upcoming Tasks and Communications
Summary remain available through the widget library, but are not default widgets.
Timeline is the authoritative activity view; Handoffs is the authoritative cross-team
workspace; case-specific actions are rows in Tasks rather than a parallel task system.

**Dedicated tab responsibilities**

- **Tasks** is the complete work queue. It supports search, status/owner/due filters,
  package tasks and clearly labelled case-specific actions. The right summary calls out
  overdue, unassigned and evidence-review work rather than repeating general progress.
- **Handoffs** is the receiving-team workspace. Every row shows the responsible team,
  accountable person where assigned, acceptance state, expected outcome and latest
  deadline/evidence state. HR coordinates; the receiving team performs specialist work.
- **Blockers** is the exception-resolution workspace. It owns severity, accountable
  owner, age, evidence, readiness impact, reminders, escalation and authorised review.
- **Communications** owns case-linked messages and delivery state. It supports recipient,
  channel and delivery-state filtering, failed-delivery recovery and related-work context.
- **Timeline** is the readable chronological history. Each event links back to its
  authoritative task, handoff, communication or audit entry; it does not replace Audit.
- **Audit** is permission-gated evidence of governed change: actor, action, reason,
  before/after state and correlation metadata. Export requires the same audit authority
  and a recorded business reason.

---

## 3A. My Onboarding Work

**Purpose:** a role-scoped execution queue for the signed-in employee and, where
permission allows, their accountable department.

- Defaults to **Assigned to me**; changing to a team queue requires target-population
  authority.
- Combines tasks, handoffs and evidence review into one read model without creating a
  second work store.
- Shows the owning queue and accountable person separately. Unassigned work remains
  visible in its department queue.
- Opens the authoritative Case Detail tab and selected record.
- Supports due-state and work-type filters plus personal saved views.

---

## 3B. Worker Onboarding

**Purpose:** the secure pre-hire experience reached from the invitation link. It is not
the internal Case Detail page.

- Shows only worker-owned tasks and worker-safe status.
- Supports personal-data confirmation, secure document upload, forms/e-signature,
  welcome content, key people and Day-One instructions.
- Never exposes internal blockers, audit history, routing queues, specialist decisions
  or other employees.
- Writes accepted personal data and verified documents to their authoritative Employee
  Master records while retaining the onboarding task link.
- Uses an expiring, single-use activation flow and a verified destination; HR never
  communicates or selects a password.

---

## 4. Package Manager

**Purpose:** one governed workspace for finding packages and configuring the selected
definition. Do not split selection into a permanent narrow left rail or send the user to
a separate detail page.

Published packages are immutable. **Create Draft Version** copies the current definition
into an isolated draft; review and publish produce a new version for future cases.
Existing cases remain locked to the version frozen at launch. Package retirement requires
a reason and only removes the package from future selection.

**Top package register**
- Full-width card at the top of the main column above the package workspace, not a left
  library. The persistent context rail begins beside it and serves the entire page.
- Header contains search plus status and worker-type filters.
- A 2 × 2 visual register shows all four package cards on one desktop page. Each uses a
  large, recognisable package-type icon and shows package name, lifecycle state,
  description, version, active-case count, task count and handoff count without becoming
  a dense mini-table.
- The selected card uses a quiet blue border and surface; never a left accent.
- New Package remains the primary page-level action.
- Retired packages stay visible for history but are excluded from launch selection.

Real seeded packages: Contractor Worker (7 tasks·1 handoff), Office / Admin (14·1),
Safety-Critical Employee (20·3), Standard Employee (18·3), Supervisor / Manager (19·3)
— all currently "active".

Selecting a package updates the full-width workspace below without navigating away.

**"New Package" modal fields:** Label, Description (textarea), Default SLA (days,
number), Default owner role (text), Worker types (comma-separated text, e.g. "full_time,
contractor"). The package key is auto-generated from the label and shown greyed-out
("locked after create") — not user-editable.

---

## 5. Selected Package Workspace

**Purpose:** understand one package quickly, then configure each controlled part without
losing package context.

**Header**
- Package name, lifecycle state, description, published version, package owner and next
  policy-review date.
- Published versions expose **Preview Package Plan** and **Create Draft Version**.
  Duplicate, Compare Versions and permission-gated Retire live under **More** so the
  destructive action is not permanently prominent.
- **Preview Package Plan** first shows a concise summary, then **Open Full Plan** opens a
  complete read-only stage, outcome and ownership view. It must never end in a toast or
  imply that a case was created.
- A concise read-only banner explains that active cases remain frozen to their launch
  version.

**Tabs:** Overview · Work Plan · Handoffs · Requirements & Gates · Worker Portal &
Account · Communications · Governance & Versions.

### Tab: Overview

- Five-item at-a-glance strip: lead time, required tasks, handoffs, Day-One gates and
  active cases. Version belongs in the header and is not repeated.
- The selected-package workspace uses a main configuration column and a persistent right
  rail across every tab. The rail holds **Package Health**, **Operating Defaults** and the
  current draft/review state. Package Definition and Package Eligibility remain in the
  main Overview column; do not add a redundant quick-settings widget.
- Eligibility is driven by Employee Master facts: worker category, employment type,
  department, site and role.
- **Test a match** selects an Employee Master record, explains every match and warns when
  two published packages have equal priority.
- Do not repeat ownership or review-cycle facts inside Package Definition after they are
  shown in the persistent rail.

### Tab: Work Plan

Group tasks by **Before Start**, **Day One**, and **First Week**. Every row shows task,
performer, accountable queue, relative due rule, requirement type and prerequisite.
The task dialog also captures completion evidence and worker visibility. A worker can
perform a task without becoming the internal accountable owner.
Provide task search, accountable-team filtering and a governed bulk-change dialog. Bulk
changes apply only to a draft and require a version-history reason.

Real example rows (Standard Employee): profile_confirmation → "Confirm employee
profile" (Hr), document_collection → "Collect contract & documents" (Hr),
emergency_contact → "Confirm emergency contact" (Hr), welcome → "Welcome the new hire"
(Supervisor), schedule_confirmation → "Confirm schedule" (Supervisor),
first_week_checkin → "First-week check-in" (Supervisor), account_invite → "Send
account invite" (It), plus MFA/access/equipment steps — 18 total.

### Tab: Handoffs

Use a compact table rather than large cards. Each handoff defines the durable queue,
case-person resolution rule, expected outcome, relative due rule, evidence expectation,
fallback and escalation. The department owns the work type; the resolved person is
accountable for the specific case.

### Tab: Requirements & Gates

Requirements are filterable by Documents, Training, HSE, Access and Payroll. A document
rule captures provider, accepted formats, expiry rule, reviewer, due rule and waiver
authority. A gate captures the business outcome, linked conditions, accountable owner,
activation impact, waiver authority and escalation. Every gate shows what evidence or
control satisfies it. Gates are outcomes, not duplicate tasks.

### Tab: Worker Portal & Account

Configure Welcome, Personal Details, Documents & Forms and Prepare for Day One. Preview
the Worker Portal from the package. The package controls content, invitation timing and
the account-readiness gate; Global Settings controls which authorised HR, IT/Admin or
automation route performs account setup. Never encode organisation ownership in each
package.

### Tab: Communications

The product and dependency audit for this workspace is
`docs/ONBOARDING_EMAIL_STUDIO_AUDIT.md`. The approved direction is a native
Preact/Vite/TypeScript editor inside SIOMAC's Payslip Studio visual shell. SIOMAC owns the
allow-listed component schema, ordered canvas, contextual inspector, governed data/assets,
permissions, backend compiler and immutable revision lifecycle. React Email, GrapesJS,
Unlayer and the former HTML mockup editor are not implementation sources or fallbacks.

Each message has an event trigger, audience, language, channel, template, enabled state
and delivery-failure action. Support preview and test delivery without emitting a real
case event. The Communications tab is the template register. **Add message** and **Edit**
open a dedicated full-page, package-scoped email workspace—not a large dialog. That
workspace keeps the selected package and template in its header, provides approved
content blocks and personalisation tokens, and shows a live desktop/mobile preview.
Reuse the proven Payslip Studio shell and theme: persistent dark toolbar, dark left palette,
dotted centre stage, contextual right properties inspector, geometry-matched skeleton and
bottom status bar. The native editor supplies selection, visible drag/drop positions, nested
column drops, outline, history, bounded sizing and commands against its controlled schema.
Unlike the payslip canvas, email content is an ordered responsive block flow rather than
freely positioned elements. Dragging reorders or inserts rows; it never stores x/y
coordinates, arbitrary widths or browser-only CSS. The WYSIWYG canvas supports headings,
rich text, lists, links, buttons, employee profile, information panels, dividers, spacing,
two-column sections and uploaded images. The employee profile block resolves the selected
case's Employee Master photo, full name and job title at render time. Its photo is circular,
has fixed dimensions and alternative text, and falls back to the governed initials avatar
when no approved employee photo exists.
Images come from a governed package asset library with upload/replace, file validation,
alternative text and desktop/mobile preview.
SIOMAC stores versioned structured blocks, never canvas HTML. Preview, test and delivery
all use the same server compiler, which produces multipart plain-text + HTML output using
client-safe table layout, inline styles, declared dimensions and allow-listed links/tokens.
The compiler has a named compatibility profile (for example `email-html-2026-01`). A
profile is upgraded through dependency/security review, fixture compilation, strict
validation and the supported-client render matrix; it is never silently switched to a
new upstream release at runtime. The server-rendering slice should assess a pinned MJML
compiler behind SIOMAC's own compiler interface, and must not add it if dependency review
finds a known vulnerability. MJML is not editor state. Raw HTML/MJML blocks and unrestricted
includes remain disabled.
Onboarding Settings supplies the default brand shell, sender identity, security notice
and approved destinations. The package Email Studio may select approved logo assets,
change the header label/approved colour and add footer context. It may not remove the
required security notice or use an unapproved sender/destination. Case Detail may preview,
resend and inspect delivery state, but it never edits package templates.

### Tab: Governance & Versions

Show draft, ready-for-review, published and superseded versions with owner/reviewer,
reason and affected-case count. Before publish, show concise checks for eligibility
conflicts, task/handoff ownership, gate evidence links and assigned reviewer. Support a
focused version comparison. Publishing a reviewed draft affects future cases only.

The package manager must support loading, empty, no-results and error states using the
shared SIOMAC skeleton and error treatment. Skeleton geometry follows the full-width
package register plus selected-package workspace; it must not restore the removed left
rail.

**Package dialogs**

All package actions use the shared SIOMAC dialog shell with a clear context statement,
complete fields, permission consequences and a specific final action. The approved set
covers package summary preview, full generated-plan preview, create/draft/retire/
duplicate, employee match testing, task and handoff configuration, bulk task change,
requirement and gate configuration, Worker Portal content, communication preview and
test delivery, complete version comparison and publish review. Email template editing is
the deliberate exception: it uses the dedicated package-scoped workspace because its
content tools, metadata and live preview need full-page space.
Draft-only actions must say so in the dialog. Publish and retire dialogs show affected
case protections before confirmation. An action labelled **Open**, **View** or
**Preview** must open its real destination; it may not be represented by a generic toast.

---

## End-to-end operating journey

The module is one journey with four role-specific surfaces. Do not make Case Detail or
the launch wizard carry every participant's work.

### 1. Configure once

- **Onboarding Settings** defines the operating model, default routing queues,
  escalation timing, communication sender, account-provisioning ownership and which
  roles may waive or approve requirements.
- **Packages** define reusable eligibility rules, required work, documents, training,
  handoffs, communications and Day-One gates. Publishing freezes a version; editing a
  package never silently rewrites an active case.

### 2. Start from one worker record

- The worker is selected from **Employee Master** or arrives from an approved recruitment
  intake. SIOMAC never creates a second person record inside onboarding.
- Employee Master remains authoritative for identity, employment type, department,
  role, manager and location. The wizard may send HR back to correct those facts, but
  cannot override them locally.
- The server checks for an active duplicate, compatible package versions, start-date
  feasibility and required owners before HR can continue.

### 3. Review and launch the generated plan

- The wizard contains only five decisions: Employee & Timing, Package, Optional Work,
  Documents, and Review & Launch.
- Package work is a read-only generated preview. HR may add approved case-specific work
  without editing the reusable package.
- Launch freezes the package version and atomically creates the case, tasks, handoffs,
  document requests, communications, provisioning intent, gates, events and audit trail.
  A partial case must never become visible.

### 4. Execute through separate work views

- **HR Portfolio** answers which cases, deadlines and blockers need coordination.
- **Case Detail** is the control record for one case. Overview is exception-focused;
  Tasks, Handoffs, Blockers, Communications, Timeline and Audit remain authoritative.
- **My Work / team queues** show only work assigned to the signed-in person or their
  accountable department. Specialists complete and approve their own work; HR follows
  up without inheriting specialist authority.
- **Worker Onboarding** is a separate secure pre-hire experience for personal-data
  collection, documents, forms/e-signature, welcome information, key people, Day-One
  instructions and worker-owned tasks. This surface is required and is not yet represented
  by the current internal HR mockups.

### 5. Recalculate readiness and complete

- Readiness is calculated from required gates, not manually typed and not inferred from
  task percentage alone.
- A task can be complete while its evidence still awaits an authorised decision. The
  related domain remains at risk or blocked until that decision is recorded.
- Account activation may occur before onboarding completes, but it does not bypass
  document, HSE, training, payroll or application-access gates.
- **Complete Case** is available only when required gates are ready or an authorised,
  reasoned exception exists. Completion records the frozen outcome and closes remaining
  onboarding-only work.

### 6. Hand durable data to Employee Master

- Verified documents, employment facts, training outcomes, payroll readiness and access
  assignments become durable Employee Master records.
- Onboarding retains its immutable case plan, task/handoff history, communications,
  decisions and audit trail.
- Rehire, internal transfer, delayed start, cancellation and restart are explicit case
  types/transitions. They must not create duplicate workers or silently mutate a completed
  case.

### Flow simplifications

- Do not restore a duplicate Employee Snapshot card on Case Detail.
- Do not create separate “case action” and task systems.
- Do not show both a seven-stage journey strip and a readiness gauge.
- Do not make Account Activation a permanent overview widget; show it as Access-owned
  priority work only while action is required.
- Do not let the launch wizard become a package editor.
- Do not expose all participant work to every role. Scope Portfolio, My Work, case actions
  and approvals by permission, target population and assignment.

---

## Shared visual language (for consistency in a mockup)

- **Reuse before styling:** Command Centre KPIs use Employee Master's shared `KpiTile`
  component and skeleton treatment. Upcoming Deadlines and Tasks are the registered
  `enterprise.calendar.upcomingDeadlines` and `enterprise.calendar.taskPlanner` widgets;
  onboarding configures them rather than copying them.

- **Status pill colors:** gray = draft/inactive/cancelled, blue = in progress, green =
  active/ready/completed, amber = paused/warning, red = blocked/overdue/critical,
  purple = used sparingly for one KPI accent (readiness/activity).
- **Cards:** white background, thin light-gray border, 10–12px radius, small icon chip
  top-left of each section header.
- **Tables:** uppercase gray column headers, hairline row dividers, hover highlight,
  compact "mini" action buttons per row.
- **KPI tiles:** icon + label caption row, one large focal number, a small chart
  (sparkline / bar / ring / gauge) and a one-line sub-stat footer.

The final cross-page visual, role and redundancy decisions are recorded in
`docs/ONBOARDING_PRODUCTION_UX_AUDIT.md`. That audit and the canonical
`*-implementation-ready.html` references override older exploratory concepts.
