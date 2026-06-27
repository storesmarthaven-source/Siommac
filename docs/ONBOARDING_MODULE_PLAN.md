# HR Onboarding Module — Build Plan & Checklist

Authoritative, sequenced plan for completing the HR Onboarding module, **including the
Custom Onboarding Actions addendum**. This is the single source of truth for what is
done, what is missing, and the order it must be built in. Defer to CLAUDE.md (no
band-aids, build-order, per-phase approval) on any conflict.

> **Status legend:** ✅ done · 🔲 not built · 🚧 in progress

> **Live E2E (Phases 1–5 + 7b):** `scripts/e2e/suites/hrOnboarding.mjs` — **47/47 green** against
> the running stack (launch + packages/list + management lifecycle + blockers + custom actions +
> settings-gated behaviour, with §2 side-effects and access-control negatives). Apply bundle:
> `scripts/sql/hr_onboarding_management_phase1-7.sql`, then run the settings **catalog sync**
> to publish `hr_onboarding.*`. (Dev DB packages were seeded directly; Phase 6 columns/tables
> need the bundle applied before its live E2E + FE page.)

---

## 0. What already exists (the *launch* half)

The plumbing to **start** an onboarding case is built, gated, audited, and E2E-covered.
It is NOT the management module.

- **DB** (`supabase/migrations/20260709000000_hr_onboarding.sql` + `…0710` intake + `…0711` access):
  `hr_onboarding_cases`, `hr_onboarding_tasks`, `hr_onboarding_handoffs`.
- **Service** `netlify/functions/lib/hr/onboardingCore.ts` — `startOnboardingCase()` via
  `runModuleMutation` (idempotent, emits `onboarding.started` / `.handoff.created`, writes
  HR audit, compensating rollback). Reused by `routes/hr.ts` employee-create.
- **Packages** `netlify/functions/lib/hr/onboardingPackages.ts` — **5 packages in CODE**
  (standard / safety_critical / contractor / supervisor_manager / office_admin).
- **Routes** `netlify/functions/routes/hrOnboarding.ts` — `preview-package`, `start`,
  `task/complete`, `task/reassign`, `cancel`, `get`.
- **Permissions** (catalogued + seeded): `hr.onboarding.view / start / task.manage / cancel`.
- **Frontend** `src/api/hr/onboarding.ts` + `src/components/sections/HR/OnboardingWizard.tsx`.
- **E2E** `scripts/e2e/suites/hrOnboarding.mjs`.

---

## 1. Spec → reality corrections (do NOT copy the pasted DDL verbatim)

The pasted specs use foreign conventions. Building them as-written would break the build.
Apply these corrections everywhere:

1. **User FKs are `text`, not `uuid`.** `app_users.id` is TEXT. Every `created_by`,
   `updated_by`, `retired_by`, `added_by`, `completed_by`, `cancelled_by`,
   `owner_employee_id`, `resolved_by`, etc. → `text references public.app_users(id)`.
2. **`hr_onboarding_packages` does not exist** — packages are a code constant. The custom
   action **templates** FK to it, so **Phase 4 (packages → DB) is a hard prerequisite** for
   template-level custom actions. No FK to a phantom table; no dual source of truth.
3. **Route conventions are ours:** Hono `router.post(...)`, `requirePermission(c, key)` /
   `requireUser(c)`, read `body.args ?? body`, return `{ success, data }` / `{ success:false, message }`,
   `emitAppEvent({ eventType, sourceModule, sourceEntityType, sourceEntityId, actorUserId, severity, payload })`,
   `writeHrAudit({...})`. NOT `requireAuth`/`{ ok, data }`/`c.req.json()`.
4. **No FK to subsystems that don't exist yet.** `document_type_id`, `training_requirement_id`,
   `notification_template_id` reference modules not built — store as plain id columns (NO FK)
   and have the instantiation handler create a **`pending` handoff** for those types. Never
   fake completion. `workflow_template_id` may FK `workflow_templates` (exists).
5. **`custom_approval` routes through the central workflow engine** (bindings), not a private
   approval table — see `[[central-workflow-engine]]`.
6. **All mutations** go through `runModuleMutation` per `[[module-service-adapter-pattern]]`.
7. **Granular task perms collapse to the existing `hr.onboarding.task.manage`** (reuse over
   duplication). Add `task.override` only if a real need appears.
