# Employee Profile — Parity Checklist & Gap Register

Pre-edit deliverable required by
`docs/EMPLOYEE_PROFILE_EXACT_MOCKUP_IMPLEMENTATION_SPEC.md` §"Implementation Sequence" steps 1–2
("Inventory every visible element, state, dialog, and interaction in both locked mockups. Produce a
parity checklist **before editing production components**.").

No production component was edited to produce this document.

## Locked reference hashes (recorded before first edit)

| File | SHA-256 | Bytes |
|---|---|---|
| `docs/mockups/employee-profile-drawer-unified-command-brief.html` | `6b22e6526bc5dae3388cc007c66af2ff3448d648b7f67c97b88614211753adce` | 80,795 |
| `docs/mockups/employee-profile-full-page.html` | `688e06cb46740164cc81b576c3c3707d3145553e4a590fa20cfd90c427f6e3b9` | 209,239 |
| `docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md` | `fec74cf2590058ab3b89ac74614486f1399133dae0e154851507abe16197c5bd` | 6,006 |
| `docs/EMPLOYEE_PROFILE_EXACT_MOCKUP_IMPLEMENTATION_SPEC.md` | `53ea10ebab5b203d3609bded31f8ee5d35a4549de3d9636030a464593c9bb491` | 20,013 |

All four currently live **only** in the `b353` worktree
(`C:\Users\MSI Laptop\.codex\worktrees\b353\Siomac`) as untracked files. They are not on `main`.

## Measured scale (not estimated)

| Surface | Total lines | Locked CSS lines | Tabs | Dialogs |
|---|---|---|---|---|
| Drawer mockup | 1,422 | 942 | 6 | 1 (contact) |
| Full-page mockup | 3,512 | 2,494 | 7 | 10 |

| Current production file | Lines |
|---|---|
| `src/components/sections/HR/ProfileDrawer.tsx` | 629 |
| `src/components/sections/HR/ProfileDrawer.css` | 178 |
| `src/components/sections/HR/EmployeeProfilePage.tsx` | 470 |
| `src/components/sections/HR/EmployeeProfilePage.css` | 272 |
| `src/components/sections/HR/EmployeeMaster.tsx` | 874 |
| `src/components/sections/HR/employeeMasterAccess.ts` | 62 |
| `src/api/hr/employees.ts` | 700 |
| `netlify/functions/routes/hr.ts` | 2,222 |

Locked CSS to reproduce exactly: **3,436 lines**, against **450 lines** of current profile CSS.

## A. Drawer parity inventory

Tabs (`data-tab`): `overview`, `employment`, `documents`, `readiness`, `access`, `activity`.
Note the drawer has **no** `offboarding` tab; the full page does.

Structural regions, in document order:

- `topbar` → `brand`, `top-actions`, `action-menu-wrap` / `icon-btn` / `action-menu` (incl. `danger` item)
- `identity` → `identity-grid`, `portrait-shell`, `presence`, `name-line`, `status`, `employee-no`, `identity-lines`
- `facts` → repeated `fact`
- `tabs` → repeated `tab` (with indicator counters)
- `scroll` (tab body container)
- `attention-strip` → `attention-title`, `attention-heading-icon`, `attention-ico`, `attention-item`, `attention-next`
- `overview-grid` → `card` / `card-head` / `text-btn`
- readiness → `readiness-body`, `gauge`, `gauge-track`, `gauge-value`, `gauge-score`, `gauge-label`, `readiness-copy`
- `data-list`, `contact-row`, `contact-sep`
- documents → `doc-tree`, `folder-count`, `doc-tree-children`, `doc-leaf`, `doc-state`
- account → `account-grid`, `account-stat`, `stat-icon`
- activity → `activity-list`, `activity-row`, `activity-copy`, `activity-time`, `activity-icon`
- per-tab → `panel`, `tab-heading`, `tab-heading-actions`, `primary-btn`, `summary-grid`, `summary-stat`, `tab-grid`, `history`, `history-row`, `history-dot`, `outline-btn`
- dialog → `contact-dialog` (+ `-head`, `-intro`, `-kicker`, `-title`, `-title-icon`, `-actions`), `dialog-close`

Dark mode: the drawer mockup carries **36** theme declarations. These are the source for
drawer dark styling (spec §"Theme And Responsive Behavior").

## B. Full-page parity inventory

Tab order is fixed by the spec: Overview → Employment → Documents → Readiness → Access →
Activity & Audit → Offboarding.

| Panel | Markup size |
|---|---|
| `panel-overview` | 4,627 chars |
| `panel-employment` | 5,746 chars |
| `panel-documents` | 5,404 chars |
| `panel-readiness` | 6,818 chars |
| `panel-access` | 5,257 chars |
| `panel-activity` | 7,723 chars |
| `panel-offboarding` | ~4,000 chars (+ ~54,000 chars of trailing dialog markup) |

Offboarding panel states: `No Active Offboarding Case`, `Active Offboarding Case`.

Document-health block (`panel-documents`) — locked markup, currently **absent** from production:

```
.document-health-breakdown
  .document-health-summary-head   "Required Document Status" / "12 Records"
  .document-health-bar-new        3 segments (verified / expiring / missing)
  .document-health-states         3 × .document-health-state (strong=count, span="Label · N%")
```

Production currently renders `.epf-document-health` — a **two**-segment bar (verified, expiring)
with a static caption and no counts, no percentages, no "missing" segment, no required-status head.
This is a parity failure that must be replaced, not adapted.

## C. Dialog inventory (full page)

| Dialog id | Heading(s) | Footer buttons |
|---|---|---|
| `employee-edit-menu` | Edit Employee Record → Edit Employment & Assignment / Edit Contact Information / Edit Statutory & Payroll / Edit Service Dates & Conditions | area selection + form steps, **single dialog with Back** |
| `readiness-review-dialog` | Confirm Payroll Account Details | Open Evidence · Close · Send Payroll Reminder |
| `account-assistance-dialog` | Request Account Assistance → What Does The Employee Need Help With? → Business Impact → Account Support Request Created | Cancel · Create Support Request · Close · View Request |
| `account-request-history-dialog` | Account Request History | All Requests / Open / Resolved filters · Open · Done |
| `add-document-dialog` | Add Employee Document | Cancel · Add Document |
| `export-index-dialog` | Export Document Index | Cancel · Generate Export |
| `request-change-dialog` | Request Employee Change | Cancel · Submit For Approval |
| `activity-change-dialog` | Record Change → Cost Centre Assignment Updated | Close · Open Related Record |
| `export-audit-dialog` | Export Audit History | Cancel · Generate Audit Export |
| `start-offboarding-dialog` | Start Employee Offboarding | Cancel · Create Offboarding Case |

Spec constraint: the Edit Employee Record dialog must keep area selection **and** the form step in
one dialog with Back navigation — no nested second dialog.

## D. Backend gap register (verified against current code, not assumed)

| # | Spec gap | Current state | Verdict |
|---|---|---|---|
| 1 | Profile shell read contract | No such endpoint. `/employees/get` returns detail but not attention, tab indicators, contact summary, account health, or activity preview | **Missing** |
| 2 | Unified attention contract | No aggregation service. `EmployeeProfilePage.tsx` derives attention items client-side from assorted queries | **Missing** |
| 3 | Readiness controls / evidence / work items | No `hr_readiness_*` tables. Readiness is a 3-factor calc (assignment / payroll / training) in `employeeReadiness()` in `hr.ts` | **Missing — new subsystem** |
| 4 | Readiness ownership settings | No `Settings → Workforce → Readiness Ownership` surface, no owner resolver, no fail-closed | **Missing** |
| 5 | Document health | `hr_document_requirements` table **exists**; `/documents/requirements/{list,create,update,retire}` and `/documents/compliance` **exist** | **Partial** — requirement engine exists; per-employee required/verified/expiring/missing contract + tree does not |
| 6 | Account health & assistance | Ticket Center exists. No employee-profile wiring, no request/receipt/history/routing on this surface | **Missing (wiring)** |
| 7 | Contact change vs sign-in identity | `/employees/contact/update` exists with direct + request modes. No work-email → auth-identity verification workflow; no pending-verification state | **Partial** |
| 8 | Employment changes (effective-dated) | `/employees/{update,status-change,transfer,supervisor-change}` and `hr_employee_assignments` exist | **Partial** — commands exist; needs audit of effective-dating + direct-vs-request capability split |
| 9 | Activity & audit aggregation | `/employees/audit` returns `hr_audit_log` only, with actor names resolved | **Partial** — single source; needs app_events + document + workflow + support + offboarding merge, and server-side sensitive-metadata stripping |

New tables implied by gaps 3 and 4 (all need RLS, indexes, timestamps, text FK to `app_users.id`):
readiness control definitions, control instances, work items, work-item transitions, readiness
ownership configuration.

## E. Permission register

Spec §"Permissions" requires independently enforced permissions for 13 areas. Existing keys found
in `netlify/functions/lib/permissions.ts` cover: `hr.audit.view`, `hr.employee_documents.{view,
upload,download,verify,archive,sensitive_view,requirements.manage}`, `hr.employee.statutory.{view,
capture}`, `hr.employees.*`, `hr.access_profiles.view`.

Not yet present and required: profile-shell view, readiness view/review/follow-up, work-email
identity-change request, account-support request/history from HR, payroll/bank masked view,
offboarding view/start/update as distinct profile-scoped keys.

**Pitfall that applies to every new key** (CLAUDE.md, verified this build): a new permission key is
dead until a migration inserts the `role_permissions` rows. Adding it to both catalogues and
`permissionMeta` makes it typecheck and appear in the RBAC console, but every call still 403s.
Superadmin is allow-all in memory, which hides this during superadmin testing. Each slice that adds
a key must ship the `role_permissions` insert in the same migration and prove it with an E2E that
provisions a real user of that role (`ROLE_CACHE_TTL_MS` = 30s).

## F. Known conflicts / open questions

1. **Full-page mockup has no dark mode.** The drawer mockup carries 36 theme declarations; the
   full-page mockup carries **0**. The spec says dark mode "borrows the established original
   Employee Master drawer treatment." Full-page dark styling must therefore be *derived*, and there
   is no locked reference to compare it against. Flagged as an acceptance-gate gap.
2. **Locked references are not in the repo.** All four documents are untracked in the `b353`
   worktree. They should be committed (unmodified) so tests, reviewers, and the acceptance gate can
   reference them from `main`.
3. **Browser screenshot comparison** requires a signed-in session. `docs/…` records a
   browser-QA session recipe; the repository has no browser automation runner, so side-by-side
   comparison is a manual/assisted step, and the automation gap must be stated explicitly per the
   Enterprise Module Delivery Standard.
