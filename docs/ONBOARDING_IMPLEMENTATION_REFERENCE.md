# HR Onboarding — full implementation reference

Everything that exists today (backend + frontend), verbatim from the live code, plus
the verified gap list. Written so another tool (Codex) can extend this module without
re-deriving conventions or conflicting with what's already built. Every claim below was
checked against the actual files in this repo, not assumed from a spec.

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
7. **Widget board, not tabs, for dashboards.** Onboarding Overview and Case Detail are
   both `@ui/widgets` `WidgetBoard` instances (drag/resize grid, `WidgetLibraryModal` to
   add/remove widgets, layout persisted server-side per `pageKey` in `ui_layout`). They
   are NOT tabbed pages. Package Manager / Package Detail, by contrast, are plain
   CRUD screens (table + modal forms) — no widget board, because they're admin
   configuration, not a dashboard.
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

**Does not exist**: any handoff mutation (retry/accept/complete), a dedicated `/timeline`
endpoint (Case Detail's activity feed IS the closest equivalent, reusing audit data — a
generic cross-module `/api/orchestration/timeline/get` exists but isn't onboarding-specific),
a `blocker/notify-owner` endpoint, package `duplicate`/reorder endpoints, or any Reports
endpoint.

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
| `OnboardingOverview.tsx` | Landing page. Widget board: 5 KPI tiles (Active Cases, Due This Week, Blocked Cases, Activation Readiness, Onboarding Health) + Package Readiness + Recent Activity widgets + a page-local Cases table widget (search/status/advanced-filter/pagination). Toolbar has "Packages" (permission-gated) and "New Case". Drill-in state: `selectedCase` → renders `OnboardingCaseDetail`; `packagesOpen`/`openPackageKey` → renders `OnboardingPackageManager`/`OnboardingPackageDetail`. |
| `OnboardingCaseDetail.tsx` | Widget board for one case: 4 KPI tiles (Progress/Readiness/SLA/Team) + 4 functional table widgets (Active Tasks, Blockers, Custom Actions, Handoffs) + Recent Activity + Account Provisioning. Header has lifecycle buttons (Pause/Resume/Mark Ready/Complete/Provision/Cancel) + owner selector. |
| `OnboardingWizard.tsx` | Modal: Package → Preview → Actions (custom action opt-in) → Options → Review → `start`. |
| `OnboardingPackageManager.tsx` | Plain list (not a widget board): search/status filter, table, New Package modal. |
| `OnboardingPackageDetail.tsx` | Plain page: header (Edit details / status-transition button) + 3 tabs (Task templates / Handoff templates / Custom actions — the last IS the Custom Action Template Manager). |
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
    ├─ "New Case"           → OnboardingWizard        (modal)
    └─ "Packages" (gated)   → OnboardingPackageManager (packagesOpen state)
                                 └─ click a package row → OnboardingPackageDetail (openPackageKey state)
```
Also reachable: Employee Master → Create Employee wizard (onboarding intake step) and
Employee Profile Drawer → "Onboarding" tab (summary + task actions).

---

## 10. Verified gap list (prioritized; fill these in)

**Whole missing surfaces**
1. Reports — zero implementation. Need: Cycle Time, Blocked Case, Task Owner
   Performance, Handoff Completion, Package Effectiveness, Activation Readiness,
   Overdue Tasks, Contractor Onboarding, Safety-Critical Onboarding reports + CSV/PDF
   export + scheduling. No backend endpoints, no frontend page.
2. Standalone cross-case Handoffs tracker + the handoff mutation actions themselves
   (retry / mark accepted / mark completed) — today handoffs are read-only and only
   visible scoped to one case.
3. Standalone cross-case Tasks board (table/board/owner/due-date view modes + a task
   drawer) — tasks are only browsable inside one open case today.
4. Standalone cross-case Blocked board grouped by module.

**Case Detail**
5. Communications surface (resend welcome email, supervisor notification, manual
   message, delivery status) on a case.
6. A real Timeline (only a "last 5" activity feed exists).
7. A dedicated Audit tab (before/after state, workflow ID, IP/device) — data is
   fetchable via `/onboarding/audit` but not surfaced with those columns.

**Overview / Cases**
8. KPI tiles aren't clickable/filterable.
9. No "high-risk case" card + Notify Owner action.
10. No row-level quick actions on the Cases table (only "open case" via row click).

**Package Manager**
11. No Required Documents / Required Training / HSE Requirements / Communication
    Rules / Escalation Rules as distinct config sections.
12. No review/publish workflow (status is a direct draft→active→retired flip).
13. No Duplicate or Move Up/Down actions on custom action templates.

**Small**
14. No "Notify Owner" blocker action (Resolve/Escalate/Waive only).
15. No shareable/bookmarkable URL for a specific case (no router — see convention #6).

Also worth closing while in this code: `hr_manager`'s seeded permission grant is
missing the employee baseline (communications/attendance/leaves/widget-board) — a
pre-existing bug, not caused by any of the above.
