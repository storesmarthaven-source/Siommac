# Employee Profile — Exact Mockup Implementation Contract

## Instruction To Claude

Implement the SIOMAC Employee Profile drawer and full employee page from the two approved HTML mockups below. These mockups are the visual and interaction specification. Reproduce them exactly; do not reinterpret, simplify, “improve,” restyle, rearrange, rename, or adapt their content to the current generic UI components.

### Locked Visual References

1. Drawer:
   `docs/mockups/employee-profile-drawer-unified-command-brief.html`
2. Full employee page:
   `docs/mockups/employee-profile-full-page.html`
3. Readiness collaboration and ownership behavior:
   `docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md`

Do not edit or overwrite these reference files during implementation. They are the acceptance baselines.
Record their hashes before the first edit and show the same hashes in the delivery report.

## Non-Negotiable Visual-Parity Rules

- Preserve the real SIOMAC application shell, navigation, routing, authentication, permissions, and global theme switch.
- Inside the Employee Profile surface, reproduce the approved markup and CSS exactly:
  - dimensions and proportions;
  - drawer width;
  - grid and column structure;
  - spacing, padding, and gaps;
  - borders, radii, separators, and shadows;
  - typography, font sizing, line height, weight, and title case;
  - colours, icon sizes, icon containers, pills, counters, and status badges;
  - the hero, facts strip, readiness panel, attention rows, cards, tables, timelines, forms, dialogs, and fixed action areas;
  - tab order, tab counters, visible labels, helper copy, button text, and empty states.
- Use Lucide icons matching the references. Align the SVG itself in the centre of every icon container; do not compensate with arbitrary per-icon offsets.
- The mockups contain no local light/dark toggle. Do not add one. Theme them from SIOMAC’s existing global theme state.
- Do not replace an approved section with `InfoCard`, `PanelStats`, `FieldList`, `MiniTable`, or another generic UI-kit component if doing so changes the approved appearance.
- UI-kit primitives may be reused only when their rendered result is visually identical. Otherwise create profile-specific reusable components.
- Do not add new badges, actions, KPIs, copy, tooltips, explanatory blocks, or menu items that are absent from the mockups.
- Do not omit an approved element because the current backend lacks its field. Implement the missing backend contract properly or report it as blocked; never insert invented fallback data.
- Do not ship hard-coded employee values from the mockups. Every displayed value must come from the authenticated API contract, a deliberate empty state, or a loading state.
- Do not leave both the generic legacy layout and the new exact layout in production. Build the replacement, wire it completely, then delete the superseded render paths and CSS.

## Product Boundary

The drawer and the full page serve different depths, but they must use the same data definitions and visual language.

### Drawer

The drawer is the rapid staff workspace. It answers:

1. Who is this employee?
2. What requires attention?
3. What is the employee’s current readiness and account state?
4. What action can the current user take next?

Implement every drawer tab and dialog present in the approved drawer mockup. Do not turn it into a reduced static preview.

### Full Employee Page

The full page is the detailed record workspace. Implement the approved tabs in this order:

1. Overview
2. Employment
3. Documents
4. Readiness
5. Access
6. Activity & Audit
7. Offboarding

Capability-gated tabs must disappear when the user cannot view them. Their data must also be protected at the API layer.

## Primary Frontend Targets

Rebuild the production UI using the approved mockups:

- `src/components/sections/HR/ProfileDrawer.tsx`
- `src/components/sections/HR/ProfileDrawer.css`
- `src/components/sections/HR/EmployeeProfilePage.tsx`
- `src/components/sections/HR/EmployeeProfilePage.css`
- `src/components/sections/HR/EmployeeMaster.tsx`
- `src/components/sections/HR/employeeMasterAccess.ts`
- `src/api/hr/employees.ts`

Extract profile-specific shared components instead of duplicating drawer and page logic. A sensible structure is:

- employee profile view-model and formatting helpers;
- employee hero;
- employment facts strip;
- needs-attention list;
- readiness summary;
- tab indicator;
- document-health summary;
- activity timeline;
- account-health summary;
- profile dialogs.

Names may follow current repository conventions, but the rendered result must match the locked mockups.

## Shared Data Model

Create one typed employee-profile shell model used by both surfaces. It should contain:

