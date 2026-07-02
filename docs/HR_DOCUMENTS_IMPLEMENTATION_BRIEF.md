# HR Documents — Implementation Brief (for a subagent / Codex)

**Module:** HR sub-module #8 — HR Documents
**Goal:** Promote the **existing** per-employee document backend into a standalone, cross-employee
**HR Documents** module: a document register (search/filter across all employees), an **expiry
tracking + reminder** engine, and a **document-requirement policy** (which document types are
required for whom → who is missing/expired). This is **promote + expiry + requirements**, NOT a
rebuild — the storage, upload, verify/archive, confidentiality gating, audit and events already
exist and must be reused.

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` FIRST (canonical conventions: `{success,data}`
> envelope, `body.args`, `requirePermission(c,key)`, camelCase shared DTO, `app_users.id` is TEXT,
> event→audit side-effects, no URL router, E2E required). Also `CLAUDE.md` (No-Band-Aids + Known
> Pitfalls). This brief only states what is specific to HR Documents.

**Frontend scope (current mandate):** **functional-only** — plain tables/forms (`.obx-*`), `@ui`
components. **NO widget board / registry KPI-tile widgets.** The user adds per-page widgets later.

---

## 0. TL;DR — what to build
1. **Reuse** the existing per-employee document backend as-is (§1.2). Do not re-implement upload/
   verify/archive/download or create a new documents table.
2. **New migrations** (additive; operator-applied + `NOTIFY pgrst`): `hr_document_requirements`
   (policy) + `hr_document_reminders` (dedupe ledger for expiry reminders) + a perms grant.
3. **New backend lib** `netlify/functions/lib/hr/documents*.ts` (queries + requirements + expiry
   sweep) composing existing platform (`emitAppEvent`, `writeHrAudit`, presign helpers, `sb`).
4. **New routes** on the HR router (`/api/hr`): cross-employee `documents/list`, expiry list/stats,
   requirements CRUD, compliance (missing/expired per employee), and a service-role expiry sweep.
5. **Permissions:** reuse `hr.employee_documents.*` (already catalogued); add
   `hr.employee_documents.requirements.manage` in all four registries + a grant migration.
6. **Settings manifest** `hrDocuments.manifest.ts` (reminder windows + defaults) registered in the
   manifest index.
7. **Types** `types/hrDocuments.ts` + **hooks** `src/api/hr/documents.ts` (reuse the existing
   upload/verify/archive/download hooks in `src/api/hr/employees.ts`).
8. **Frontend** `src/components/sections/HR/HRDocuments*.tsx` (functional-only), nav item
   `s-hr-documents`, routed in `HRSection.tsx`.
9. **E2E** `scripts/e2e/suites/hrDocuments.mjs`.

---

## 1. Current state (verified in-repo — REUSE, do not rebuild)

### 1.1 `hr_employee_documents` (migration `20260702000004_hr_employee_master_profile_docs.sql`)
Already rich — **no schema change needed** for the core:
```sql
id uuid pk default gen_random_uuid(),
employee_id text not null references public.app_users(id) on delete cascade,
document_type   text not null,                 -- free text today (e.g. 'passport','contract','certificate')
title           text not null,
file_path text not null, file_name text not null, mime_type text, file_size bigint,
confidentiality text not null default 'internal'
  check (confidentiality in ('internal','confidential','restricted_hr','legal','medical')),
status text not null default 'uploaded'
  check (status in ('uploaded','verified','rejected','archived')),
