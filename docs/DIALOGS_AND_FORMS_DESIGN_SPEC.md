# SIOMAC — Enterprise Dialogs & Forms Design Specification

_The target design for every dialog and form in the app. Today most are a plain box
with a few fields; this spec defines the enterprise-grade version of each — context,
live preview, guidance, validation, side-effects, and approval routing — using the
**New Org Unit** dialog ([OrgStructureOverview.tsx](src/components/sections/HR/OrgStructureOverview.tsx))
as the built reference._

Companion to [DIALOGS_INVENTORY.md](docs/DIALOGS_INVENTORY.md) (what exists today). This is
what they should **become**.

---

## 1. The problem

A create/edit form today = a stack of inputs in a box. It asks the user to fill fields
with **no context**: where does this record land, what will it affect, what's inherited,
what's valid, what happens after save, does it need approval. That's a data-entry form,
not an enterprise workflow surface. Lifecycle actions (reject / cancel / lock / verify)
are worse — a one-line `confirm` with no record context at all.

## 2. The design system (apply to every dialog/form)

### 2.1 Anatomy — the two-pane dialog
```
┌───────────────────────────────────────────────────────────────┐
│  [icon]  Title                                          [×]     │
│          Subtitle: one line of intent / consequence            │
├──────────────────────────────┬────────────────────────────────┤
│  FORM (left, ~1.35fr)        │  CONTEXT PANEL (right, ~1fr)    │
│                              │                                 │
│  • grouped fields            │  • Placement / breadcrumb       │
│  • inline help & placeholders│  • Live preview of the record   │
│  • smart defaults            │  • Inherited / derived values   │
│  • validation as you type    │  • Related counts & impact      │
│                              │  • Validation warnings (live)   │
│                              │  • "What happens next" callout  │
│                              │  • Approval-routing notice      │
├──────────────────────────────┴────────────────────────────────┤
│                                   [Cancel]   [Primary action]  │
└───────────────────────────────────────────────────────────────┘
```
Collapses to a single column < 720px.

