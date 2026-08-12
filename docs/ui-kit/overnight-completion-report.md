# UI Kit v2 — Autonomous Completion Report

Updated: 2026-08-12

## Authoritative working state

| Item | Current value |
|---|---|
| Worktree | `C:\Users\MSI Laptop\.codex\worktrees\ui-kit-v2\Siomac` |
| Branch | `codex/ui-kit-v2-completion` |
| Source branch | `ui-kit/overnight-completion` |
| Source HEAD verified at fork | `5ebba1c6` |
| Remote operations | None; all work is local |

The protected HR worktree and Desktop checkout were not modified.

## Local commits in this continuation

```text
1d03fdec  fix(ui): restore compliance layout after Badge migration
632d1266  ui: close generic Badge migration
81f6664a  feat(ui): add persistent TextInput affixes
b0a68940  ui: collapse legacy selects onto canonical Select
```

Every commit passed the repository index check and lint-staged hook. Every commit
contains the repository-required co-author trailer. Nothing was pushed.

## Verification baseline

The clean continuation branch begins with 52 frontend TypeScript errors. They
are pre-existing load-bearing branch debt, chiefly Tabs/Wizard/Button contracts
and Email/HR surfaces. This replaces the stale 12-error figure in the earlier
report, which described a different dirty checkout.

Current verification:

| Gate | Result |
|---|---|
| Changed-file ESLint | 0 errors; existing warnings only |
| Frontend typecheck | 52 errors; unchanged baseline, no migration-introduced errors |
| Badge focused tests | 22/22 passed |
| TextInput/FormField focused tests | 26/26 passed |
| Select + field compatibility focused tests | 60/60 passed |
| Card + first-family focused tests | 40/40 passed |
| Repository index | Green after every commit |
| Full test suite | Reserved for the final programme gate per `AGENTS.md` |

## Badge closure

Status:

```text
Badge canonical system         COMPLETE
Clean generic migration        COMPLETE
HSE domain color systems       INTENTIONAL EXCEPTION
Dirty/deferred surfaces        RECORDED DEBT
Interactive chips              OWNED BY OTHER CONTROLS
Status semantic audit          SEPARATE DEBT
```

The closure batch:

- routes `HrfinPill` through canonical Badge as a bounded domain adapter;
- migrates clean HR onboarding, payroll, settings, gallery and security status labels;
- translates domain status vocabularies to semantic `BadgeTone` at their source;
- removes proven-zero-consumer badge CSS from every duplicate stylesheet layer;
- preserves HSE Permit/Risk/RiskScore domain colours;
- preserves interactive, identity, date, presence and compound metadata controls;
- leaves `InfoCard.Pill` deferred because its automatic dark-drawer contrast is
  contextual and cannot honestly map to Badge's explicit static `contrast` prop;
- leaves `DesignsMenu`, Access Control and the known Tabs/Card-overlap files as
  exact-file lint-blocked debt.

Coverage after Badge closure measured 388 legacy class uses, down from 399 at
the start of this continuation. Canonical Badge JSX exceeded 200 sites, while
72 Finance uses route through the canonical `HrfinPill` adapter.

## TextInput / FormField

Status: clean migration complete; blocked debt recorded.

Root capability work:

- added persistent `prefix` and `suffix` value affixes;
- kept affixes separate from trailing affordances, so loading, clear and
  validation may replace `iconRight` without hiding `%`, currency or units;
- added an honest uncontrolled mode for retained native-form/DOM integrations;
- added `style` and click forwarding to support real composed layouts;
- moved Number, Currency and Percentage presets from icon slots to affix slots;
- migrated all three `AdminSections` percentage suffix hacks;
- deleted unused `LegacyTextInput`;
- migrated lint-clean raw `.ui-input`, textarea and date consumers.

Measured result:

```text
.ui-input legacy uses     39 -> 13
raw <input> inventory     613 -> 587
raw type="date"           105 -> 95
raw <textarea>             63 -> 60
```

The 13 remaining application `.ui-input` uses are in files with existing lint
blockers. They are deferred rather than mixed with their Tabs/HSE programmes.

## Select / Combobox

Status: clean migration complete; one blocked application consumer remains.

- `Field`, `SelectInput` and `TextareaInput` compatibility names now delegate to
  canonical FormField, Select and Textarea; they no longer preserve parallel
  implementations.
- All 34-file `SelectInput` usage now receives canonical listbox keyboard and
  accessibility behaviour through the shared chokepoint.
- Clean raw `.ui-select` consumers were migrated directly.
- Canonical Select now displays an explicit empty-value option label such as
  “All statuses” or “Unassigned”, and retains it as a selectable option.
- Tests prove label association, empty-option preservation and legacy CSS removal.

Measured result:

```text
raw <select> inventory    287 -> 261
application .ui-select    27  -> 1
```

The one remaining application `.ui-select` is in
`OnboardingBlockedBoard.tsx`, which has pre-existing lint errors.

## Current coverage snapshot

```text
Canonical components       18
Missing components         29
Legacy class usages        336
Module-local primitives     27
Unmanaged raw patterns    2983
Catalogue completeness     38%
App adoption               30% (101/332 TSX files)
```