expiry_date date,                              -- ← the expiry engine hangs off this
uploaded_by text, uploaded_at timestamptz not null default now(),
verified_by text, verified_at timestamptz, rejected_reason text, archived_at timestamptz,
metadata jsonb not null default '{}'::jsonb
-- indexes: hr_emp_docs_employee_idx(employee_id,status), hr_emp_docs_expiry_idx(expiry_date) where not null
```

### 1.2 Existing routes (all in `netlify/functions/routes/hr.ts`, mounted `/api/hr`) — REUSE
| Route | Perm | Notes |
|---|---|---|
| `POST /employees/documents/list` | `hr.employee_documents.view` | per-employee; **filters `archived`**; **hides restricted tiers unless `sensitive_view`** |
| `POST /employees/documents/upload-url` | `hr.employee_documents.upload` | `createAttachmentUploadUrl(HR_DOC_BUCKET, fileName, mimeType)` → `{uploadUrl, token, path, bucket}` |
| `POST /employees/documents/commit` | `hr.employee_documents.upload` | inserts row + `writeHrAudit('hr.employee.document_uploaded')` + `emitAppEvent('hr.employee.document_uploaded')` |
| `POST /documents/verify` | `hr.employee_documents.verify` | `decision: approve\|reject` → status `verified\|rejected` + audit |
| `POST /documents/archive` | `hr.employee_documents.archive` | status `archived` + audit |
| `POST /documents/download-url` | `hr.employee_documents.download` | restricted tiers need `sensitive_view`; **audited** (`hr.employee.document_downloaded`); `getSignedUrl(HR_DOC_BUCKET, file_path)` |

**Shared helpers (already imported into `hr.ts`):** `createAttachmentUploadUrl` (`lib/upload`),
`getSignedUrl` (`lib/photos`), `userCan` (`lib/auth`), and **local consts** `HR_DOC_BUCKET` +
`RESTRICTED_TIERS` (a `Set` of `restricted_hr|legal|medical`). Bucket is **private** (signed URLs
only — never public). The confidentiality gate `if (RESTRICTED_TIERS.has(c) && !sensitive_view) →
hide/deny` is the security contract; **every new read endpoint MUST apply the same gate.**

### 1.3 Permissions (already catalogued in both `permissions.ts` + `permissionMeta.ts`)
`hr.employee_documents.view | upload | verify | archive | download | sensitive_view`. Granted to
superadmin/admin/hr_manager (manager gets view+download); `hr_staff` split per the RBAC model.

### 1.4 Frontend hooks (already exist in `src/api/hr/employees.ts`) — REUSE
`useHrDocuments(employeeId)`, `useUploadHrDocument()`, `useVerifyHrDocument(employeeId)`,
`useArchiveHrDocument(employeeId)`, `getHrDocumentDownloadUrl(documentId)`, and the `HrDocument`
type + `UploadDocArgs`. The upload hook does the full presign→PUT→commit dance. The Employee Master
**Profile Drawer** already renders per-employee documents with these. **The new page reuses these
hooks for row actions** and adds only the cross-employee/expiry/requirements reads.

---

## 2. What is genuinely NEW (the gap)
| Area | Exists | New work |
|---|---|---|
| Cross-employee register | per-employee list only | `documents/list` across all employees: search + filter (type/status/confidentiality/expiry window/employee/department) + pagination |
| Expiry tracking | `expiry_date` column only | expiring-soon / expired lists + counts; reminder engine |
| Reminders | none | settings-driven reminder windows + a **service-role sweep** that emits notifications (dedupe ledger) |
| Requirement policy | none | `hr_document_requirements` (required doc types per role/employment-type/dept) + **compliance** (who is missing / expired) |
| Standalone page | none (drawer only) | HR Documents page: Register / Expiring / Requirements tabs (functional-only) |
| E2E | none | `hrDocuments.mjs` |

---

## 3. Architecture decisions (No-Band-Aids)

### 3.1 Reuse `hr_employee_documents` — no new documents table, no new upload path.
The new cross-employee endpoints **read/aggregate the same table** and reuse the same presign/verify/
archive/download routes. Do not duplicate the storage flow.

### 3.2 Extract the shared consts once — don't copy them.
`HR_DOC_BUCKET` and `RESTRICTED_TIERS` are currently **local** to `hr.ts`. Move them into a new
`netlify/functions/lib/hr/documentsCore.ts` (with a `filterVisibleDocs(user, rows)` helper that
encapsulates the restricted-tier gate) and import them into BOTH `hr.ts` (existing routes) and the
new document lib. Copying the `Set` into a second file is a copy-stale band-aid.

### 3.3 Requirement policy is reference data (new), not a document fork.
`hr_document_requirements` declares *which* `document_type` is required for *whom* (scope: `all` |
`role:<role>` | `employment_type:<type>` | `department:<id>`), plus flags (`requires_expiry`,
`min_confidentiality?`). Compliance is **computed** (required set per employee ⨯ their present
verified/expired docs) — do NOT denormalize a per-employee checklist table.

### 3.4 Reminders need a dedupe ledger — never re-notify blindly.
A sweep that emits a notification every run for the same expiring doc is spam (a band-aid). Use
`hr_document_reminders(document_id, threshold_days, sent_at)` so each (doc, window) fires **once**.
Windows come from settings (e.g. `[30,7,0]` days before expiry). The sweep is **idempotent**.

### 3.5 The sweep is a service-role ROUTE — there is no scheduler infra.
There is **no `netlify/functions/scheduled/` directory** in this repo. Implement the expiry sweep as
`POST /api/hr/documents/expiry/run-sweep`, **service-role only** (reject normal users), and verify
how it will be triggered (check `netlify.toml` for scheduled config, or an external cron) — do not
ship a timer that isn't wired.

### 3.6 Every new read applies the confidentiality gate; every mutation emits event + audit.
Reuse `filterVisibleDocs`. Requirement-policy mutations `emitAppEvent` (fire-and-forget `void`) +
`writeHrAudit` (awaited; throws on failure — never swallow). `writeHrAudit`'s field is
`previousState`, not `oldState`.

---

## 4. Migrations (new files, additive, operator-applied)
Number after the current max. Onboarding used to `…016`; Offboarding is taking `…017+`; Org Structure
is taking `20260715000000+`. **Use `20260716000000+`** for HR Documents and confirm no collision
before finalizing. Each ends with `-- After applying, run: NOTIFY pgrst, 'reload schema';`.

### 4.1 `20260716000000_hr_document_requirements.sql`
```sql
create table if not exists public.hr_document_requirements (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  label text not null,
  applies_to_scope text not null default 'all'
    check (applies_to_scope in ('all','role','employment_type','department')),
  applies_to_value text,                          -- null for 'all'; role/type/dept id otherwise
  requires_expiry boolean not null default false, -- if true, a present doc without expiry_date is non-compliant
  reminder_days integer[] not null default '{30,7,0}',   -- per-requirement override; else settings default
  min_confidentiality text
    check (min_confidentiality in ('internal','confidential','restricted_hr','legal','medical')),
  is_active boolean not null default true,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (document_type, applies_to_scope, applies_to_value)
);
create index if not exists hr_doc_req_active_idx on public.hr_document_requirements(is_active);
alter table public.hr_document_requirements enable row level security;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