### 2.2 The seven enrichment elements (pick the ones that fit each form)
1. **Placement / breadcrumb** — where the record sits (org path, case #, run period, parent).
2. **Live preview** — render the record as it will appear (name + type pill + code chip; a mini row).
3. **Inherited / derived values** — what it takes from context if left blank (site & cost-centre from parent, statutory version from active, rate from grade). Show as "Inherits X".
4. **Related counts / impact** — siblings, affected employees/positions, headcount vs budget, dependent records.
5. **Live validation** — duplicate code, key already taken, date overlap, negative net, out-of-range %, self-reference — shown the instant it's true, not on submit.
6. **"What happens next"** — the side-effects per Spec §2 (events, audit, tasks, handoffs, notifications) in plain language.
7. **Approval routing** — when a change exceeds the risk threshold, say so *before* submit ("routes for approval — high risk"), and label the button accordingly.

### 2.3 Reusable building blocks (all exist in `@ui` today)
- `Modal size="lg"` with `sub` — the shell. `Wizard`/`WizardShell` for 3+ step creates.
- `FormGrid` + `Field`/`TextInput`/`SelectInput`/`TextareaInput` — the left form.
- `Callout` (mark/title/status/alert) — validation + "what next" + approval notices.
- `FieldList`/`FieldRow`, `MiniTable`, `Pill` — the context panel.
- **To build once:** `<DialogContextPanel>` (the right aside wrapper) and `<ActionModal>`
  (the enriched confirm/reason dialog — record header + fields + warning + optional reason
  + "what happens next"), so lifecycle actions stop using bare `dialog.confirm`/`prompt`.

### 2.4 Lifecycle actions (reject / cancel / lock / verify / retire …)
Replace bare `dialog.confirm`/`dialog.prompt` with **`<ActionModal>`**:
```
┌─────────────────────────────────────────────┐
│ [icon] Reject pay item                       │
│  Record: Jane Doe · Housing Allowance        │
│  ┌─ Amount   TTD 1,200.00 / month           │
│  ├─ Effective 2026-07-01 → open             │
│  └─ Status   Pending approval  [pill]        │
│  ⚠ Rejecting returns this item to draft.     │
│  Reason (required) [__________________]      │
│                        [Cancel] [Reject]     │
└─────────────────────────────────────────────┘
```

---

## 3. Reference implementation — New Org Unit (built)

Form (left): Name, Code, Type, Manager, Site, Cost centre, Description.
Context (right): placement breadcrumb · live type-pill + code-chip preview + type blurb ·
parent + sibling count · inherited Site/Cost-centre from parent · duplicate-code alert ·
"after you create this unit" callout. See §2.1. This is the bar for everything below.

---

## 4. Per-dialog / per-form target specs

> Format: **Form (left)** — fields · **Context (right)** — the enrichment · **Actions**.

### HR ▸ Organization
| Dialog | Context panel should show |
|---|---|
| **New/Edit Unit** ✅ built | breadcrumb · live preview · siblings · inherited site/CC · dup-code · what-next |
| **New/Edit Position** | reporting line preview (reports-to → this → default supervisor) · **headcount budget vs current filled** bar · org-unit + site chips · "safety-critical → vacancies flag as critical" callout · dup position-key warning |
| **New/Edit Cost Centre** | owning-unit breadcrumb · owner chip · "used by N units / M positions" · code-uniqueness · what-next |
| **Move Unit** | before → after breadcrumb (from-parent ⇒ to-parent) · **subtree that moves with it** (child count, employees) · cycle-detection warning (can't move under own descendant) · approval-routing notice |

### HR ▸ Documents
| Dialog | Context panel should show |
|---|---|
| **Upload Document** | employee chip · document-type description + whether it satisfies an open **requirement** · expiry preview ("expires in 11 months") · file name/size/type validation · replaces-existing warning |
| **New Requirement** | applies-to scope (role/dept/all) · "N employees will be evaluated" · example of what counts as satisfied |
| **Verify / Archive** (→ ActionModal) | doc name/type/owner/expiry · who uploaded · "verifying satisfies requirement X" / "archiving hides it from the register" |

### HR ▸ Offboarding
| Dialog | Context panel should show |
|---|---|
| **New Case** | employee chip (dept, manager, tenure) · reason description · **last-working-day → exit-date** timeline · package preview (tasks + handoffs that will be created) · "raises IT access-removal handoff; sets status → terminated on finalize" |
| **Cancel Case** (→ ActionModal) | case #, employee, current stage · open tasks/handoffs that will be voided · reason required |

### HR ▸ Onboarding
| Dialog | Context panel should show |
|---|---|
| **Pause / Resume / Ready / Complete / Cancel / Provision** (→ ActionModal) | case #, employee, stage, blocking-task count · for Ready: readiness checklist status · for Provision: the mailbox/login that will be created · for Complete: remaining open items · approval/side-effects |
| **Add Task / Add Custom Action** | where in the plan it inserts · blocking? requires-evidence? · handoff target preview |

### HR ▸ Leave
| Dialog | Context panel should show |
|---|---|
| **Submit Leave** | **live balance** for the type (entitled / taken / remaining) · working-days computed (excludes weekends/holidays) · overlap warning with existing leave · coverage note (who's out same dates) · approval chain preview |
| **Review** (approve/reject) | requester chip · dates + days · remaining balance after · team coverage that week · reason |

### HR ▸ Requests / Transfers
| Dialog | Context panel should show |
|---|---|
| **New Request / New Transfer** | employee chip · **from → to** diff (dept, manager, position, pay) · effective date · "routes as maker-checker; you can't approve your own" · risk level |
| **Decide / Fulfill / Cancel** (→ ActionModal) | request #, type, requester · the before→after diff · SoD notice |

### HR ▸ Roster
| Dialog | Context panel should show |
|---|---|
| **New Roster** | period + site/dept · coverage requirements vs projected · "generate from rotation pattern" preview |
| **New Shift Template** | live time-span + break → **net paid hours** · overlap with existing templates · which sites use it |
| **Reopen** (→ ActionModal) | roster #, period, published assignments that will be editable again · reason |

### HR ▸ Compensation / Overtime
| Dialog | Context panel should show |
|---|---|
| **New Pay Item** | employee chip · component (earning/deduction, taxable?, reduces-chargeable?) · **effect on gross/net preview** · effective-date overlap with an existing item for same component · "maker-checker: needs a second approver" |
| **Statutory Profile** | employee chip · NIS continuity summary (opening YTD) · "HR captures; **Finance verifies** — you cannot mark verified" · what submit does |
| **Reject / Retire / Cancel** (→ ActionModal) | item/OT identity, employee, amount, dates, status · consequence line |
| **Log Overtime** | date + hours × multiplier → **payable hours preview** · "feeds the next payroll run; immutable once paid" |

### Finance ▸ Statutory Configuration
| Dialog | Context panel should show |
|---|---|
| **New Rate Version** | effective-from vs current active version · **PAYE band preview** (a sample gross → PAYE) · "created as draft → maker-checker (a second finance_manager must approve)" · overlap/gap warning with existing versions |
| **NIS Class upsert** | version + weekly band being edited · continuity check (no gaps/overlaps across classes) · employee/employer split preview |
| **New Component** | kind + taxable + reduces-chargeable implications in plain language · code uniqueness · "used by N pay items" (on edit) |
| **Verify / Reject NIS** (→ ActionModal) | employee, NIS #, previous employer, opening YTD · "verifying unlocks payroll for this employee" |
| **Activate / Retire Version** (→ ActionModal) | which version becomes/leaves active · **"the current active version will be retired"** · effective date · payroll impact |

### Finance ▸ Payroll
| Dialog | Context panel should show |
|---|---|
| **New Pay Run** | period + frequency + **weeks-in-period** · active statutory version that will apply · "inputs pulled: approved pay items + approved overtime + statutory profiles" · employees in scope count |
| **Lock / Reopen / Submit / Export** (→ ActionModal, run detail) | run #, period, employee count, gross/net/employer-NIS totals · **warnings count** (unverified NIS, missing rate) · state-transition consequence ("lock makes figures immutable"; "reopen clears lines + inputs") · approval routing |

### Settings / Console (same treatment)
Passkey/trusted-device/manifest actions → `ActionModal` with device/session/manifest context;
Console role/permission modals already two-pane — add live "N users affected" + diff preview.

---

## 5. Reference implementations already in the app (copy these)
- **New Org Unit** (§3) — two-pane create with live context. ✅ built.
- **Employee Master action dialogs** — [ActionDialogs.tsx](src/components/sections/HR/ActionDialogs.tsx) use `ModalSection` + `SystemActionsPanel` ("what the workflow will do"). Good pattern for the "what happens next" element.
- **Create Employee Wizard** — [CreateEmployeeWizard.tsx](src/components/sections/HR/CreateEmployeeWizard.tsx) — multi-step create with per-step guidance; the model for anything with 3+ logical groups (New Pay Run, New Offboarding Case, New Rate Version).

## 6. Build plan
1. **Build two shared pieces:** `<DialogContextPanel>` (right-aside wrapper: blocks, breadcrumb, preview, field-list, callouts) and `<ActionModal>` (enriched confirm/reason). ~1–2 days.
2. **Enrich create/edit forms** module-by-module using the §4 specs — Org (Position/CostCentre/Move) → Offboarding → Compensation/Overtime → Finance → Documents/Leave/Requests/Transfers/Roster.
3. **Migrate lifecycle actions** off `dialog.confirm`/`prompt` onto `<ActionModal>` (the ~31 in the inventory).
4. Some context (e.g. leave balance preview, PAYE preview, headcount-filled) needs a small **preview/derive endpoint or field** — flagged per-row above; add where the panel needs server data.

## 7. Acceptance bar (per dialog)
A dialog is "enterprise-done" when: it shows where the record lives, previews the result,
surfaces inherited/derived values, validates live, states side-effects + approval routing,
and never asks for a decision (reject/cancel/lock) without showing the record it acts on.
