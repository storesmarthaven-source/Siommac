# SIOMAC ERP — Architecture & Implementation Plan

> **Source of truth.** SIOMAC is ONE enterprise platform, not separate pages.
> Every module follows the same pattern:
>
> **record created → event emitted → workflow/approval (if needed) →
> notification/message/ticket (if needed) → audit logged → reportable data
> updated → handoff to another module (if required).**
>
> The shared backbone (workflow, events, communications, handoffs, UI kit) is
> built BEFORE any module is expanded deeply, because HSE, HR, Finance, Payroll,
> and Operations all depend on the same systems.

---

## Current-state delta (verified against code, 2026-06)

What the plan assumes vs. what actually exists. Keep this honest — update as built.

| Plan element | State | Evidence / gap |
|---|---|---|
| Platform core (auth, RBAC, depts, sites, employees, settings, audit, registry) | ✅ built | live + backend-enforced |
| Workflow tables (`workflow_instances`, `approval_tasks`, `workflow_events`, handoff in/out) | 🟡 built, unused | migration `20260620000000`; **frontend store is localStorage** (`src/lib/workflow/store.ts`, key `siomac.hse.workflow.v1`) — never calls `/api/workflow/*` |
| `app_events` central stream | ❌ missing | no table, no emitter — **must create** |
| Handoff emission | 🟡 built, never fired | `/api/workflow/decide` writes outbox→inbox, but nothing calls decide; no consumer |
| `notify.ts` canonical notification API | ❌ not mounted | absent from `api.ts` route mounts |
| `getNotifications` synthetic path | 🟡 to retire | `routes/notifications.ts` builds notifs inline from leave/attendance; no notifications table |
| User id typing | ⚠️ inconsistent | notifications use ad-hoc `user_id` from joined tables, not canonical `app_users.id` |
| HSE Incidents→Investigations→CAPA | ✅ live | real backend (`routes/hse.ts`); investigations global-list endpoint missing |
| Other 11 HSE areas + PPE | 🟡 frontend mock | no tables |
| HR / Finance / Operations modules | 🔵 planned | frontend partial/none, no backend |
| Payroll | 🟡 partial | runs/approvals exist; ledger + NIS employer rate incomplete |
| UI kit (`src/ui`) | 🟡 started | tokens + statusTokens + 9 components + exportCsv built; pages not migrated |

---

## System Layers

- **Platform Core** — auth, sessions, RBAC, users, departments, sites, settings, module registry, superadmin, audit log.
- **Workflow Core** — templates, stages, tasks, approvals, evidence gates, SLA timers, escalations, reassignments, returns, closure.
- **Event Core** — one `app_events` stream for every major action.
- **Handoff Core** — cross-module work transfer (HSE incident cost → Finance; employee impact → HR).
- **Communication Core** — notifications, messages, tickets, delivery prefs, realtime badges.
- **Module Core** — HSE, HR, Payroll, Finance, Operations, Admin, Reports.
- **UI Core** — shared design system (headers, cards, tables, filters, drawers, forms, dialogs, timelines, charts, chips).

---

## Platform Core
- Keep `app_users`, departments, project sites, settings, sessions, permission overrides, roles, module registry as the foundation.
- Standardize user ids everywhere as `app_users.id` text ids (`USR-…`); remove UUID-only assumptions in notifications and tests.
- Permissions = role defaults + per-user overrides.
- Permission groups to add: `hse.incidents.read`, `hse.incidents.create`, `hse.investigations.manage`, `hse.capa.manage`, `workflow.approve`, `tickets.manage`, `reports.export`, `audit.read`, `admin.manage`.
- Audit log records: actor, action, module, entity type, entity id, before/after (where useful), IP, user agent, timestamp.
- Normal users see record activity timelines; admin/compliance roles see full audit.

## Workflow Engine
- Canonical tables: `workflow_templates`, `workflow_template_steps`, `workflow_instances`, `workflow_tasks`, `workflow_evidence`, `workflow_events`.
- Instance fields: source module, source entity type/id, template id, status, priority, current step, due date, owner, created by, closed at.
- Task fields: instance id, assigned user/role/department, action type, status, due date, completed by, decision, decision note.
- Statuses: `draft`, `submitted`, `triage`, `in_review`, `awaiting_evidence`, `awaiting_approval`, `returned`, `approved`, `rejected`, `closed`, `cancelled`, `overdue`.
- **Replace localStorage workflow state with backend APIs.**
- Every decision emits an `app_event`, writes audit rows, updates task state, may trigger notifications/handoffs.
- One engine for: HSE incident/investigation/CAPA, document approval, permit approval, payroll approval, leave approval, procurement approval.

## Event Backbone
- Add `app_events` (central activity source). Fields: `id`, `event_type`, `source_module`, `source_entity_type`, `source_entity_id`, `actor_user_id`, `severity`, `site_id`, `department_id`, `payload`, `dedupe_key`, `created_at`.
- Examples: `hse.incident.submitted`, `hse.investigation.assigned`, `hse.capa.overdue`, `workflow.task.assigned`, `workflow.approved`, `handoff.created`, `ticket.replied`, `payroll.published`.
- Recipient resolution rules: actor, owner, assignee, department manager, site manager, module admin, role, watcher, explicit user.
- **Events are immutable.** Corrections are new events, not edits.

