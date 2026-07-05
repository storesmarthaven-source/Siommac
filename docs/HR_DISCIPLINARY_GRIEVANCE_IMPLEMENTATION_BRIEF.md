# HR Disciplinary & Grievance — Implementation Brief (for Codex)

**Module:** HR sub-module #10 — Disciplinary & Grievance
**Status:** New, greenfield. Previously deferred (dropped from the initial 17-item scope alongside
Performance Management, Benefits Administration, and Recruitment/ATS); now approved to build on its own.

**Why this module, why now:** it closes a real audit gap. Today an employee can go straight from active to
terminated (via the existing Offboarding module) with no formal warning / corrective-action trail. This
module is the record of *why* — the disciplinary history that should exist before a termination — and the
intake for grievances/complaints raised by or against employees.

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` FIRST — it documents the conventions every HR
> sub-module must follow (envelope `{success,data}` / `{success:false,message}`; body
> `(c.get('body') as Record<string,unknown>).args ?? {}`; `app_users.id` is TEXT; permission model;
> mutation side-effects order event→audit; camelCase shared DTO; no URL router; widget boards optional;
> test cadence — full suites only at the very end). Also read `CLAUDE.md` (No-Band-Aids + Known Pitfalls)
> before starting.

**Frontend scope:** functional-first, plain `.obx-*` tables/forms (see `OffboardingOverview.tsx` for the
pattern). **No widget board for this module** — sensitive content should not be summarized into a
glanceable dashboard tile that a passerby could screenshot.

---

## 0. Reuse — do not rebuild these, compose on top of them

- **Central workflow engine** (`workflow_templates/instances`, `startWorkflowForRecord`, bindings/versions)
  — for corrective-action decision approval (SoD: raiser ≠ decider).
- **`writeHrAudit`** — every mutation on a disciplinary case is audited. This module has the **strictest**
  audit requirements of any HR module built so far, given the sensitivity of the content.
- **Documents pattern** (`hr_employee_documents`-style presigned upload/verify/archive) — for statements,
  evidence, signed acknowledgements. Reuse the `RESTRICTED_TIERS` confidentiality concept already present in
  `netlify/functions/lib/hr/documentsCore.ts`.
- **`emitAppEvent` + `handoff_outbox`** — for the termination handoff to Offboarding (see §4).
- **`nextRef`** — case numbering (e.g. `DGC-2026-0001`).
- **Optional link to `hse_incidents`** (nullable FK) when a disciplinary case originates from a safety
  violation — reference the incident, do not duplicate its data.

**The one genuinely new piece:** a confidentiality/access model stricter than every other HR module. This is
the load-bearing design decision — get it right. Do not default to the loose "hr_staff sees everything"
pattern used by every other HR module so far; that pattern is deliberately wrong for this one.

---

## 1. Data model (new migration(s), operator-applied + trailing `NOTIFY pgrst, 'reload schema';`)

### `hr_disciplinary_cases`
| column | type | notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `case_no` | `text unique not null` | prefix `DGC` via `nextRef` |
| `case_type` | `text not null check in ('complaint','grievance','misconduct_investigation','corrective_action')` | |
| `subject_employee_id` | `text not null references app_users(id)` | the employee the case concerns |
| `raised_by` | `text references app_users(id)` | who filed it; nullable if HR-initiated |
| `raised_against_employee_id` | `text references app_users(id)` | for grievances filed against a coworker/supervisor; nullable |
| `status` | `text not null check in ('draft','open','under_investigation','pending_decision','decided','closed','appealed','withdrawn') default 'draft'` | |
| `severity` | `text not null check in ('low','medium','high','critical') default 'medium'` | |
| `confidentiality` | `text not null check in ('standard','restricted','highly_restricted') default 'restricted'` | |
| `investigator_id` | `text references app_users(id)` | |
| `owner_id` | `text references app_users(id)` | usually HR Manager |
| `source_incident_id` | `uuid references hse_incidents(id)` | nullable, when triggered by an HSE incident |
| `summary` | `text not null` | |
| `resolution` | `text` | |
| `resolution_type` | `text check in ('no_action','verbal_warning','written_warning','final_warning','suspension','termination_referral','dismissed_unfounded')` | |
| `workflow_id` | `uuid references workflow_instances(id)` | |
| `opened_at` | `timestamptz not null default now()` | |
| `closed_at` | `timestamptz` | |
| `created_by` | `text not null references app_users(id)` | |
| `created_at` / `updated_at` | + `set_updated_at` trigger | |

RLS enabled, `service_role` grants, per the platform standard.

### `hr_disciplinary_actions`
The timeline/log of actions taken on a case (warnings issued, meetings held, statements taken):
- `id`, `case_id uuid references hr_disciplinary_cases(id) on delete cascade`
- `action_type text check in ('note','meeting_held','warning_issued','statement_taken','evidence_added','escalated','decision_recorded')`
- `action_detail text`, `performed_by text references app_users(id)`, `occurred_at timestamptz not null default now()`
- `created_at`

### `hr_disciplinary_documents`
Reuse the exact shape/pattern of `hr_employee_documents` (title, file_path, mime_type, confidentiality,
uploaded_by, uploaded_at) but scoped by `case_id` instead of `employee_id`, so evidence/statements attach to
the CASE, not the employee's general document record — this keeps sensitive material out of the general HR
Documents surface.

### `hr_disciplinary_case_access`
The explicit access-grant table — the mechanism behind the confidentiality model:
`case_id`, `user_id`, `granted_by`, `granted_at`, `reason`. Rows here are the ONLY way a non-owner,
non-investigator user can read a `restricted`/`highly_restricted` case (e.g. a manager brought in for
context). Standard-confidentiality cases skip this and just use role-based `view_all`.

---

## 2. Confidentiality / access model (the core new design work)

This is stricter than every existing HR module. Enforce ALL of the following server-side on every read —
never client-side:

1. **`subject_employee_id === actor.id`** → can always view their OWN case, but only a **redacted** view:
   case type, status, and any decision/resolution actually communicated to them. No investigator notes, no
   other parties' statements. This is the "acknowledge a warning" view.
2. **`investigator_id === actor.id` or `owner_id === actor.id`** → full read/write on that specific case.
3. **Explicit grant in `hr_disciplinary_case_access`** → full read on that specific case only.
4. **Role-based broad access** — permission key `hr.disciplinary.view_all` — grant ONLY to `hr_manager`,
   `admin`, `superadmin`. Do **not** grant this to `hr_staff` by default. This is the deliberate exception to
   the "hr_staff = view_all" pattern used by every other HR module. `hr_staff` instead gets
   `hr.disciplinary.view_assigned` (rules 2/3 only).
5. **`manager` role**: no default visibility into disciplinary cases at all, unless explicitly granted
   (rule 3). A direct manager must not automatically see a subordinate's disciplinary history just by role.
6. **Views are audited, not just mutations.** Every read of a `restricted`/`highly_restricted` case — even
   by someone authorized — writes an audit row (`hr.disciplinary.case.viewed`) via `writeHrAudit`. This is
   the one HR module where reads get audited; no other module does this.

---

## 3. Permissions

New keys — land via migration + all 3 catalogues (backend constant, `permissionMeta.ts`, RBAC drift-guard):

```
hr.disciplinary.view_own        -- see your own case(s), redacted
hr.disciplinary.view_assigned   -- see cases where you're investigator/owner/explicitly granted
hr.disciplinary.view_all        -- see all cases (hr_manager, admin, superadmin ONLY)
hr.disciplinary.create          -- file a complaint/grievance/open a case
hr.disciplinary.investigate     -- add actions, evidence, statements to an assigned case
hr.disciplinary.decide          -- record resolution/decision (SoD: cannot be the raiser)
hr.disciplinary.grant_access    -- add a row to hr_disciplinary_case_access
hr.disciplinary.close           -- close a case
hr.disciplinary.audit.view      -- view the audit trail
hr.disciplinary.reports.view    -- aggregate reporting only — never individual case content
```

**Grants:**
- `superadmin` / `admin` — all keys.
- `hr_manager` — all keys (flag `grant_access` back to the user if you think it should be admin-only — see
  open question §7.1).
- `hr_staff` — `view_own`, `view_assigned`, `create`, `investigate` (only usable once made investigator).
  **Not** `view_all`.
- `employee` / `manager` — `view_own` only. Employees may also hold `create` (they can file a grievance);
  the case then needs an HR owner assigned before anyone investigates.

---

## 4. Lifecycle / workflow

**Complaint/grievance path:**
`draft` (filer drafting) → `open` (filed, HR notified) → `under_investigation` (investigator assigned,
actions logged) → `pending_decision` (investigation complete, awaiting decision) → `decided` → `closed`.
Optional `appealed` from `decided` back to `under_investigation`. `withdrawn` from `open` /
`under_investigation` if the filer withdraws.

**Corrective-action path** (HR-initiated, e.g. from an HSE incident):
`open` → `pending_decision` → `decided` (resolution_type set) → `closed`.

**Decision requires SoD**: the actor recording the decision (`hr.disciplinary.decide`) must not be
`raised_by` on that case. Reuse whatever `assertDifferentApprover`-style helper already exists in the
codebase (check Finance's approval routes) — or, for `high`/`critical` severity, route the decision through
the central workflow engine instead (recommended: bind a `hr_disciplinary_decision_approval` workflow
template so the decision requires a second approver, not just the investigator's own say-so). `low`/`medium`
severity can use the direct SoD-checked mutation without a full workflow.

**Termination outcome:** when `resolution_type = 'termination_referral'` and the case closes, do **NOT**
auto-create an Offboarding case — that is a consequential HR action that needs an explicit human decision.
Instead:
1. Raise a `handoff_outbox` entry targeting HR ops ("Disciplinary case DGC-2026-00xx recommends termination
   for review").
2. Emit `hr.disciplinary.termination_referred` via `emitAppEvent`.
3. A human then manually starts Offboarding. **Before adding a new `source_disciplinary_case_id` column to
   `hr_offboarding_cases`, check whether it already has a generic "reason/source reference" field** — reuse
   it if so; only add a new column if it genuinely doesn't exist.

---

## 5. Backend

`netlify/functions/lib/hr/`:
- **`disciplinaryCore.ts`** — `createDisciplinaryCase` (via `runModuleMutation` + idempotency +
  `emitAppEvent` + `writeHrAudit` + `nextRef`), status transitions, SoD-checked `recordDecision`.
- **`disciplinaryQueries.ts`** — `listCases` (MUST apply the confidentiality filter server-side, never
  client-side), `getCase` (apply the same access rules; return the redacted shape for `view_own` callers),
  `listActions`, dashboard-stats (aggregate counts only, gated by `reports.view`).
- **`disciplinaryAccess.ts`** — the confidentiality/grant logic as a single reusable
  `canAccessCase(actor, case)` helper. Call this from EVERY route — do not inline the check per-route,
  that is exactly how an access rule gets missed later.
- **`disciplinaryDocuments.ts`** — presigned upload/commit/verify/archive, mirroring `documentsCore.ts` but
  scoped to `hr_disciplinary_documents`.
- **`disciplinaryReports.ts`** — aggregate-only report definitions (counts by type / severity / status /
  resolution / month). Never a report that dumps case content.

Routes: `netlify/functions/routes/hrDisciplinary.ts`, mounted at `/api/hr/disciplinary/*`. **Every route
calls `canAccessCase` before returning anything.**

---

## 6. Types / hooks / frontend

- **`types/hrDisciplinary.ts`** — shared camelCase DTO (backend + frontend import the same shapes).
- **`src/api/hr/disciplinary.ts`** — TanStack Query hooks; `useDisciplinaryMutation` invalidates
  `['hr','disciplinary']`.
- **`src/components/sections/HR/DisciplinaryOverview.tsx`** — list scoped to what the viewer can see
  (own/assigned/all per role), status filter, "File a Grievance" action for employees, "Open Case" action
  for HR.
- **`src/components/sections/HR/DisciplinaryCaseDetail.tsx`** — case header + action timeline + documents
  (upload/view per confidentiality) + decision panel (SoD-gated) + grant-access panel (HR only).
- A genuinely **reduced, redacted** "My Cases" view for employees (their own filed grievances + any notices
  addressed to them) — do NOT reuse the full case-detail component verbatim for this.
- Nav: register `s-hr-disciplinary` in `module.ts` + route in `HRSection.tsx`.

---

## 7. E2E — `scripts/e2e/suites/hrDisciplinary.mjs`

The **access-control section is the most important part of this suite** — test exhaustively:
- Subject employee sees their own case (redacted); cannot see another employee's case.
- `hr_staff` without an assignment/grant is DENIED viewing a case they're not investigating.
- `hr_staff` WITH an assignment can view+investigate but is denied `decide` if they're also `raised_by`
  (SoD).
- `manager` role has NO default access to a subordinate's case.
- `hr_manager` / `admin` / `superadmin` have full `view_all`.
- An explicit grant via `hr_disciplinary_case_access` correctly opens access to exactly that one case, not
  others.
- Every mutation writes `app_events` + `hr_audit_log`; every VIEW of a restricted case ALSO writes an audit
  row — verify this specifically, it is the one behavior unique to this module.
- The termination-referral path raises the correct handoff and does **not** auto-create an Offboarding case.
- The reports endpoint returns aggregates only — assert individual case identifiers/content are not present
  in count/rollup-type report rows.

### 7.1 Verification (run at the end, per the project's test-cadence rule)
`typecheck:frontend` + `typecheck:backend` + `build:backend` clean; `npm test` + `npx vitest run` green;
`npm run test:e2e -- hrDisciplinary` green (after the operator applies the migrations +
`NOTIFY pgrst, 'reload schema';`). Report the exact migration file list that needs operator-apply.

---

## 8. Open questions — flag back before finishing, do not decide silently

1. **Should `hr.disciplinary.grant_access` be `hr_manager`-eligible or `admin`-only?** This brief scopes it
   to `hr_manager` and above, but it's a real policy call, not Codex's to make silently.
2. **Should decisions on `high`/`critical` severity cases be REQUIRED to route through the central
   workflow** (mandatory second approver) vs. optional? This brief recommends mandatory for those two
   severities, with direct SoD-checked decisions for `low`/`medium`.
3. **Confirm `hr_offboarding_cases` doesn't already have a generic "reason/source reference" column**
   before adding `source_disciplinary_case_id` — reuse it if one already exists.
