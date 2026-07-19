# Payroll Pay-Policy Setup Delivery Contract

**Owner:** Finance Payroll configuration owners  
**Status:** Implemented; live target verification pending
**Branch/HEAD:** `codex/payroll-policy-setup` / `f4659c3f9f34ad64c54975e866f0eb317d906b4e`  
**Database target:** Not linked in this isolated worktree; live verification pending  
**Approved scope date:** 2026-07-19

## 1. Objective

- Business problem: payroll has pay groups/components/statutory records but no governed,
  effective-dated contract that composes them into an approved policy.
- Measurable outcome: an authorized user can create, validate, submit, approve, activate, assign,
  compare, and retire a local T&T pay policy without a direct browser database read or partial
  multi-row mutation.
- Primary personas: payroll configurator, HR source reviewer, Finance statutory reviewer,
  Finance activation approver.
- Secondary personas: payroll processor (read), auditor (read).
- Authority: repository payroll specification §14; currency TTD; timezone AST
  (`America/Port_of_Spain`); local PAYE/NIS/Health Surcharge only.

## 2. Scope

### In scope

- Phase A `standard_salary` and `hourly_shift` policies.
- Server-persisted wizard drafts and strict typed rules.
- Central workflow source/statutory review and independent activation.
- Effective pay-group assignments.
- Directory and seven detail tabs matching the approved mockup’s information architecture.

### Explicit non-goals

- Phase B crew/offshore/marine/standby/project policy types and sources.
- Payroll-run policy resolution/snapshots/calculation changes.
- Foreign workers, foreign currency, split currency, reciprocal agreements.
- Generic accounting mapping design; Phase A uses the existing employee cost-centre and GL
  contracts only.
- Employee loan operations and Payslip Studio.

### Dependencies

| Dependency | Owner | Contract | Failure behavior |
|---|---|---|---|
| Pay groups | Finance Payroll | `finance_pay_groups` | Picker/read fails explicitly; assignment cannot proceed. |
| Pay components | Finance | approved active component catalogue | Missing/retired component blocks preflight. |
| Statutory config | Finance | active TT statutory version by effective date | Missing version blocks submission/activation. |
| Workflow | Platform | binding + workflow tasks/decisions | Submission is atomic or rolls back. |
| Communications | Platform | notifications/event delivery | Durable rows commit with activation; worker owns delivery. |
| Handoff bus | Platform | `handoff_outbox` | Pending/dead-letter is operator visible; business state remains explainable. |

## 3. Current-state verification

| Item | Evidence |
|---|---|
| Repository root | `C:\Users\MSI Laptop\.codex\worktrees\3977\Siomac` |
| Branch/HEAD | `codex/payroll-policy-setup` / `f4659c3f...` |
| Existing changes | Clean before contract creation. |
| Running server | A Vite process runs from `C:\Users\MSI Laptop\Desktop\Siomac`, not this checkout; it is not valid verification evidence. |
| Migration state | No `supabase/.temp/project-ref`; no live target claimed. Latest committed filename scanned through `20260919000460`. |
| Existing surface | `PayrollSetupOverview.tsx`; pay-group/overtime/loan APIs; no policy tables/routes/suite. |

## 4. UI inventory

| ID | Control | Permission | Behavior/API | Validation/state | E2E |
|---|---|---|---|---|---|
| UI-PPS-001 | Pay Policies tab/directory | policies.view | API-PPS-001 | loading/empty/error/forbidden/populated | BUI-PPS-001 |
| UI-PPS-002 | Search/status/page controls | policies.view | API-PPS-001 | server filtered, clearable, bounded | BUI-PPS-002 |
| UI-PPS-003 | New Policy | policies.draft | opens wizard | hidden without permission | BUI-PPS-003 |
| UI-PPS-004 | Wizard identity | policies.draft | API-PPS-003/004 | code/name/description/type/effective dates | BUI-PPS-004 |
| UI-PPS-005 | Wizard components | policies.draft | API-PPS-004 | canonical picker; typed combination validation | BUI-PPS-005 |
| UI-PPS-006 | Wizard sources | policies.draft | API-PPS-004 | required source owner/outcome | BUI-PPS-006 |
| UI-PPS-007 | Save Draft | policies.draft | API-PPS-003/004 | optimistic token; toast/error | BUI-PPS-007 |
| UI-PPS-008 | Preflight | policies.view | API-PPS-005 | exact blockers/warnings/checksum | BUI-PPS-008 |
| UI-PPS-009 | Submit | policies.submit | API-PPS-006 | certifications + no blockers | BUI-PPS-009 |
| UI-PPS-010 | Detail tabs | policies.view | API-PPS-002 | URL hash/tab state | BUI-PPS-010 |
| UI-PPS-011 | Create New Version | policies.draft | API-PPS-016 | active policy only; one unpublished version | BUI-PPS-011 |
| UI-PPS-012 | Compare Versions | policies.view | API-PPS-012 | explicit empty/no-change state | BUI-PPS-012 |
| UI-PPS-013 | Assign Pay Group | policies.assign | API-PPS-014 | active version/date/overlap gates | BUI-PPS-013 |
| UI-PPS-014 | End Assignment | policies.assign | API-PPS-015 | reason/date required | BUI-PPS-014 |
| UI-PPS-015 | Activate | policies.activate | API-PPS-007 | approved only; creator denied | BUI-PPS-015 |
| UI-PPS-016 | Reject Review | step-specific approver | API-PPS-008 | reason required | BUI-PPS-016 |
| UI-PPS-017 | Retire Policy | policies.activate | API-PPS-009 | reason/effective date; confirmation | BUI-PPS-017 |