## Handoff Bus
- Add `handoff_outbox`. Fields: source module, target module, source entity, target entity, payload, status, attempts, error, created by, processed at.
- Statuses: `pending`, `processing`, `completed`, `failed`, `cancelled`, `manual_review`.
- HSE examples: incident lost-time → HR employee case; incident cost → Finance cost record; equipment failure → Operations work order; CAPA needing purchase → Procurement/Finance request.
- **Processing creates target records through the receiving module's API, never by writing another module's tables directly.**
- Failed handoffs notify module admins + appear in a handoff review queue.

## Communications Backbone
- Notifications = action alerts/reminders. Messages = human/record-linked conversations. Tickets = support/service/escalation cases with owner, SLA, resolution.
- Mount and use `routes/notify.ts` as the canonical notification API.
- Retire synthetic `/getNotifications` + localStorage read tracking after migration.
- Add `/api/communications/summary` for all header badges.
- Notification fields: event id, module, severity, source type/id, action route, metadata, read at, archived at, expires at, dedupe key.
- Message tables: `message_threads`, `message_participants`, `message_posts`, `message_reads`.
- Ticket tables: `tickets`, `ticket_comments`, `ticket_watchers`, `ticket_events`.
- Realtime only signals "something changed"; frontend refetches via authenticated APIs.

## Modules (summary — see plan body for full field lists)
- **HSE** — dashboard (enterprise summary only), incidents, investigations, CAPA, inspections, audits, permits, risk assessments, training, documents, PPE, environmental, emergency, reports. HSE is the **reference implementation** for the rest of the ERP.
- **HR** — employee master, positions, status, documents, training; leave/attendance (wired, must emit events); receives HSE handoffs (lost-time, disciplinary, training-required, medical-restriction, return-to-work); onboarding/offboarding/approval workflows; HR reports.
- **Payroll** — consumes approved attendance/leave/rates/deductions; run → validate → approve → publish payslips → notify → finance posting handoff; payroll reports.
- **Finance** — receives HSE costs, payroll postings, procurement, budgets; cost centers/budgets/expenses/incident-costs/postings/procurement; approval workflows; finance reports.
- **Operations** — sites/projects, daily logs, work orders, assets, inventory, procurement, manpower; receives HSE handoffs (equipment failure, site hazard, corrective maintenance); ops reports.

## Reporting Architecture
- **No vague "intelligence" page.** Reports inside modules first, then a global Reports area.
- Tables: `report_definitions`, `report_runs`, `report_exports`.
- Reports support filters, saved views, CSV/PDF export, permission checks, audit logging.
- Dashboards = live operational status. Reports = formal review/export.

## UI Framework
- Centralized UI kit before expanding pages (`src/ui`).
- Components: page header, metric card, compact chart card, data table, filter bar, search, status chip, priority chip, action menu, drawer, modal, wizard, form section, timeline, audit feed, attachment list, empty state.
- Page layout standard: **page header → 4 focused KPI cards → optional compact insight charts → main register/table → right-side detail drawer.**
- No giant page-specific hero dashboards except true dashboard pages.
- Tables open side drawers, not large inline detail blocks.
- Cards rearrangeable via one card/grid framework.

---

## Implementation Order

1. **Architecture cleanup** — confirm active tables, remove duplicate notification paths, fix user-id typing, mount `notify.ts`.
2. **UI kit foundation** — shared cards, headers, tables, drawers, filters, chips, modals, form sections. *(partially done — `src/ui`)*
3. **Workflow backend** — canonical workflow tables/APIs; replace localStorage workflow store.
4. **Event backbone** — `app_events`, recipient resolver, event-emission helper.
5. **Communication backbone** — unify notifications/messages/tickets, header counts, realtime invalidation.
6. **Handoff bus** — outbox, processing APIs, failure review queue.
7. **HSE completion** — rebuild incidents/investigations/CAPA/dashboard/reports on the shared backbone; then remaining HSE areas.
8. **HR/Payroll wiring** — leave, attendance, employee records, payroll approval + payslip notifications.
9. **Finance/Operations wiring** — costs, work orders, procurement, assets, budgets.
10. **Reports/export layer** — module reports first, global reports second.
11. **Legacy removal** — localStorage workflow, synthetic notifications, old badge logic, duplicated modals.

---

## Acceptance Tests (definition of done for the backbone)

- Incident report creates incident + event + workflow + notification + audit row.
- Investigation assignment creates task + notification + appears in investigator work queue.
- CAPA overdue creates notification + escalation event.
- Approved incident handoff creates HR/Finance/Operations target record (via target API).
- Message reply updates unread count; clears when opened.
- Ticket reply/status notifies the right user + updates SLA state.
- Leave approval emits payroll-impact event.
- Payroll publish creates payslip notifications.
- Unauthorized access to another user's notifications/messages/tickets/attachments fails.
- All major actions appear in the record timeline AND the admin audit log.