8. **`progress_percent`, `open_tasks`, `blocking_tasks`, activation readiness are COMPUTED**
   in the list/dashboard query from tasks/blockers — not denormalized columns (avoid drift).

---

## 2. Build sequence (phases — each needs explicit go-ahead before the next)

### Phase 1 — Schema + state-machine foundation 🔲 (migration written: `20260714000000_hr_onboarding_management.sql`)
- Expand `hr_onboarding_cases.status` → `draft, open, in_progress, blocked, paused, ready_for_activation, completed, cancelled`; add `paused_at`.
- `hr_onboarding_tasks`: add `is_blocking`, `requires_evidence`, `dependency_keys jsonb`, `sort_order`, `priority`, `blocked_reason`; expand status to add `open`, `cancelled`.
- `hr_onboarding_handoffs`: expand status (`pending,sent,accepted,blocked,delivered,completed,failed,cancelled`); add `handoff_key`, `owner_id`, `accepted_at`, `completed_at`, `failure_reason`, `last_event_at`.
- New table `hr_onboarding_blockers` (RLS + service_role grants + updated_at trigger).

### Phase 2 — Read endpoints + FE API/hooks ✅ (backend + API; UI consumes in Phase 8)
- BE `lib/hr/onboardingQueries.ts` + routes in `hrOnboarding.ts`: `dashboard-stats`, `list`,
  `tasks/list`, `handoffs/list`, `blockers/list` — all gated `hr.onboarding.view`; progress/
  blocking/readiness COMPUTED (no denormalized columns).
- Shared contract `types/hrOnboarding.ts` (BE + FE import it).
- FE `src/api/hr/onboarding.ts`: `dashboardStats/listCases/listTasks/listHandoffs/listBlockers`
  + hooks `useOnboardingDashboard/Cases/TasksList/HandoffsList/BlockersList` (placeholderData=keep-prev).
- `timeline`/`audit`: REUSE generic `POST /api/orchestration/timeline/get` (mapping tightened to
  `hr.onboarding.view`). Dedicated case-audit endpoint deferred to Phase 3 (needs `audit.view`).
- Typecheck: backend + frontend both clean. Needs Phase 1 migration applied before live E2E.

### Phase 3 — Case/task write endpoints ✅ (backend + API; UI consumes in Phase 8)
- BE `lib/hr/onboardingMutations.ts` + 12 routes in `hrOnboarding.ts`: `task/add`,
  `task/block`, `task/unblock`, `complete`, `pause`, `resume`, `reassign-owner`, `ready`,
  `blocker/resolve`, `blocker/escalate`, `blocker/waive`, `audit`. Each: row update with DB
  error CHECKED → `app_event` → `writeHrAudit` (throws on fail, no swallow). `recomputeCaseStatus`
  flips blocked↔in_progress from open blocking tasks + active blockers. block/unblock keep a
  single active blocker row per task in sync. complete refuses while open tasks remain; ready
  refuses while blocking work remains; waive requires a reason (audited).
- Permissions ADDED + catalogued + seeded (`20260714000001…perms.sql`): `case.manage`,
  `complete`, `audit.view` (task block/unblock reuse `task.manage`; cancel reuses `cancel`).
- FE: `hrOnboardingApi` mutation methods + `useOnboarding{AddTask,BlockTask,UnblockTask,
  CompleteCase,PauseCase,ResumeCase,ReassignOwner,MarkReady,Resolve/Escalate/WaiveBlocker}`
  (all invalidate `['hr','onboarding']`) + `useOnboardingAudit`.
- Typecheck: backend + frontend clean. Activation gates currently = "no open/blocking work";
  the settings-driven granular gates (documents/training/hse/payroll) land in Phase 7.
- Migrations to apply: `20260714000000` (Phase 1) + `20260714000001` (perms), then NOTIFY pgrst.

### Phase 4a — Packages → DB (read path) ✅ — UNBLOCKS Custom Actions
- Tables: `hr_onboarding_packages` + `_task_templates` + `_handoff_templates`
  (`20260714000002…packages.sql`), **seeded** faithfully from the old code constant
  (`20260714000003…packages_seed.sql`, idempotent; is_blocking/requires_evidence false to
  preserve current behaviour).
- Service `lib/hr/onboardingPackageService.ts`: `loadPackagePlan` (single instantiation source),
  `listPackageSummaries` (owners derived from task roles), `packageLabelMap`.