### 4.2 `20260716000001_hr_document_reminders.sql`
```sql
create table if not exists public.hr_document_reminders (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.hr_employee_documents(id) on delete cascade,
  threshold_days integer not null,                -- which reminder window fired
  expiry_date date not null,                      -- guards re-fire if the doc's expiry is later changed
  sent_at timestamptz not null default now(),
  unique (document_id, threshold_days, expiry_date)
);
create index if not exists hr_doc_reminders_doc_idx on public.hr_document_reminders(document_id);
alter table public.hr_document_reminders enable row level security;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

### 4.3 `20260716000002_hr_documents_perms.sql`
```sql
insert into public.role_permissions (role_name, permission) values   -- NOTE: column is role_name
  ('superadmin','hr.employee_documents.requirements.manage'),
  ('admin','hr.employee_documents.requirements.manage'),
  ('hr_manager','hr.employee_documents.requirements.manage')
on conflict do nothing;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

---

## 5. Permissions
Reuse all existing `hr.employee_documents.*` keys (view/upload/verify/archive/download/sensitive_view).
**Add one enforced key `hr.employee_documents.requirements.manage`** (policy management) in all FOUR
places (the drift-guard `tests/unit/permissions.sync.test.ts` fails the build otherwise):
1. `netlify/functions/lib/permissions.ts` → `PERMISSION_KEYS` (next to the `hr.employee_documents.*` block).
2. `src/lib/permissions.ts` → `PERMISSION_KEYS` + the `admin` and `superadmin` Sets.
3. `src/lib/permissionMeta.ts` → group `'Documents'` (mirror the existing employee-document entries):
   `{ module:'HR', group:'Documents', label:'Manage Document Requirements', description:'Define required document types and expiry policy.', risk:'high' }`.
4. DB grant: §4.3.
- The cross-employee **register/expiry/compliance reads** gate on `hr.employee_documents.view`
  (restricted rows filtered unless `sensitive_view`). `hr_staff` may view; requirements.manage is
  oversight-only (superadmin/admin/hr_manager). Confirm the `hr_staff` split against the RBAC model.