Existing Pay Groups and Overtime Rules tabs remain wired to their current contracts. The current
Loans & Advances setup tab is removed from this configuration surface.

## 5. API inventory

The exact endpoint inventory is API-PPS-001 through API-PPS-016 in
`PAYROLL_PAY_POLICY_SETUP_CONTRACT_TO_CODE_MAP.md`. All routes:

- use strict Zod schemas and `body.args ?? body`;
- authenticate/authorize before service calls;
- select explicit response fields;
- reject unknown fields and Phase B enums;
- bound lists to default 25 and maximum 100;
- never accept actor, legal entity, currency, jurisdiction, approval status, or checksum.

## 6. Data model and migration

| Object | Constraints/security | Migration |
|---|---|---|
| Six `finance_pay_*` business tables + command receipts | checks/FKs/exclusion constraints/indexes; RLS; service-role only | `20260919000600_finance_pay_policy_setup.sql` |
| Pay-policy permissions and role grants | distinct view/draft/submit/source/statutory/activate/assign keys | same |
| Workflow template/binding | two sequential review steps | same |
| Draft/submit/transition/activate/assignment/retire RPCs | security definer, fixed search path, service-role execute only | same |

- Apply order: migration 600 after existing migrations.
- Backfill: none; no fake seed policy.
- Recovery: remove only unreferenced Phase A objects in a disposable environment; production
  rollback uses a forward migration and preserves audit/evidence.
- Existing migration released: No.
- PostgREST reload: Yes.

## 7. State machines

| From | Action | To | Actor | Preconditions | Repeat/concurrency |
|---|---|---|---|---|---|
| none | create | draft | draft | strict complete draft payload | same key/hash returns original |
| draft | update | draft | creator or draft permission | expected token matches | stale token 409 |
| draft | submit | pending_approval | submit | preflight passes; 3 certifications | receipt dedupes |
| pending_approval | workflow approve final review | approved | assigned reviewers | creator cannot approve | workflow locks task/state |
| pending_approval | reject | rejected | assigned reviewer | reason | repeat 409 |
| approved | activate | active | activate | actor != creator; preflight passes | policy/version locks; one winner |
| active | activate newer version | superseded + new active | activate | no overlap after lock | one winner |
| active | retire | retired | activate | reason/effective date | receipt dedupes |

## 8. Mutation ownership

| ID | Write/effects | Transaction owner |
|---|---|---|
| MUT-PPS-001 | policy + draft version/rules + event + audit + receipt | draft command RPC |
| MUT-PPS-002 | draft/rules replacement + event + audit + receipt | draft command RPC |
| MUT-PPS-003 | version pending + workflow/tasks/audits/events + business audit/event + receipt | submit RPC calling workflow primitive |
| MUT-PPS-004 | source transition + event + audit + receipt | workflow transition RPC |
| MUT-PPS-005 | active/superseded rows + event + audit + notifications + handoff + receipt | activate RPC |
| MUT-PPS-006 | assignment + event + audit + handoff + receipt | assignment RPC |
| MUT-PPS-007 | assignment end + event + audit + receipt | assignment RPC |
| MUT-PPS-008 | retirement/assignment closure + event + audit + notification/handoff + receipt | retire RPC |
| MUT-PPS-009 | next draft + copied governed rules + event + audit + receipt | copy-version RPC |

All request keys are browser-owned per user action and stable across retry. Hashes include the
canonical business payload; same key/different payload returns `409`.

## 9. Permission matrix

| Persona | View | Draft | Submit | Source review | Statutory review | Activate | Assign |
|---|---:|---:|---:|---:|---:|---:|---:|
| Finance staff | Y | Y | Y | N | N | N | N |
| HR manager | Y | N | N | Y | N | N | N |
| Finance manager | Y | Y | Y | N | Y | Y | Y |
| Employee | N | N | N | N | N | N | N |

Creator cannot activate their own version. Workflow task assignment and decision rules enforce
review participation; route permissions do not replace task authorization.

## 10. Query/UX/test contract

- Directory uses cursor pagination ordered by `updated_at desc, id desc`; default 25, max 100.
- Detail performs bounded batch reads, not per-row N+1 loops.
- Cold loads show skeletons; cache data remains visible during refetch.
- All dialogs manage focus and Escape; success/failure produces a toast/dialog.
- Unit: strict schemas, rule compatibility, preflight normalization, version comparison.
- Live suite: `scripts/e2e/suites/payrollPayPolicies.mjs`, every API/transition/permission/effect.
- Browser: authorized directory, wizard validation/save/submit, separate approval/activation,
  assignment, forbidden state.
- Cleanup: tag policy code/name with `h.TAG`, track exact IDs, remove platform effects by source ID.

## 11. Decisions and deferrals

| ID | Decision | Reason | Milestone |
|---|---|---|---|
| DEC-PPS-001 | Split Phase A/B | Full crew + run snapshot slice is not safely atomic in this delivery. | Phase B requires explicit approval. |
| DEC-PPS-002 | Fixed T&T server-owned attributes | Prevent dormant generic/foreign controls. | Revisit only with approved jurisdiction scope. |
| DEC-PPS-003 | No widget board | Wizard/detail are fixed configuration workspaces. | None. |
| DEC-PPS-004 | No seed policy | An active policy would imply run-engine resolution that Phase B has not delivered. | Seed only with Phase B cutover. |

## 12. Approval

- Product/scope approval: User authorized autonomous Payroll Setup slice on 2026-07-19.
- SQL/security review: pending implementation.
- UX approval: approved mockup adapted per Phase A boundary.
- Test-plan approval: contract-defined; executable evidence pending.
