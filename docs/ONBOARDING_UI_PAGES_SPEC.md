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
       ├─ "New Case" button       → Start Onboarding wizard (modal)
       └─ "Packages" button       → Package Manager (list)
                                        └─ click a package row → Package Detail (3 tabs)
```

Package Manager / Package Detail are only visible to users holding
`hr.onboarding.packages.manage` (admin / hr_manager / superadmin — an oversight-tier
permission, not given to day-to-day HR staff).

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

## 2. Start Onboarding wizard (modal)

Opened via "New Case". A single modal with sequential steps:

1. **Package** — pick an employee (search/select) and an onboarding package (cards showing package label, worker types, task/handoff counts).
2. **Preview** — read-only preview of what the chosen package will instantiate: the task list (title + owner role) and the cross-module handoffs it will create.
3. **Actions** — checkboxes for each of the package's custom action templates (e.g. "Manager welcome call", "Assign onboarding buddy"); required ones are locked on; optional ones can be excluded.
4. **Options** — reason (new hire / transfer / rehire…), priority, target start date, launch mode, case owner (assignee), worker type override.
5. **Review** — summary of every choice above, including "Custom actions: N of M included", then "Start Onboarding" to submit.

---

## 3. Onboarding Case Detail

**Purpose:** the working page for one case — a customizable board of glanceable tiles + functional task/blocker/handoff/custom-action tables.

**Header**
- Back link: "← Onboarding Cases"
- Icon + "HR · Onboarding" eyebrow + employee name as title (e.g. "Ervin Baptiste")
- Subtitle: case no + package label (e.g. "ONB-2026-0053 · Standard Employee")
- Meta chips: status ("In Progress"), progress ("17% complete"), due date ("Due —")
- Lifecycle action buttons (contextual to status): Pause / Resume / Mark Ready / Complete / Provision / Cancel
- Owner selector (dropdown of employees, "Unassigned" default)
- "Customize" button (manager+ only)

**Default board (4 KPI tiles + 6 functional widgets)**

KPI tiles (top row):
1. **Package Progress** — gauge arc, big % in the center, "On track/Behind/Complete" label, footer: Done / Open / Blocking counts.
2. **Activation Readiness** — ring chart, big % in the center ("ready"), footer: Docs % / Training % / Access %.
3. **SLA Countdown** — gauge, big number of days left (or overdue), footer: target date + status label ("On track"/"Due soon"/"Overdue").
4. **Team** — case owner (name + avatar initials), a stack of assignee avatars pulled from the case's tasks.

Functional tables:
5. **Active Tasks** (+ Add button) — columns: Task (title, "blocking" red tag if applicable), Assignee (dropdown to reassign), Due, Status (pill), Actions (Complete / Block / Unblock buttons). Example rows: "Confirm employee profile — Completed", "Welcome the new hire — Pending — Supervisor", "Send account invite — Pending — IT".
6. **Blockers** — columns: Blocker, Module, Severity (pill), Status (pill), Actions (Resolve / Escalate / Waive).
7. **Custom Actions** (+ Add button) — columns: Action, Type, Status (dropdown to change), Actions (Complete / Cancel).
8. **Handoffs** (read-only) — columns: Module, Type, Owner, Status (pill), Last event (timestamp).
9. **Recent Activity** — feed of the last 5 audit events for this specific case (action + actor + relative time).
10. **Account Provisioning** — battery-style fill gauge showing % of provisioning steps done, footer: Work email / Login / Mailbox each tagged Done/Pending/—.

*(Optional extra tiles available via the widget library but not shown by default: a bold "Blockers" hero tile, Training %, Approvals list, Due This Week list.)*

---

## 4. Package Manager (list)

**Purpose:** admin configuration screen — create/activate/retire onboarding packages.

**Header**
- Back link: "← Onboarding"
- Icon + "HR · Onboarding" eyebrow + title "Packages"
- Subtitle: "Configure onboarding packages, task & handoff templates, and custom actions."
- Meta chip: package count (e.g. "5 packages")
- "New Package" button (primary)

**Toolbar:** search box ("Search packages…") + status dropdown (All / Draft / Active / Retired).

**Table**
| Column | Content |
|---|---|
| Package | label (bold) + key · version underneath, e.g. "Standard Employee" / "standard_employee · v1" |
| Status | pill: active (green) / draft / retired (gray) |
| Worker Types | comma list, e.g. "employee", or "contractor, contractor_worker" |
| Templates | "N tasks · N handoffs", e.g. "18 tasks · 3 handoffs" |
| SLA | "N days" |
| Actions | single contextual button: "Activate" (if not active) / "Retire" (if active) |

Real seeded packages: Contractor Worker (7 tasks·1 handoff), Office / Admin (14·1),
Safety-Critical Employee (20·3), Standard Employee (18·3), Supervisor / Manager (19·3)
— all currently "active".

Row click → Package Detail.

**"New Package" modal fields:** Label, Description (textarea), Default SLA (days,
number), Default owner role (text), Worker types (comma-separated text, e.g. "full_time,
contractor"). The package key is auto-generated from the label and shown greyed-out
("locked after create") — not user-editable.

---

## 5. Package Detail

**Purpose:** configure one package's task templates, handoff templates, and custom
actions.

**Header**
- Back link: "← Packages"
- Icon + "HR · Onboarding" eyebrow + package label as title (e.g. "Standard Employee")
- Status pill next to the title (Active/Draft/Retired)
- Subtitle: key · version (e.g. "standard_employee · v1")
- Meta chips: status, SLA ("10 day SLA"), default owner role ("Hr")
- Actions: "Edit details" button, and a contextual status-transition button (Activate /
  Retire / Restore to draft)

**Tabs:** Task templates (N) · Handoff templates (N) · Custom actions (N)

### Tab: Task templates
Table columns: **#** (sort order), **Key** (e.g. "profile_confirmation"), **Title**
(e.g. "Confirm employee profile"), **Owner** (role, e.g. "Hr", "Supervisor", "It"),
**Module**, **Blocking** (yes/—), **Evidence** (yes/—), **Actions** (Edit / Delete).
"+ Add" button opens a modal: Task key (locked once created), Title, Owner role,
Module key, Sort order, plus checkboxes "Blocks activation until complete" / "Requires
evidence to complete".

Real example rows (Standard Employee): profile_confirmation → "Confirm employee
profile" (Hr), document_collection → "Collect contract & documents" (Hr),
emergency_contact → "Confirm emergency contact" (Hr), welcome → "Welcome the new hire"
(Supervisor), schedule_confirmation → "Confirm schedule" (Supervisor),
first_week_checkin → "First-week check-in" (Supervisor), account_invite → "Send
account invite" (It), plus MFA/access/equipment steps — 18 total.

### Tab: Handoff templates
Table columns: **#**, **Key**, **Target module**, **Type**, **Required** (yes/—),
**Actions** (Edit / Delete). "+ Add" modal: Handoff key (locked once created), Target
module, Handoff type, Sort order, "Required" checkbox.

### Tab: Custom actions
*(This tab is the Custom Action Template Manager.)* Table columns: **Name**, **Type**
(Task / Checklist Item / External Action / Handoff / Document Request / Training
Request / Approval / Notification), **Owner** (role or employee id), **Priority**
(pill: Low/Normal/High/Critical), **Required** (yes/—), **Blocks** (yes/—), **Active**
(yes/—), **Actions** (Edit / Retire). "+ Add" modal fields: Action name, Type
(dropdown), Priority (dropdown), Owner type (Role/Employee/Department/System/External)
→ conditional Owner role or Owner employee id field, Due offset (days), and — only when
Type is "Approval" — a Workflow template ID field; checkboxes for Required / Blocks
activation / Requires evidence. Empty state: "No custom action templates yet." (e.g.
the seeded "Standard Employee" package currently has none).

---

## Shared visual language (for consistency in a mockup)

- **Status pill colors:** gray = draft/inactive/cancelled, blue = in progress, green =
  active/ready/completed, amber = paused/warning, red = blocked/overdue/critical,
  purple = used sparingly for one KPI accent (readiness/activity).
- **Cards:** white background, thin light-gray border, 10–12px radius, small icon chip
  top-left of each section header.
- **Tables:** uppercase gray column headers, hairline row dividers, hover highlight,
  compact "mini" action buttons per row.
- **KPI tiles:** icon + label caption row, one large focal number, a small chart
  (sparkline / bar / ring / gauge) and a one-line sub-stat footer.