- **Rewired** `onboardingCore.startOnboardingCase` + `preview-package` + cases-list labels to
  the DB; start/preview validation now `z.string()` (dynamic keys). **DELETED**
  `lib/hr/onboardingPackages.ts` — no dual source. Instantiated tasks now carry
  is_blocking/requires_evidence/sort_order/dependency_keys; handoffs carry handoff_key + payload_template.
- New endpoint `packages/list` (gated `hr.onboarding.view` — used by the wizard picker).
- FE: `useOnboardingPackages()` hook; **both wizards** (OnboardingWizard + CreateEmployeeWizard)
  now fetch packages from the API; FE `ONBOARDING_PACKAGES` constant removed.
- Typecheck: backend + frontend clean.

### Phase 4b — Package manager CRUD 🔲 (with Phase 8 editor UI)
`packages/get` (full detail), `packages/create|update|publish|retire` — gated `package.view` /
`package.manage` (new keys). Template replace needs compensating-restore (no PostgREST tx).

### Phase 5 — Custom Onboarding Actions ✅ (backend + API; UI consumes in Phase 8)
- Tables `hr_onboarding_action_templates` + `hr_onboarding_case_actions`
  (`20260714000004…custom_actions.sql`); user FKs TEXT; soft (no-FK) uuid cols for
  document/training/notification refs; `workflow_template_id` FKs `workflow_templates`.
- Service `lib/hr/onboardingCustomActions.ts` — template CRUD + case-action add/list/update/
  complete/cancel + the `instantiate` dispatcher wiring each type to its REAL target:
  task/checklist/external→`hr_onboarding_tasks`; handoff→`hr_onboarding_handoffs`;
  document/training→task + **pending** handoff (no receiver yet, not faked);
  approval→**central workflow** (`startWorkflowByTemplate`); notification→`emitAppEvent`
  (real fan-out). `blocks_onboarding`→task `is_blocking` + `recomputeCaseStatus`.
- 9 routes on the onboarding router (templates list/create/update/retire; case
  list/add/update/complete/cancel). 8 permissions catalogued + seeded
  (`20260714000005…custom_actions_perms.sql`). Events + HR audit on every op.
- FE: `hrOnboardingApi` methods + `useOnboardingActionTemplates`/`useOnboardingCaseActions`
  + create/update/retire/add/update/complete/cancel mutation hooks.