---

## 6. Backend — lib + routes

### 6.1 `netlify/functions/lib/hr/documentsCore.ts`
Export the extracted `HR_DOC_BUCKET`, `RESTRICTED_TIERS`, and `filterVisibleDocs(user, rows)` (the
restricted-tier gate used by every read). Import these into `hr.ts` (replace its local copies) and
the new lib. Optionally a `humanizeDocStatus` / `computeExpiryState(expiry_date)` →
`valid|expiring|expired|none` helper.

### 6.2 `netlify/functions/lib/hr/documentsQueries.ts`
- `listAllDocuments(user, filters)` — cross-employee: filters `{ q?, employeeId?, departmentId?,
  documentType?, status?, confidentiality?, expiryState?('expiring'|'expired'|'valid'|'none'),
  expiringWithinDays?, page?, pageSize? }`. Join employee name + department. Apply `filterVisibleDocs`.
  Return `{ rows, total }`. Default excludes `archived` unless `status:'archived'` requested.
- `getDocumentsStats(user)` — `{ total, uploaded(pending verify), verified, expiringSoon(<=N days),
  expired, missingRequired }` (missingRequired from compliance, §6.4).
- `listExpiring(user, { withinDays })` / `listExpired(user)` — for the Expiring tab.

### 6.3 `netlify/functions/lib/hr/documentsRequirements.ts`
- `listRequirements()` / `createRequirement(actor, args)` / `updateRequirement(actor, args)` /
  `retireRequirement(actor, { requirementId })` (soft `is_active=false`). Each: `emitAppEvent`
  (`hr.document_requirement.created|updated|retired`) + `writeHrAudit` (submoduleKey `'documents'`).
  Enforce the `unique (document_type, applies_to_scope, applies_to_value)` → 409 on dup.

### 6.4 `netlify/functions/lib/hr/documentsCompliance.ts`
- `resolveRequiredTypesForEmployee(emp)` — union of active requirements whose scope matches the
  employee (`all` + `role:emp.role` + `employment_type:emp.employment_type` + `department:emp.department_id`).
- `getComplianceForEmployee(user, employeeId)` — per required type: `present? verified? expired?
  missing?`. Apply `filterVisibleDocs` when reading the docs.
- `getComplianceOverview(user, filters)` — cross-employee roll-up: employees with missing/expired
  required docs (for the Requirements tab’s compliance view + `missingRequired` stat).

### 6.5 `netlify/functions/lib/hr/documentsExpirySweep.ts`
- `runExpirySweep(actorId, { windows? })` — for each active doc with `expiry_date` within a
  configured window and no `hr_document_reminders(document_id, threshold_days, expiry_date)` row:
  insert the ledger row, then `emitAppEvent('hr.document.expiry_reminder', …)` (the notification
  pipeline turns events into notifications for the employee’s HR owner/supervisor per recipient
  rules). Idempotent — a second run the same day emits nothing new. Return `{ scanned, remindersSent }`.
  Windows from settings `hr_documents.expiry_reminder_days` (default `[30,7,0]`), per-requirement
  override allowed.

### 6.6 Routes (add to `netlify/functions/routes/hr.ts` — house style: `body.args`, `zv`, envelope)
| Route | Perm |
|---|---|
| `POST /documents/list` | `hr.employee_documents.view` (cross-employee register) |
| `POST /documents/stats` | `hr.employee_documents.view` |
| `POST /documents/expiring` | `hr.employee_documents.view` |
| `POST /documents/compliance` | `hr.employee_documents.view` (overview + per-employee) |
| `POST /documents/requirements/list` | `hr.employee_documents.view` |
| `POST /documents/requirements/create` | `hr.employee_documents.requirements.manage` |
| `POST /documents/requirements/update` | `hr.employee_documents.requirements.manage` |
| `POST /documents/requirements/retire` | `hr.employee_documents.requirements.manage` |
| `POST /documents/expiry/run-sweep` | **service-role only** (reject normal principals) |
> The existing `documents/verify`, `documents/archive`, `documents/download-url`,
> `employees/documents/upload-url`, `employees/documents/commit` stay as-is and are reused by the UI.

---