- identity:
  - employee ID;
  - display name;
  - profile photo;
  - employment status;
  - position;
  - department;
- employment facts:
  - employment basis;
  - work arrangement;
  - start date;
  - calculated continuous-service tenure;
- readiness:
  - overall score;
  - ready and total control counts;
  - unresolved work-item count;
  - last reviewed;
  - review owner;
  - next review;
- attention:
  - stable item ID;
  - domain;
  - title;
  - explanatory text;
  - severity;
  - due state/date;
  - owner;
  - responsible actor or team;
  - action label;
  - canonical action target;
- tab indicators:
  - unresolved count;
  - highest severity;
- contact summary;
- account-health summary;
- recent employee activity.

Use tab-specific endpoints for large or sensitive datasets. Do not load every document, audit entry, access event, and offboarding record merely to open the drawer.

## Current Contracts To Reuse

Use and preserve the repository’s existing canonical implementations where they already satisfy the requirement:

- Employee detail, assignment history, pay group, access profile, statutory profile, and payroll readiness from `src/api/hr/employees.ts` and `netlify/functions/routes/hr.ts`.
- Documents, training, audit, workflow summary, status changes, contact updates, statutory changes, and change requests from the existing HR routes and hooks.
- Offboarding from `src/api/hr/offboarding.ts` and the canonical HR offboarding backend.
- Bank-account data from:
  - `src/api/finance/bankAccounts.ts`;
  - `netlify/functions/routes/financeBankAccounts.ts`;
  - `netlify/functions/lib/finance/bankAccounts.ts`.
- Account-support requests from the existing Ticket Center/account-support backend. Do not create a second ticket system.

Never move protected banking actions into HR. HR sees only masked context and workflow state unless the organisation’s ownership configuration and the user’s capabilities explicitly permit HR to perform the domain action.

## Backend Gaps That Must Be Filled

The current employee detail contract is not sufficient for the approved UI. Implement these gaps at the source rather than simulating them in the frontend.

### 1. Profile Shell Read Contract

Provide a permission-filtered profile-shell response optimized for immediate drawer opening and employee switching. It must include identity, employment facts, readiness summary, attention preview, tab indicators, contact summary, account-health summary, and recent activity preview.

It may extend the canonical employee detail endpoint or use a dedicated endpoint, but there must be one authoritative contract shared by the drawer and page.

### 2. Unified Attention Contract

Create a canonical aggregation service for unresolved employee issues. It must aggregate genuine actionable items from:

- employment and assignment;
- statutory and payroll readiness;
- documents and expiries;
- training;
- access/account support;
- onboarding or offboarding where applicable.

Each item must identify its source, owner, current state, due state, next responsible party, capability requirements, and canonical action. Do not infer actions from display text.

The Needs Attention panel shows all unresolved employee issues through its scroll/view-all behavior. The tab indicators use the same source of truth.

### 3. Readiness Controls And Work Items

Replace the current assignment/payroll/training-only calculation with a typed readiness model that can cover the controls approved in the mockup.

Separate:

- a control: the rule that determines readiness;
- evidence: submitted information or documents;
- a work item: the collaboration record used to resolve a failed control;
- the resulting readiness state.

Required work-item fields:

- employee;
- control key and domain;
- owner;
- responsible team;
- status;
- severity;
- due date;
- submitted evidence references;
- reviewer;
- decision;
- decision reason;
- timestamps;
- correlation/request ID.

Transitions must be domain-aware:

- HR monitors and follows up by default.
- Payroll/Finance confirms or returns payroll/bank information in its canonical workspace.
- Learning/Training reviews training evidence.
- HR may act directly only when organisation ownership settings assign that responsibility to HR and the actor has the required capability.

The full readiness interaction is defined in `docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md`.

### 4. Readiness Ownership Settings

Add the expandable organisation configuration described in the collaboration note:

`Settings → Workforce → Readiness Ownership`

Store the responsible operating model and domain owners. Configuration never grants authority; permissions remain authoritative.

Do not hard-code department names or roles. Resolve a registered owner/receiver and fail closed if no valid destination exists.

### 5. Document Health

Provide a document requirement/readiness contract that can calculate:

- required count;
- verified count and percentage;
- expiring count and percentage;
- missing count and percentage;
- actual document tree/grouping;
- expiry state;
- verification state;
- the requirement that produced each expected document.

The Documents tab must use real records and real requirements. The approved health bar and tree list are not decorative.

### 6. Account Health And Assistance

Wire the existing account-support request system into the employee profile:

- read current non-technical account health suitable for HR;
- create an assistance request;
- return the created reference/receipt;
- show request history and current assignment/status;
- route according to the organisation’s support ownership setting;
- allow eligible direct handling for smaller organisations only through explicit capabilities and configuration.

HR must not receive session IDs, device identifiers, IP details, password controls, or technical security actions merely because it can view an employee.

### 7. Contact Changes And Sign-In Identity

Contact updates must distinguish employee contact data from authentication identity.

- Authorized HR can update permitted contact fields.
- Every accepted change writes the employee record and audit trail.
- If work email changes, create the real account-verification/support workflow before changing sign-in identity.
- Do not directly overwrite authentication email from the HR form.
- The UI must show the resulting pending-verification state.

### 8. Employment Changes

The approved employment forms must use effective-dated, audited commands. Do not patch the current employee row without maintaining assignment/status history.

Direct edits and request-for-change are separate operations:

- direct edit requires the relevant elevated capability;
- request change creates a tracked approval/workflow item;
- sensitive statutory/payroll fields use their own capabilities and server validation.

### 9. Activity & Audit

Build a permission-filtered employee activity aggregation contract from canonical records such as:

- HR audit entries;
- app events;
- document events;
- workflow/readiness transitions;
- account-support requests;
- employment/status changes;
- offboarding events.

The display timeline and the audit table must use real event IDs, actor identity, timestamps, area, action, outcome, and safe metadata. Sensitive metadata must be removed server-side.

## Mutation Standard

Every major mutation must complete the repository’s required side effects:

1. write the business record;
2. emit `app_events`;
3. write `audit_logs`;
4. create or transition workflow tasks where required;
5. create notifications, messages, tickets, or handoffs where required.

Use a transaction/RPC or the repository’s transactional-outbox pattern for dependent writes. Do not describe compensating cleanup as atomic. Do not return success if any required side effect failed.

Use a single correlation/request ID across the mutation, event, audit, work item, notification, and handoff.

## Permissions

Audit and enforce permissions separately for:

- profile shell view;
- employment view/edit;
- contact edit;
- work-email identity-change request;
- document view/upload/download/verify/archive;
- readiness view/review/follow-up;
- statutory view/edit;
- payroll/bank masked view and domain action;
- account-support request/history;
- account technical actions;
- audit view/export;
- offboarding view/start/update.

Frontend capability gating is presentation only. Every backend route must independently authorize the actor and scope the employee/record.

Do not broaden existing HR roles to gain password, session, device, MFA-administration, payroll approval, or bank-account approval powers.

## Performance And Employee Switching

The drawer currently has noticeable delay when opening and switching employees. Fix the data lifecycle, not just the spinner:

- preserve row-hover/focus prefetch where appropriate;
- query by employee ID and include the ID in every query key;
- abort or ignore stale requests when the selected employee changes;
- never show the previous employee’s data under the new employee’s name;
- render the cached shell immediately when valid;
- load large tab data only when that tab opens;
- avoid duplicate calls from the drawer and full page;
- invalidate only affected profile queries after a mutation.

Add a regression test that rapidly switches between employees and proves stale responses cannot replace the active employee.

## Dialog And Action Requirements

Implement the dialogs exactly as they appear in the approved mockups:

- Edit Employee Record, using the same dialog for area selection and form steps, with Back navigation;
- Request Change;
- Edit Contact Information;
- Add Document;
- account-assistance request and receipt/history;
- readiness blocker/work-item interactions;
- document verification/archive actions;
- offboarding actions.

Do not open a second nested dialog for a form step when the mockup keeps it in one dialog. Dialog footers must remain visible, content regions must scroll correctly, and no controls may be clipped at supported viewport sizes.

The three-dot menu and More Actions menus must contain only implemented, capability-appropriate actions. Remove placeholders.

## Theme And Responsive Behavior