These are inventory metrics, not completion claims. Raw markup includes native
controls intentionally owned by DateInput, FileInput, OTP, calendar, editor and
other specialized behaviours.

## Card programme — in progress

Canonical Card already owns the correct surface contract: variant, density,
tone, accent, interaction, selection, disabled, loading, flush body, header and
footer. The remaining named cards must be classified by content ownership:

- `StatsCard`, `KpiCard`, `SparkCard`: metric/chart content compositions;
- `InfoCard`: detail composition with contextual dark-drawer rendering;
- `RailCard`: Finance layout composition;
- Toast, weather, deadline and widget cards: domain compositions;
- raw `*-card` classes: migrate only when their surface CSS is deleted in the
  same batch.

First clean family completed:

- migrated all 17 payroll creation wizard surfaces to canonical `Card` and
  `CardHeader`;
- preserved `WizardPanel` and `SummaryCard` as payroll content compositions;
- mapped the three statutory tiles to the canonical metric variant;
- removed the complete `.pcrw .card`, `.sec-head`, `.sec-ico`, `.sec-title`,
  `.sec-head .aux` and `.panel-body` surface family rather than retaining a
  second frame underneath Card;
- added a regression test that proves the first step renders three canonical
  panels and none of the retired wrapper/header/body classes;
- browser-verified the real wizard at desktop width with correct canonical
  heading rhythm, frame, body spacing and zero console warnings/errors.

Second clean family completed:

- migrated 33 payroll run workspace frame definitions/call sites to canonical
  `Card`, including the page summary strips and the preserved `RunPanel`,
  close/release, calculation-failure and crew content compositions;
- deleted the complete scoped `.prw .card`, `.panel-body`, `.sec-head`,
  `.sec-ico`, `.sec-title` and `.sec-head .aux` surface implementation;
- retained full-bleed table/list layouts through Card's body slot and `flush`
  contract rather than layering old padding or borders underneath it;
- added full-page regression coverage proving canonical Card adoption and the
  absence of all retired surface wrappers;
- passed 73 focused tests across canonical Card and the payroll workspace;
- browser-verified representative run-header, table-panel and financial-summary
  surfaces with three canonical cards, zero legacy cards and no runtime or
  console diagnostics.

Card classification is now frozen:

```text
Card canonical system       COMPLETE
Clean surface migration     COMPLETE
Domain compositions         PRESERVED
Dirty/deferred surfaces     RECORDED DEBT
```

`StatsCard`, `KpiTile`, `SparkCard`, `InfoCard`, `EmployeeCard`, weather,
deadline, widget and toast cards remain domain or interactive compositions.
`PPEManager.tsx` (11 metric mini-cards) and `Incidents.tsx` (8 incident/CAPA
cards) are exact deferred files because they have existing lint blockers and
belong to later HSE work. Card must not be reopened solely to chase those counts.

The next canonical component is DataTable.

## DataTable programme â€” in progress

First clean family completed:

- migrated Employees and Attendance History from the imperative
  `@shared/DataTable` wrapper to canonical DataTable;
- replaced HTML-string cell renderers with typed Preact cells and canonical
  badges, preserving client sorting and pagination;
- added pinned identity columns as an explicit canonical column capability;
- deleted the jQuery/CDN DataTables wrapper, its tests and barrel export;
- reduced deprecated-import files from 91 to 89, module-local primitives from
  27 to 26, and unmanaged raw tables from 213 to 210;
- passed all 36 canonical DataTable tests with zero lint errors.

Second clean family completed:

- migrated all four Finance Statutory Configuration registers (versions, NIS
  bands, pay components and NIS verification) to canonical DataTable;
- promoted pinned identity columns and module-owned toolbar compositions into
  the canonical contract, preserving advanced filters, sorting, row actions and
  server-style pagination;
- deleted the Finance `.dt-*` overrides and both pre-v2 DataTable runtime/style
  pairs (`src/ui/DataTable.*` and `src/components/shared/DataTable.*`);
- retained one type-only `DtColumn` debt marker for
  `EmailTemplateLibrary.tsx`, whose seven existing lint errors make it an exact
  deferred Studio-owned file rather than a reason to keep the old runtime.

DataTable classification is now frozen:

```text
DataTable canonical system  COMPLETE
Clean register migration    COMPLETE
Legacy runtimes/styles      DELETED
Dirty/deferred register     RECORDED DEBT
```

The next canonical component is Tabs.

## Remaining programme

The overall mandate is not yet complete. After Card, continue automatically:

1. DataTable
2. Tabs
3. Dialog
4. Wizard / Stepper
5. PageHeader / PageActionBar
6. EmptyState
7. Skeleton / Loading
8. Checkbox / RadioGroup / Switch
9. Menu
10. remaining registered canonical components
11. polished UI Kit Studio interface
12. Brand Theme application preview at all required breakpoints
13. final full-suite and browser verification gate

No component should chase mathematical zero. Exact dirty files and genuine
domain/interaction exceptions remain recorded debt; clean generic migration is
the completion criterion.