## 7. Settings manifest — `netlify/functions/lib/settings/manifests/hrDocuments.manifest.ts`
Mirror `onboarding.manifest.ts` (moduleKey `hr_documents`, reuse `hr.settings.manage`). Register it
in `netlify/functions/lib/settings/manifests/index.ts` (add the import + push into the array under
"Module Policy"). Suggested settings:
- `hr_documents.enabled` (boolean, default true).
- `hr_documents.expiry_reminder_days` (string/number list, default `30,7,0`) — sweep windows.
- `hr_documents.default_confidentiality` (select, default `internal`).
- `hr_documents.block_activation_until_required_complete` (boolean, default false) — future gate for
  onboarding activation (do NOT wire behaviour now; catalog-only, safe at default).
- `hr_documents.retention_years` (number, default 7).
Read via `resolveSettingValue(sb, 'hr_documents.<k>', { moduleKey: 'hr_documents' }, <default>)`.

---

## 8. Types + hooks
### 8.1 `types/hrDocuments.ts` (shared camelCase; import both sides)
`HrDocumentRow` (extend the existing `HrDocument` with `employeeName`, `departmentName`,
`expiryState`), `DocumentFilters`, `DocumentsStats`, `DocumentRequirement`,
`EmployeeComplianceRow` (`{ employeeId, employeeName, requiredType, label, state:'present_verified'|
'present_unverified'|'expired'|'missing' }`), `ComplianceOverviewRow`, `ExpirySweepResult`.

### 8.2 `src/api/hr/documents.ts`
`call()` throws on `success:false`. Methods + hooks for the new reads/mutations; query keys under
`['hr','documents', …]`; `useDocumentsMutation` invalidates `['hr','documents']`. **Reuse** the
upload/verify/archive/download hooks from `src/api/hr/employees.ts` (import them) — do not duplicate.

---

## 9. Frontend — functional-only (NO widgets)
`src/components/sections/HR/` — plain pages, `.obx-*` + `@ui` (`PageHeader`, `Tabs`, `Modal`,
`Field`/`FormGrid`/`TextInput`/`SelectInput`, `EmptyState`, `TableSkeleton`, `exportCsv`). Use
`@lib/dialog` for confirms/prompts/toasts (never `window.*`).
- **`HRDocumentsOverview.tsx`** — header + plain stat row (`documents/stats`) + `Tabs`:
  - **Register** — cross-employee `.obx-table` (search + filters: type/status/confidentiality/expiry/
    employee/department + pagination). Row actions reuse existing hooks: **Verify/Reject** (verify
    perm), **Archive** (archive perm), **Download** (download perm; opens signed URL). **Upload**
    button (pick employee + file → existing upload hook). Restricted rows only visible with
    `sensitive_view`.
  - **Expiring** — `documents/expiring` list (valid/expiring/expired badges) + a **Run reminder
    sweep** button (visible to oversight) calling `expiry/run-sweep`, toasting `{scanned,remindersSent}`.
  - **Requirements** — requirement policy `.obx-table` + New/Edit/Retire modals
    (requirements.manage) **and** a compliance view (`documents/compliance` overview: employees with
    missing/expired required docs).
- **Modals**: Upload Document, Requirement Create/Edit. Reuse `@ui Modal`.
- **Loading**: `placeholderData` + gate `loading={isLoading && !data}`; skeletons on cold path; never a fake `0`.

**Nav wiring:**
- `src/components/sections/HR/module.ts` — add `{ id:'s-hr-documents', label:'Documents',
  icon:'fa-folder-open', sub:'Employee documents, expiry & requirements' }` to `navItems`.
- `src/components/sections/HR/HRSection.tsx` — add `DOC_ID='s-hr-documents'`, include in
  `isHrSection`, render `<HRDocumentsOverview/>` when selected.
  > NOTE: Offboarding (`s-hr-offboarding`) and Org Structure (`s-hr-organization`) append to these
  > same two files in parallel — expect a trivial 3-way merge (keep all nav items + branches).

---

## 10. E2E — `scripts/e2e/suites/hrDocuments.mjs`
Mirror `scripts/e2e/suites/hr.mjs`. Run `npm run test:e2e -- hrDocuments` against live
`dev:netlify` (build:backend + restart first — it serves `dist/`). Cover:
1. **Register** — seed docs across ≥2 employees; `documents/list` filters (type/status/expiry/
   employee/department) + pagination return the right rows.
