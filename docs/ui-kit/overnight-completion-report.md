# UI Kit v2 — Autonomous Run Report

**Read the scope note first.** The brief asked for an overnight run to completion.
This was a single bounded session, not an overnight one. Section 9 lists exactly
what the brief asked for that was NOT reached, so nothing here reads as more
finished than it is.

---

## 1. Starting state

| | |
|---|---|
| Branch at start | `main` |
| HEAD at start | `437314ce` |
| Integration branch | `ui-kit/overnight-completion` (created at `437314ce`) |
| Tracked dirty files | 31 (unrelated in-flight programmes — preserved) |
| Stashes | 6 pre-existing (untouched) |
| Worktrees | 31 pre-existing (untouched) |

The 31 dirty files are load-bearing UI-Kit-v2 API repairs plus in-flight Tabs and
Card work. They were never discarded; every commit isolated around them with the
stash procedure and restored afterwards.

## 2. Baselines (measured at run start, not assumed)

| Gate | Baseline | Final |
|---|---|---|
| `typecheck:frontend` | 12 errors, all in 3 Email Studio files | 12, same files |
| `src/ui` tests | 638 passed / 28 files | 638 passed |
| HR + UI tests | 800 passed, 1 failed | 800 passed, 1 failed |
| Known failure | `EmployeeProfilePage.test.tsx` › "filters the activity table" | unchanged |
| `repo:index:check` | red on dirty tree (expected) | handled per commit |

No unrelated programme failures were repaired to make UI Kit commits look green.

## 3. Commits produced on the integration branch

```
22dfdcc4  ui(hr): migrate the Employee Profile badges to canonical Badge
```

Earlier commits from this session are on `main` and are ancestors of the branch:

```
437314ce  ui: migrate the clean static status badges to canonical Badge
a583b040  ui: migrate the helper-routed status badges to canonical Badge
ef120f90  feat(ui): bridge the domain status model to canonical Badge
b2da1c24  ui: migrate the lint-clean .btn consumers to canonical Button
7cc5e5a9  feat(ui): FileInput button-shaped trigger + last obx-btn batch
9a7195ad  fix(hr): drop the redundant loading guards on five HR queries
5ed9173f  ui(hr): migrate the clean obx-btn consumers to canonical Button
e6f7458f  ui(settings): retire the stg-btn family
1f0c5aa7  ui(settings): migrate the Preact stg-btn consumers to canonical Button
d326e306  fix(settings): clear the lint blockers on the Settings surfaces
4c0043ba  ui(finance): remove retired statutory button styles
```

## 4. Badge programme — state

```
Legacy Badge usages remaining: 425
Canonical Badge usages:         74
```

Architecture landed and proven:

```
domain status → statusTokens → badgeTone() bridge → canonical <Badge>
```

- `badgeTone()` / `badgeToneFromText()` translate the domain vocabulary. The two
  vocabularies stay separate: `negative → neutral`, `critical → danger`. A test
  asserts `danger` has exactly one source.
- `StatusPill` is a thin domain adapter rendering canonical Badge — 17 call sites
  moved with no edits to them.
- Four legacy status helpers gained tone-returning siblings; `incidentBadgeTone`
  was kept because it adds real domain meaning.
- 38 Employee Profile badges, 26 helper-routed, 10 clean static.

**Defect caught:** `.epf-root .badge` bare class was GREEN (`--green-soft`), not
neutral. Mapping it the obvious way would have silently greyed ten passing
states. Same class of trap as `btn-danger-primary` being a *primary* modifier.

## 5. Button programme — FROZEN

Canonical Button is complete (BTN-01, all variants, tone, loading, disabled,
focus, `pressed`). `sfp-btn` and `stg-btn` retired with CSS deleted from every
duplicate location. Remaining legacy Button usage is recorded debt and was not
pursued, per the freeze.

## 6. Legacy CSS retired

| Family | Where | Note |
|---|---|---|
| `.sfp-btn*`, `.sfp-spin` | `statutoryForms.css` | zero consumers first |
| `.stg-btn*`, `.stg-danger-label` | `settings.css` **and** `views.css` | both copies — deleting one would have been a false retirement, since `sections` out-ranks `components` |

## 7. Deferred, with reasons

| Surface | Reason |
|---|---|
| `PPEManager` | Card consolidation in flight **and** 11 of 13 visible buttons have no handler — product decision |
| `OrgStructureOverview`, `HRDocumentsOverview`, `OnboardingPackageDetail` | in-flight Tabs consolidation; stash cannot split a file |
| HSE drawers (`Documents`, `PermitDetailDrawer`, `HazardDrawer`, `JsaDrawer`, `RiskAssessmentDrawer`, `WorkerProfileDrawer`, `FindingDetailDrawer`, `InspectionDetailDrawer`) | same in-flight Card/Tabs work |
| `Incidents`, `Inspections`, `RiskJsaQueueTabs` | pre-existing lint errors incl. **"Cannot call impure function during render"** (`Date.now()` in render). Fixing changes *when* values compute — behavioural, and it unlocks only 9 sites |
| AccessControl pages | 52 pre-existing `no-unnecessary-condition` errors; needs its own programme |
| `shell/modals/EmployeeModals.tsx`, `ProjectSiteModal.tsx` | orphaned shells — nothing opens them, no handlers. Dead-code cleanup, not migration |
| 15 interactive pill/chip controls | segmented options, filter chips, calendar events — owned by other canonical controls, explicitly not Badge |

## 8. Separately recorded debt

**Status semantic audit** — `overdue`, `expired`, `failed`, `blocked` and
`critical-priority` resolve to domain `negative` ⇒ neutral grey. Live QA also
showed "Active" and "Expired" both rendering info blue, because `toneFromText`
matches neither keyword list. Badge faithfully renders the decision it receives;
this is a status-model question, deliberately untouched.

## 9. NOT reached (the honest list)

None of this was started, and none of it is blocked by a product decision — it
simply exceeds one session:

1. **The new UI Kit Studio interface** (brief §14) — the enterprise design-system
   workspace, navigation, component workbench, Brand Overview board, Application
   Preview at three breakpoints, progressive-disclosure advanced theme details.
   This is the single largest item in the brief and is essentially greenfield.
2. **Brand Theme preview policy work** (§16) — the expected-propagation matrix
   and multi-fixture verification.
3. **Gallery real-component audit** (§15) beyond the FileInput entry added earlier.
4. **Components after Badge** (§11) — TextInput, Select, Card, DataTable, Tabs,
   Dialog, Wizard, PageHeader, EmptyState, Skeleton, Checkbox/Radio/Switch, Menu.
   No inventory was run for any of them.
5. **Badge completion** — 425 legacy usages remain; wrappers (35) untouched;
   `src/components/shared/Badge.tsx` not removed; no badge CSS retired yet.
6. **Parallel subagents** (§13) — not used; see the note below.

## 10. Git

- Everything local. **Nothing pushed.** No remote branch, no PR, no force-push.
- No `--no-verify`; every commit passed `repo:index:check` + lint-staged.
- Working tree restored to its original 31 dirty files after every commit.
- Pre-existing stashes and worktrees untouched.
