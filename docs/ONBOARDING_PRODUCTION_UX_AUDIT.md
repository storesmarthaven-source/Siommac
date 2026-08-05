# Onboarding Production Visual and UX Audit

Status: approved mockup baseline for implementation. The HTML references are the design
source; Claude implements them in Preact with the SIOMAC UI kit and authenticated APIs.

## Final information architecture

| Surface | Primary user | Purpose | Must not become |
| --- | --- | --- | --- |
| Command Centre | HR staff and HR managers | Today's operational work, upcoming starts, deadlines, blocked cases and a focused case | A second case register or analytics report |
| Insights | HR managers | Trends, capacity, package performance and bottleneck analysis | The staff landing page |
| Work Queue | HR staff | Assigned and team work with due-state filters and fast actions | A duplicate Case Detail page |
| Case Detail | HR staff, managers and specialist owners | The authoritative record for one onboarding case | An Employee Master replacement |
| Start Onboarding | Authorised HR staff | Select an Employee Master record and launch a governed package | An employee-creation wizard |
| Packages | Package administrators | Versioned package design, audience rules, work, gates and communications | Live case management |
| Onboarding Settings | HR managers/admins | Organisation-wide routing, provisioning and invitation policy | Package-specific configuration |
| Email Studio | Package administrators | Edit a package communication template | A global marketing-email product |
| Worker experience | Employee/worker | Complete requested work, upload evidence and see next steps | The HR Command Centre |

Navigation is role-aware. HR staff see Command Centre, Work Queue and cases they may
operate. HR managers additionally see Insights. Package and Settings links appear only
with their management capabilities. Hidden authority is not represented by disabled
controls.

Cross-case visibility uses explicit scope permissions. `hr.onboarding.view` is the base
own/assigned/participant scope, `hr.onboarding.view_team` permits the HR team scope, and
`hr.onboarding.view_all` permits the organisation-wide scope. Grant `view_team` and
`view_all` to `hr_manager` and `admin`; `superadmin` receives them through its normal
catalogue rule. Do not grant either key to `hr_staff` or the generic `manager` role.
Line managers participate through assigned work or an explicitly scoped case relationship,
not through blanket HR-team visibility.

## Page decisions

### Command Centre

Keep the page operational and exception-first:

- Four summary measures: due today, overdue actions, starts within seven days and owner
  required.
- A small readiness chart, Upcoming Deadlines and Tasks in the first working band.
- Upcoming Starts before the Team Work Queue.
- A focused case in the left rail and Blocked Cases immediately beneath it.
- One full-width Team Work Queue with a single row action.

Implementation reuse is mandatory here. The four summary measures use the same shared
`KpiTile` composition and visual treatment as Employee Master (`KpiTile` inside the widget
board); do not create onboarding-only KPI card markup or CSS. Upcoming Deadlines reuses
`enterprise.calendar.upcomingDeadlines`, and Tasks reuses
`enterprise.calendar.taskPlanner`. Configure those registered widgets for the onboarding
page and pass authorised onboarding/calendar data through their existing contracts. Do not
copy their JSX, CSS, skeletons or interaction logic into the onboarding module.

Remove duplicate links and duplicate counts. The focused case is a shortcut into Case
Detail, not a drawer containing the whole case. Charts appear only when a comparison or
trend helps a manager decide; decorative sparklines are prohibited.

### Insights

This is the only analytics-heavy onboarding page. Use Chart.js with accessible legends,
tooltips and a table alternative. Required views are readiness trend, starts versus ready,
blocker mix, time-to-ready, package performance and owner workload. Every chart must have
a real historical or aggregate source; no fabricated trend deltas.

### Work Queue

Use one table with saved filters, due-state tabs and a clear selected row. The optional
quick-work panel may support a single decision without navigation, but must never mirror
all Case Detail tabs. Staff defaults to My Work; managers may switch to Team Work.

### Case Detail

The top profile strip contains the employee, package, case owner, current stage and case
status. It links to Employee Record instead of repeating an Employee Snapshot card.

The Overview is deliberately focused:

- Priority Tasks and Key Blockers first.
- Readiness by Domain as a matrix, not several competing readiness gauges.
- Recent Activity and Case Actions below the matrix at the same width.
- Account provisioning is shown only while setup, request or invitation work is active.
  Once activated, ongoing access administration belongs to Employee Record > Access.

Tasks, Handoffs, Blockers, Communications, Timeline and Audit retain their dedicated tabs.
Overview summaries link to those tabs instead of duplicating their full contents.

### Start Onboarding wizard

Five steps only:

1. Employee and timing: typeahead an existing Employee Master record; employment facts
   are read-only and determine eligible packages.
2. Package: compare compatible packages side by side, show one adaptive match/lead-time
   banner, and summarize what SIOMAC will create.
3. Optional work: add approved case-specific tasks without mutating the package.
4. Documents: review requirements, delivery method, owner and due date; explicitly record
   justified exceptions.
5. Review and launch: validate ownership, duplicates, dates and required work, then create
   the frozen case atomically.

The summary rail shows the selected employee and current decisions. It is a summary, not a
second form. A failed check links back to the exact step and field. Launch cannot claim
success until every required record and side effect commits.

### Package Management

The Package Register uses a two-by-two card page with paging controls. The selected package
opens a two-column workspace: editable package content on the left and a narrow governance
rail on the right. The rail is reserved for package health, publication/version state,
default ownership, worker invitation policy and next review.

Audience rules are necessary but concise: employment types, departments, sites, roles and
worker category. Show conflict validation near the rules, not as permanent promotional
copy. Package tabs cover details, tasks, handoffs, documents, training/HSE, communications,
escalations and activation gates. Publishing freezes a new version; active cases remain on
their original version.

### Settings

Use the existing Settings shell. Onboarding Settings owns operating model, account owner
routing, HR fallback when no IT team exists, invitation timing, sender identity, escalation
defaults and retention. Package-specific task/email content stays in Packages. Non-current
Settings destinations must not be fake links in the mockup.

### Email Studio

The editor opens as its own routed page from Packages > Communications. It starts from a
blank or selected governed template and uses an ordered responsive block model. The
production implementation reuses the SIOMAC/Payslip Studio shell language but not its
free-position document canvas.

Required capabilities: drag/reorder, insertion guides, text, image, employee profile photo,
button, divider, spacer, columns, governed variables, desktop/mobile preview, block outline,
contextual properties, undo/redo, revisions, test send and draft save. Generated delivery
HTML must be server-rendered, sanitized and email-client compatible. The visual editor never
stores arbitrary executable HTML.

### Worker experience

Show the worker only their welcome context, next required actions, document requests,
appointments/training, messages and Day-One status. Do not expose internal blocker routing,
manager analytics, audits or other employees. Empty sections disappear rather than showing
blank dashboard cards.

## Production visual baseline

- Body text: 14px; contextual text: never below 12px; widget titles: 16–18px; page titles:
  27–30px.
- Controls have a 40px minimum height, visible keyboard focus and aligned icons.
- Status colour communicates state only. Cards and whole rows remain neutral.
- No page-level horizontal overflow at 1280px or 1440px. Wide tables and the Email Studio
  canvas may scroll inside a clearly bounded region.
- No mount/reveal animation. Render the shared SIOMAC skeleton in the final grid shape,
  then replace it once the page shell data is ready.
- Avatars use the shared profile component and fall back to correctly centred initials.
- Dialogs use the shared Dialog component, name the consequence, show required reasons and
  expose only actions backed by a real capability and endpoint.
- Every visible link, button, filter and menu item works in the reference or is rendered as
  non-interactive explanatory text. No `href="#"` placeholders.

## Implementation acceptance

Claude should treat `data-page-key`, `data-widget-key`, `data-source`, `data-action-route`,
`data-permission` and `reactGridDefaults` in the canonical mockups as the handoff contract.
The production build must use PageHeader, Tabs, Button, Dialog, Skeleton, Avatar, status and
table/filter primitives from the UI kit where their appearance matches the reference.

Do not implement illustrative numbers. Each displayed value must have a live source. If a
mockup value needs historical persistence that does not exist, omit the trend and record the
deviation rather than fabricating it. Staff/manager variants use the same page components
with capability-gated content and queries, not separate drifting pages.