2. **Reuse path** — upload-url→commit→list→verify→download-url→archive still works end-to-end and is
   audited (`hr.employee.document_downloaded` row present).
3. **Confidentiality gate** — a principal WITHOUT `sensitive_view` does NOT see `restricted_hr|legal|
   medical` rows in `documents/list` and gets 403 on their `download-url`. Provision **real** users of
   each role (auth resolves role from `app_users` — do not forge).
4. **Expiry** — a doc expiring within the window appears in `documents/expiring`/stats; `run-sweep`
   inserts an `hr_document_reminders` row and emits `hr.document.expiry_reminder`; a **second** sweep
   emits nothing (dedupe) — assert reminder count unchanged.
5. **Requirements + compliance** — create a requirement (`applies_to_scope`), then an employee in
   scope with the required type **missing** shows in `documents/compliance` as `missing`; upload+verify
   the type → recompute shows compliant; duplicate requirement → 409.
6. **Access control** — normal employee denied `requirements.*`; `run-sweep` denied to non-service-role.
7. **§2 side-effects** — requirement mutations write `app_events` + `hr_audit_log` (`submodule_key=
   'documents'`); poll events with a local `waitFor` (not global); cleanup via `h.TAG` in `h.onCleanup()`.

---

## 11. Verification gate (once, at the end)
1. `npm run typecheck:frontend` + `npm run typecheck:backend` — clean.
2. `npm run build:backend` — clean (before E2E).
3. `npm test` + `npx vitest run` — green (watch the permission drift-guard for
   `hr.employee_documents.requirements.manage`; and the settings-manifest catalog build gate — a new
   manifest must be registered + sync clean).
4. `npm run test:e2e -- hrDocuments` — green (after migrations applied + `NOTIFY pgrst`).
5. 229 frontend tests remain green.

**Migrations to operator-apply, in order (then `NOTIFY pgrst, 'reload schema';`):**
1. `20260716000000_hr_document_requirements.sql`
2. `20260716000001_hr_document_reminders.sql`
3. `20260716000002_hr_documents_perms.sql`
(Confirm numbers don’t collide with the parallel Offboarding / Org Structure migrations.)

---

## 12. Definition of done
- Cross-employee register with search/filter/pagination; existing upload/verify/archive/download
  reused (not rebuilt); confidentiality gate applied on every new read.
- Expiry tracking (expiring/expired lists + stats) + idempotent reminder sweep (ledger dedupe) as a
  service-role route.
- Requirement policy CRUD + computed compliance (missing/expired per employee); events + audit.
- `hrDocuments` settings manifest registered; reminder windows settings-driven.
- Functional-only HR Documents page (Register/Expiring/Requirements tabs), nav-wired.
- `hrDocuments.mjs` green; full gate green; migrations listed for operator-apply.
- No band-aids: no new documents table, no duplicated upload path, shared consts extracted (not
  copied), no re-notify spam (dedupe ledger), no invented scheduler (service-role route),
  compliance computed (not denormalized), `writeHrAudit` uses `previousState`.

## 13. Appendix — reuse map (do NOT rebuild these)
| Need | Already exists — reuse |
|---|---|
| Storage bucket / presign | `HR_DOC_BUCKET` (private) + `createAttachmentUploadUrl` (`lib/upload`) |
| Signed download | `getSignedUrl` (`lib/photos`) — audited download route already present |
| Upload flow | `employees/documents/upload-url` + `employees/documents/commit` + `useUploadHrDocument()` |
| Verify / archive | `documents/verify` + `documents/archive` + `useVerifyHrDocument` / `useArchiveHrDocument` |
| Confidentiality gate | `RESTRICTED_TIERS` + `sensitive_view` check (extract to `documentsCore.ts`) |
| Permissions | `hr.employee_documents.*` (catalogued) — add only `…requirements.manage` |
| Audit / events | `writeHrAudit` (submodule `'documents'`) + `emitAppEvent` (already used by commit/verify) |
| Settings | manifest pattern + `resolveSettingValue` |
| Frontend document types/hooks | `HrDocument`, `useHrDocuments`, `getHrDocumentDownloadUrl` (`src/api/hr/employees.ts`) |
