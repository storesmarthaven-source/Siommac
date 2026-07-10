# SIOMAC — Calendar & Tasks Module (grounded build brief)

Platform-level module: **one shared source of dated items** surfaced as a full Calendar page, an
Upcoming-Deadlines widget, and a Tasks widget. Do **not** build separate calendar/deadline/task
systems — a task, an activity, and a deadline are all "an item with a date." This brief is the
Codex-authored spec **grounded against the real codebase** (see §0 for the corrections that override
Codex's assumptions). Build **after** the RBAC exact-mockup rebuild.

## 0. Corrections that OVERRIDE the generic spec (verified against the code)
1. **Endpoints = Hono routes**, not `/.netlify/functions/calendar-*`. Create `netlify/functions/routes/calendar.ts`:
   `router.post('/calendar/list', c => { await requirePermission(c, 'calendar.view'); const v = zv(c, Schema, c.get('body').args ?? {}); … })`.
   Register it like the other routers; FE calls via the api client `call('calendar/list', args)` (envelope `{ args }`).
2. **Coarse permission keys + server-side scope**, not a `.own/.team/.org` suffix matrix. Use
   `calendar.view`, `calendar.manage`, `calendar.task.manage_own`, `calendar.task.assign`, `calendar.activity.manage_own`.
   Scope (self / team / org) is enforced server-side via the roleScope/dept/team model, not per-key.
   Add to `src/lib/permissions.ts` + `src/lib/permissionMeta.ts` (drift-guarded — exact keys, matching test).
3. **`timestamptz`** for timed columns (house standard), `date` for date-only/all-day. `created_at timestamptz
   not null default now()`, `updated_at timestamptz` + trigger, RLS enabled, `id uuid primary key default
   gen_random_uuid()`. **`app_users.id` is TEXT** → all user FKs are text. Platform-level → **no module prefix**.
4. **Every mutation goes through `runModuleMutation()`** (`netlify/functions/lib/moduleServiceAdapter.ts`) — the
   real transactional backbone that writes the business row + `app_events` + `audit_logs` + handoffs together.
   Multi-row atomicity needs the Postgres RPC or a **compensating rollback**, never a JS throw between calls.
5. **`rrule` is the only new dependency** (maintained, logic-only, hidden behind a recurrence service) and only
   if recurring events are in scope. NO date-fns/dayjs/luxon/FullCalendar/react-big-calendar/schedule-x.
   Confirmed zero date/calendar libs installed today.

## 1. Core architecture (one logical source → many views)
- Platform-level table `calendar_entries` owns **user-created tasks + activities** only.
- Module-owned deadlines stay in their owning module; **source adapters** convert them to the DTO on read.
- One normalized `CalendarItemDTO`; one calendar query service combines native entries + source projections.
- Do NOT copy every module deadline into the table unless a persistent projection is transactionally guaranteed.

## 2. Item types
- **Deadline** — system-generated, module-owned, **read-only** in calendar, drills through to its source record,
  visibility follows the SOURCE module's permissions (calendar access never grants source access).
- **Task** — actionable: owner, assignee, due date/time, status (`open|done|cancelled`), optional recurrence,
  optional source link. Created by an employee (self), a manager (assigned to a permitted team member), another
  module, or projected from the workflow engine.
- **Activity** — a calendar event (meeting, site visit, training…): date, optional start/end time, attendees,
  visibility, optional recurrence. No completion status.

## 3. Data model (starting point — refine constraints on build)
```sql
create table calendar_entries (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('task','activity')),
  title text not null,
  notes text,
  all_day boolean not null default true,
  starts_on date, ends_on date,                 -- all-day items
  starts_at timestamptz, ends_at timestamptz,   -- timed items
  owner_user_id text not null references app_users(id),
  assignee_user_id text references app_users(id),
  visibility text not null default 'personal' check (visibility in ('personal','team','org')),
  status text check (status in ('open','done','cancelled')),
  completed_at timestamptz, completed_by text references app_users(id),
  recurrence_rule text,                          -- RRULE string (rrule) — null = one-off
  recurrence_series_id uuid, recurrence_parent_id uuid references calendar_entries(id),
  source_module text, source_ref text,           -- for a projected deadline mirror (usually null here)
  created_by text not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- CHECKs: all_day ⇒ starts_on set & starts_at null (and vice-versa); task ⇒ status not null; date/time sanity
);
-- + calendar_activity_attendees (calendar_entry_id, user_id text, response_status) 
-- + calendar_recurrence_exceptions (calendar_entry_id, occurrence_date, exception_type, replacement_*)
-- indexes on starts_on, starts_at, assignee_user_id, owner_user_id, status, recurrence_series_id; RLS on all.
```

## 4. Normalized DTO (all views consume this; server computes capabilities)
`CalendarItemDTO`: `id, type('deadline'|'task'|'activity'), origin('calendar'|'module'|'workflow'), title, notes,
allDay, startsOn, endsOn, startsAt, endsAt, status, ownerUserId/ownerName, assigneeUserId/assigneeName,
attendeeCount, visibility, sourceModule/sourceRef/sourceRoute/sourceLabel, recurrenceSeriesId/recurrenceRule,
editable, completable, assignable, cancelable, drillThrough`. The client must NOT infer authz from ownership,
type, role name, source module, or visibility — the server returns explicit capabilities.

## 5. Deadline sources (adapters)
- Phase 1: Finance/Statutory (NIS/PAYE/Health-Surcharge remittance on the 15th, TD4 annual 28 Feb — replace the
  hard-coded calendar in `StatutoryDashboard.tsx`); HR/Onboarding task due dates (replace `UpcomingDeadlinesCard.tsx`);
  native `calendar_entries` (user tasks/activities).
- Phase 2: HR leave return/expiry, HSE permit-to-work / inspection / training / certificate expiry, workflow tasks + approvals.
- Each adapter: query only what the user may see, normalize to the DTO, preserve source ownership, give a valid
  drill-through route, return server-computed capabilities.

## 6. UI (custom Preact — see §0.5, no library)
- **Calendar page**: month (primary) → agenda → week → day; header (title, Today, prev/next, view switcher, filters,
  New▾ = Task/Activity — never "New Deadline"); day cells with capped item chips + "+N more"; day drawer; item drawers;
  create/edit dialogs; recurrence dialog. Agenda view is the mobile fallback.
- Distinguish deadline/task/activity and overdue/complete/cancelled by **more than colour** (icon + label).
- Scoped CSS with a `cal-` prefix; no `obv-*`/`sdb-cal-*` deps, no foreign calendar theme, no widget-board ceremony.
- Shared `src/components/calendar/UpcomingCalendarWidget.tsx` (config props: types, sourceModules, rangeDays,
  maxItems, show*) used by HR onboarding, Finance statutory, the dashboards — replacing BOTH existing week-strips.
- Date helpers in `src/lib/calendar/date.ts` incl. `parseLocalDate` / `toLocalDateKey` (never `new Date('YYYY-MM-DD')`
  or `.toISOString()` for date keys — they UTC-shift). Recurrence via `src/lib/calendar/recurrence.ts` wrapping `rrule`;
  prefer server-side expansion for a requested range (never expand unbounded on the client, never persist every occurrence).

## 7. Platform integration, permissions, tests
- All reads/writes are authenticated POST Hono routes behind `requirePermission()`; mutations via `runModuleMutation()`
  → business row + `app_events` + `audit_logs` (+ notifications/workflow/handoffs where rules require) + toast.
- Manager→employee assignment uses the real team/reporting hierarchy; validate assignee server-side (don't trust a
  client-supplied id). Org-wide visibility requires an explicit permission. Test the negative path (non-participant
  denied; calendar-but-not-Finance user can't open a Finance source record).
- Ships with `scripts/e2e/suites/calendar.mjs` (every endpoint, task/activity/deadline flows, recurrence if enabled,
  the §2 side-effects asserted via the service-role client, both access-control paths) + an idempotent seed so the
  page renders populated.