- Light mode uses the exact approved light styling.
- Dark mode borrows the established original Employee Master drawer treatment while preserving identical hierarchy and interaction.
- Theme comes only from SIOMAC’s global theme.
- Maintain the approved drawer width at desktop sizes.
- At narrower supported sizes, reflow without deleting information or changing action priority.
- Avoid text wrapping introduced by implementation drift; use the mockup’s sizing and responsive rules.
- Respect `prefers-reduced-motion` for animated progress fills and other motion.

## Supabase And Migration Rules

- Protected ERP data remains behind authenticated Netlify JWT APIs. Do not add direct browser Supabase reads.
- Create schema changes using a new migration with the Supabase CLI naming convention.
- All new tables require RLS, indexes for profile/employee/status/due-date queries, timestamps, and correct text FKs for `app_users.id`.
- Do not auto-apply migrations to the live database.
- Do not assume a migration was applied because a count/head request succeeded; verify real rows and required function behavior.
- Current Supabase platform behavior may not automatically expose new public tables to the Data API. This implementation should not depend on browser Data API exposure; the authenticated backend remains the boundary.

## Implementation Sequence

1. Inventory every visible element, state, dialog, and interaction in both locked mockups.
2. Produce a parity checklist before editing production components.
3. Define the shared typed profile shell/view-model and capability map.
4. Implement or extend the backend read contracts.
5. Implement the missing mutation/workflow contracts and migrations.
6. Build shared profile-specific components.
7. Replace the drawer with the exact approved drawer.
8. Replace the full page shell and all seven tabs with the exact approved page.
9. Wire every visible action and dialog.
10. Add global-theme dark styling without a local switch.
11. Delete superseded render paths, unused generic adapters, and obsolete CSS.
12. Verify typechecks.
13. At the end, run unit tests once, then the focused live E2E suite.
14. Inspect both surfaces in the signed-in browser at the approved viewport sizes and compare them side-by-side with the locked HTML references.

## Required Tests

### Unit/Component

- shared profile view-model formatting;
- title case and date/tenure formatting;
- capability-gated tabs and actions;
- tab indicator counts/severity;
- all approved dialogs and Back behavior;
- attention overflow/scroll behavior;
- document-health calculation/rendering;
- global light/dark theme behavior;
- stale employee-switch response protection;
- loading, empty, partial, denied, and error states.

### Live E2E

Extend `scripts/e2e/suites/hrEmployeeMaster.mjs` or add the appropriately scoped profile suite. Cover:

- every new read endpoint;
- every mutation and transition;
- drawer opening and employee switching;
- all seven full-page tabs;
- authorized and unauthorized users;
- exact response fields consumed by the frontend;
- event, audit, workflow, notification, ticket, and handoff side effects;
- readiness collaboration for each ownership model;
- fail-closed behavior when no valid receiver exists;
- work-email verification workflow;
- account-assistance creation, receipt, routing, and history;
- cleanup of all tagged test records.

## Visual Acceptance Gate

Do not report completion until browser inspection proves:

- drawer structure matches the drawer mockup;
- full page structure matches the full-page mockup;
- every tab matches its approved layout;
- hero, readiness, attention, document health, access, and activity treatments match;
- typography is not smaller than the references;
- icons are centred;
- no unexpected wrapping or clipping exists;
- no duplicate buttons or duplicate information remain;
- no placeholder values, dead buttons, generic fallback cards, or local theme toggle exist.

Capture screenshots of:

1. drawer overview;
2. drawer dark mode;
3. full-page overview;
4. Employment;
5. Documents;
6. Readiness;
7. Access;
8. Activity & Audit;
9. Offboarding;
10. each major dialog.

## Required Delivery Report

Claude must return:

- the exact commit hash;
- every changed file;
- every new/changed endpoint and response contract;
- every migration and whether it remains unapplied;
- permissions added or changed;
- unit/typecheck/E2E output verbatim;
- browser screenshot paths;
- before/after hashes proving both locked mockup files are unchanged;
- explicit confirmation that the locked mockups were not changed;
- explicit confirmation that no visible element was adapted away from the references;
- any remaining backend or product gap, stated plainly.

“Implemented,” “matched,” “green,” or “done” without the browser comparison, live contracts, side-effect assertions, and exact evidence above is not acceptable.