- Typecheck clean. **Deferred:** auto-instantiating package action templates at case START
  (wire into the wizard's custom-actions step in Phase 8) — dispatcher is ready to reuse.

### Phase 6 — Account / Work-Email provisioning 🔲 (design locked)
Turns a new hire's `app_users` record into a working identity (work email + login + access)
as a real onboarding step — replacing the manual IT checkbox tasks. Acts on the Create-wizard
captured intent (`permission_profile`, `self_service_profile`, `require_mfa`).

**Provisioning knobs (org default ↔ per-employee override):**
1. **Work email** — dedicated `work_email`, generated from settings `domain` + `naming pattern`
   (`first.last` / `flast` / `first`). Distinct from `email`/`personal_email`.
2. Username — pattern.
3. **Credential method — LOCKED: invite link → user sets own password** (default).
4. **MFA required?** — on/off (default from `auth_security_policy`).
5. Permission profile → real role/`role_permissions` (default per package).
6. Self-service profile (default). 7. App access. 8. Activation timing (now / on start / on
   approval). 9. Auto-deactivate on `end_date` (contractors).

**Invite-link flow (REUSE existing infra, no parallel auth):**
- Create the Supabase Auth user (login = work email) via `sb.auth.admin.createUser`.
- Generate **our own one-time invite token** (hashed + expiry on `app_users` or an
  `account_invites` table) — NOT Supabase hosted recovery, because the app mints its own JWTs
  and only uses Supabase admin API for password storage (`admin.updateUserById`).
- Email the link **via Resend** (already wired in `lib/notify.ts`, gated on `RESEND_API_KEY`)
  to **`personal_email`** (work mailbox doesn't exist yet). If `RESEND_API_KEY` is unset →
  surface the link to the HR/IT provisioner / IT handoff — never a fake "invite sent".
- New **`/set-password` (accept-invite) page** (MUST BUILD — none exists; FE only has
  `PasswordLoginPanel`) → posts to an accept-invite route → validates token →
  `sb.auth.admin.updateUserById(authUid, { password })` → marks account active.

**REAL vs EXTERNAL (no band-aid):** we provision login + work-email field + access + invite.
The actual **mailbox** (Google/M365), distribution lists, hardware/badge → **pending IT/Access
handoff** (the Phase-5 handoff lifecycle), flipped to delivered only when IT acts.

**Deliverables:** migration (invite token + `work_email` + `account_status`/`provisioned_at`);
`lib/hr/accountProvisioning.ts`; routes `provision-account` + `accept-invite`; perm
`hr.onboarding.provision_account`; events + audit; `/set-password` page; E2E. **Depends on
Phase 7 settings** (domain / pattern / default credential method / default profile / auto-
provision toggle) — do Phase 7 first or together.

### Phase 7a — Settings catalog keys ✅ (defined + registered + validated)
- `lib/settings/manifests/onboarding.manifest.ts` (moduleKey `hr_onboarding`, ~20 keys) registered
  in `manifests/index.ts`. Reuses `hr.settings.manage` (no new settings permission). Build-gate
  unit test green (validates, unique keys, permission exists).
- Keys: `enabled`, `case_no_prefix`, `require_owner_on_start`, `allow_draft_cases`,
  `task_completion_requires_evidence`, `auto_start_after_employee_create`, `allow_blocker_waiver`,
  `blocker_waiver_requires_workflow`, `escalate_overdue_blocking_tasks`,
  `block_activation_until_{documents,training,hse,payroll}_complete`,
  `send_employee_welcome_email_default`, `notify_supervisor_default`, `work_email_domain`,
  `work_email_pattern`, `account_default_credential_method`, `auto_provision_account_on_start`,
  `retention_years`. (Default package stays `employees.onboarding_default_package` — not duplicated.)
- **Wired consumer:** `hr_onboarding.enabled` master switch in `startOnboardingCase` (default-allow
  when catalog unsynced; safe at default so E2E stays green).
- **Publish step:** run the catalog sync (`seedSettingsFromManifests`) so the keys land in
  `app_setting_catalog`.

### Phase 7b — Wire the behaviour-changing consumers ✅ (core set; E2E-verified)
Wired via `resolveSettingValue` (safe fallback when catalog unsynced):
- `enabled` master switch + `require_owner_on_start` + configurable `case_no_prefix` (nextRef
  widened to `RefPrefix | (string & {})`) in `startOnboardingCase`.
- The four `block_activation_until_*` gates in `markOnboardingReady` (shared `taskCategory`
  extracted to `onboardingTaskCategory.ts`; per-category completeness).
- `allow_blocker_waiver` in `waiveOnboardingBlocker`.
- E2E drives them through the real settings APIs (catalog/sync + values/set/reset) — gate +
  require-owner proofs green; suite pins gates off for determinism.

**Still 7b-pending (need more infra):** `task_completion_requires_evidence` (needs an evidence
arg + attachment on task/complete), `blocker_waiver_requires_workflow` (workflow approval),
`escalate_overdue_blocking_tasks` (a scheduled sweep). Welcome-email/notify defaults feed the
Start wizard (Phase 8).

### Phase 6 — Account / Work-Email provisioning ✅ backend (FE page + live-E2E pending migration)
- Migration `20260714000006…account_provisioning.sql` (app_users `work_email`/`account_status`/
  `provisioned_at`/`provisioned_by` + `hr_onboarding_account_invites` + perm grant).
- `lib/hr/accountProvisioning.ts`: `provisionAccount` (derive work email from settings domain+
  pattern → create Supabase Auth login via `admin.createUser` → single-use sha256 invite token →
  Resend to **personal_email** (or surface link if no `RESEND_API_KEY`) → **pending IT handoff**
  for the real mailbox → event + audit) and `acceptAccountInvite` (PUBLIC, token → set password
  via `admin.updateUserById` → activate; generic errors, 8-char min, single-use, 7-day expiry).
- Routes `provision-account` (perm `hr.onboarding.provision_account`) + public `accept-invite`;
  perm catalogued + seeded. FE `provisionAccount`/`acceptInvite` api + `useOnboardingProvisionAccount`.
- **`/set-password` page built**: `src/components/auth/SetPasswordPage.tsx` — public, rendered by
  `main.tsx` BEFORE the app shell when `pathname === /set-password` (no session); plain `fetch`
  to the public `accept-invite` (envelope `{ args }`); `netlify.toml` SPA-fallback redirect for
  the deep link. Typecheck clean.
- **Remaining:** live E2E only (needs the migration applied; provisioning mutates a real auth
  user, so use a disposable test employee). Optional: wire a "Provision account" button into the
  case/employee UI (Phase 8).

### Phase 8 — UI (mockup-first) 🔲
Onboarding page (8 tabs), case-detail workspace, Package Manager (+ Custom Actions tab),
blockers board, reports, settings, Start-Wizard custom-action section. Built from provided mockups
(Set A / Set B per spec §28) like the widget board & HR pages — `[[hr-frontend-v36-faithful]]`.

---

## 3. Custom Onboarding Actions (addendum) — scope

**Model:** package-level reusable **action templates** → instantiated into the *normal*
lifecycle records at case start (and one-off at case detail). No disconnected custom system.

### DB (Phase 5, corrected)
- `hr_onboarding_action_templates` — `package_id → hr_onboarding_packages(id)` (needs Phase 4);
  `action_type` ∈ the 8 types; owner fields; `due_offset_days`; flags (`is_required`,
  `blocks_onboarding`, `requires_evidence`, `is_active`); typed refs (`workflow_template_id`
  FK; `document_type_id`/`training_requirement_id`/`notification_template_id` NO-FK);
  `external_system_key`/`external_action_url`; `display_order`; **all user FKs `text`**.
- `hr_onboarding_case_actions` (recommended) — one-off tracking shell linking to the real
  lifecycle record (`linked_task_id`/`linked_handoff_id`/`linked_workflow_instance_id`/…);
  status `open,in_progress,completed,cancelled,blocked`; **user FKs `text`**.

### Instantiation (`instantiateCustomOnboardingAction`) — type → real output
| type | wires to | notes |
|---|---|---|
| `custom_task` / `custom_checklist_item` / `custom_external_action` | `hr_onboarding_tasks` | external keeps `external_*` metadata, manual completion |
| `custom_handoff` | `hr_onboarding_handoffs` (+ `handoff_outbox`) | normal handoff lifecycle |
| `custom_document_request` | `hr_onboarding_tasks` + **pending handoff** | no document receiver yet → pending, not faked |
| `custom_training_request` | `hr_onboarding_tasks` + **pending handoff** | Training module not built → pending |
| `custom_approval` | **central workflow request** | `[[central-workflow-engine]]` binding; never a private approval |
| `custom_notification` | notification/event system | existing notifications |

### API (Phase 5)
Templates: `actions/templates/list|create|update|retire`. Case:
`actions/case/add|update|complete|cancel`. Our route conventions (§1.3).

### Permissions (Phase 5) — add to catalogues + seed
`hr.onboarding.custom_actions.view|create|update|retire|case_add|case_update|case_complete|case_cancel`.

### Events (Phase 5)
`hr.onboarding.custom_action_template.created|updated|retired`,
`hr.onboarding.custom_action.added_to_case|instantiated|completed|cancelled`.

### Reporting
Roll custom actions UP into task/handoff/training/document/approval/notification reporting —
do NOT report as a separate disconnected stream. Add dimensions: by package / type / owner,
completed-on-time, blocking, added-after-start, converted-to-{workflow,document,training}.

### Acceptance (addendum §15)
Template CRUD + reorder; wizard include/exclude optional actions; start instantiates into
real lifecycle records; case-detail one-off add; approval→workflow; doc/training→pending;
handoff→outbox; notification→event; every op audited + evented; permissions enforced;
reports don't break normal onboarding reporting.

---

## 4. Permission keys (full target set)

Existing ✅: `hr.onboarding.view`, `.start`, `.task.manage`, `.cancel`.
Management 🔲: `.case.manage`, `.complete`, `.package.view`, `.package.manage`,
`.reports.view`, `.settings.view`, `.settings.update`, `.audit.view`.
Custom actions 🔲: `.custom_actions.{view,create,update,retire,case_add,case_update,case_complete,case_cancel}`.

Add each key to **all** catalogues when its endpoint enforces it (drift-guard): backend
`netlify/functions/lib/permissions.ts`, FE `src/lib/permissions.ts` (union + admin/superadmin
grant arrays), FE `src/lib/permissionMeta.ts` (metadata), + `role_permissions` seed in the
phase's migration. See `[[rbac-permission-registry]]`.

---

## 5. Module boundary (locked)

**Employee Master** = *start* onboarding + *show* status (summary card + read-only Onboarding
tab + View Case link). **Onboarding module** = *manage* everything. No task completion inside
Employee Master.
