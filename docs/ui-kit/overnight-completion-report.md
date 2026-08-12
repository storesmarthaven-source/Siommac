# UI Kit v2 — Autonomous Completion Report

Updated: 2026-08-12

## ⭐⭐ NEXT SESSION — BUILD THE STUDIO. Do not resume migration.

```
branch  codex/ui-kit-v2-completion
HEAD    c715e604
objective  Build the actual SIOMAC Design System Studio, using the canonical
           system this programme has spent its whole life creating.
```

### Cold-start sequence
```
1. Read AGENTS.md                      (commit-trailer + worktree rules were fixed)
2. Read this report
3. Verify  branch = codex/ui-kit-v2-completion
           HEAD   = c715e604
           tree   = clean
4. ✅ typecheck baseline MEASURED — see below
5. Begin Studio implementation
```
✅ **Step 4 is done, and the inherited number was wrong.** Measured at
`513c579f`: `npm run typecheck:frontend` = **50 errors, not 49**. The 49 figure
had been carried across sessions unverified. Zero of the 50 are in `src/ui/`.
Top files: EmailTemplateBuilder 6 · EmailTemplateLibrary 5 ·
NewAssessmentWizard 4 · NewPermitWizard 4 · EmployeeMaster 3.

⭐ **Use 50 as the baseline.** Had the next session measured 50 against an
expected 49, it would have hunted a phantom regression; had it introduced one and
measured 50, it would have waved a real one through. An off-by-one in an
inherited baseline is exactly how that happens.

### Implementation order
```
Studio shell + navigation
→ real registry integration
→ built / planned / pattern classification
→ component workbench
→ Brand Overview / Theme Generator
→ scoped theme previews
→ Application Preview
→ responsive Desktop / Tablet / Mobile
```

⛔ **Do NOT reopen broad consumer migration just because coverage numbers exist.**
The consolidation has produced enough stable foundation to realise the product.
Remaining component debt continues later; the Studio is the priority now.

**Read first:** the corrected `AGENTS.md` (commit-trailer + worktree rules were
both wrong and are fixed) · this report · `src/ui/registry/`.

**Classification is settled — honour it:**
- `category: 'patterns'` (20) = module/business compositions. Excluded from
  primitive catalogue completeness. Show them separately *only* if useful as
  application/domain patterns, NEVER as missing canonical components.
- Real catalogue debt is **8 primitives**: Popover · Tooltip · Breadcrumbs ·
  AvatarGroup · Alert · Progress · Accordion · Drawer (a 3-export consolidation).
- ⭐ **Do not wait to build all eight before starting the Studio.** Show them
  honestly as missing/planned and implement them later where required.

### ✅ Phase 1 — BUILT AND BROWSER-VERIFIED

Shell at `72f05f5a`; verification and its two fixes at `a22fa82c` / the Studio
responsive commit. Verified live at `localhost:5243` (worktree Vite proxying the
Desktop repo's API on 8888), superadmin dev session injected:

| Check | Result |
|---|---|
| Studio renders, no white screen | ✅ 1 `.sds` root, 23 app sections, 605KB body |
| Brand / Foundations / Components / Application nav | ✅ 4 groups, 10 items, click switches title + panel |
| `FoundationsPanel` inside Studio | ✅ renders, 83KB, inside `data-ui-preview-scope` |
| `BrandThemePanel` inside Studio | ✅ renders, 27KB, inside the scope |
| Chrome stays neutral | ✅ **proven** — forced `--ui-color-action-primary:#ff00ff` inside the scope; scope read `#ff00ff`, chrome still `#E40C0C`. No leak. |
| Built / Planned / Application-pattern states | ✅ 23 + 8 + 20 = 51 chips = 51 registered definitions |
| No duplicate catalogue | ✅ 51 cards, one nav, one root |
| Console clean | ⚠️ see below |
| Desktop / tablet / mobile | ✅ after fixing a real defect, below |

**Two real defects found by doing this, both fixed:**
1. `SodChangeWizard.tsx` imported `@ui/components/Button|Modal` — paths that do
   not exist. Vite aborts the module graph on an unresolvable import, so the app
   rendered an empty body with zero sections. This is the long-standing "dev app
   renders an empty body" blocker. Typecheck 50 → **49**, which reconciles the
   inherited baseline: the extra error WAS this import.
2. Studio pattern cards rendered **421px inside a 311px column** at 375px wide.
   A grid item defaults to `min-width: auto` and will not shrink below its
   content's min-content width; the planned-API `<pre>` holds long unbroken JSX
   signatures. Fixed with `min-width: 0` on the card and `overflow-wrap: anywhere`
   on the `<pre>`. All 51 cards now a uniform 311px, zero overflow.

⚠️ **Console is not clean:** repeated 503s. They are API calls from other ERP
sections booting, not the Studio — the Studio issues no network requests, it
reads the registry. The worktree Vite proxies to the Desktop repo's netlify
instance, which is on a different branch. Not a Studio defect; worth confirming
once the worktree can run its own API.

⚠️ **Worktree has no `.env`** — the app cannot boot without
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. A minimal gitignored `.env` with
only those two public client vars now exists locally; service-role secrets were
deliberately NOT copied.

⛔ **Phase 1 shell is FROZEN.** Do not redesign it while building Phase 2.

### Phase 1 — new Studio shell (the first commit)
Built from the ground up, NOT a reskin of the small existing Gallery.
```
SIOMAC Design System
├── Brand         Brand Overview · Theme Generator · Logo & Assets
├── Foundations   Colors · Typography · Spacing · Radius · Icons
├── Components    registry-driven canonical catalogue
└── Application   App Shell · Dashboard · Forms · Data Views · Workflow
```
Scale: ~15px body · 17–22px section/component headings · ~26px primary title ·
40–44px controls · large readable preview canvases. Neutral professional chrome —
no gradients, restrained shadows, and none of the microtext-dense developer-tool
look. First commit contains: page structure · navigation · neutral shell ·
registry integration · built/missing/pattern classification · responsive
workspace foundation. Workbench, Brand board and Application Preview layer on top
in SEPARATE commits.

### Phase 2 — registry-driven catalogue + workbench
The Components area consumes the REAL registry. ⛔ No duplicate JS list, no
static mock catalogue, no mock components duplicating canonical ones. Per built
component: Overview · Playground · Usage · Accessibility · Code. For the 8
missing primitives: an honest planned/missing state — never a fabricated
specimen.

### Phase 3 — Brand experience (REUSE, do not rebuild)
The engine already exists: logo extraction · HCT / Material Color Utilities ·
semantic role mapping · accessibility · Draft → Preview → Apply · persistence.
Build the polished workflow *around* it: Upload Logo → Analyze Brand → Generate
Theme → Enterprise / Balanced / Brand Forward → Component System Preview →
Application Preview → Apply. ⛔ Studio chrome stays NEUTRAL; only explicit
preview scopes receive customer draft variables (see the `[data-ui-preview-scope]`
second-root rule — a var() resolves where it is DECLARED).

### Phase 4 — Application Preview
Dashboard · Forms · Data · Workflow, each at Desktop · Tablet · Mobile, built
from real canonical components. It must read as a realistic SIOMAC application,
not a specimen sheet.

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

## Tabs programme — frozen

Clean family completed:

- migrated the nine clean overview surfaces — Environmental, Emergency
  Response, Documents, Contractors, Workflows, Training, Legal Compliance,
  Toolbox and Notification Centre — from `TabBar` to canonical `Tabs`;
- migrated HR Organization Structure and the clean Worker Profile drawer in
  the same batch;
- replaced legacy key/sublabel/count adapters with canonical `TabItem`
  configuration, including real icon nodes, descriptions, badges and actions;
- wired every migrated body through `TabPanel`, preserving the tablist / tab /
  tabpanel accessibility relationship and canonical keyboard model;
- deleted the unused pre-v2 generic `src/ui/components/Tabs.tsx` runtime and
  its `LegacyTabs` barrel export;
- added regression coverage for all eleven migrated surfaces and the deleted
  legacy runtime;
- passed all 39 focused Tabs/migration tests with zero lint errors, reduced the
  known frontend typecheck baseline from 52 to 49 errors, and reduced
  deprecated-import files from 89 to 83;
- browser-verified the representative Environmental set with one canonical
  tablist, four tabs, one correctly linked panel, working tab selection, zero
  legacy tab bars and no runtime diagnostics in the isolated preview.

Tabs classification is now frozen:

```text
Tabs canonical system       COMPLETE
Clean overview migration    COMPLETE
Legacy generic runtime      DELETED
Dirty/deferred call sites   RECORDED DEBT
```

The exact debt is four HSE `TabBar` pages (`Inspections.tsx`, `Permits.tsx`,
`RiskJsa.tsx`, `Incidents.tsx`) and nine old-signature drawer/detail files with
pre-existing lint blockers. The unused `ModulePageLayout` export is not counted
as an application consumer. Tabs must not be reopened solely to chase those
counts.

The next canonical component is Dialog.

## Dialog programme — frozen

Clean HSE form family completed:

- migrated the Environmental spill report, Emergency drill log, HSE document
  upload, contractor registration, EMA permit and Toolbox Talk flows from
  `HseModal` to canonical compound `Dialog` composition;
- migrated all four live Training flows — add certificate, renew certificate,
  assign training and create role requirement — with canonical busy state and
  disabled submit actions during mutations;
- preserved every form field, submit side effect, reset and close path while
  replacing the legacy title/sub/submit props bag with explicit
  `Dialog.Header`, `Dialog.Body` and `Dialog.Footer` ownership;
- passed all 29 focused Dialog/migration tests with zero lint errors, held the
  49-error known frontend typecheck baseline and reduced deprecated-import
  files from 83 to 78;
- browser-verified the canonical form dialog with matched `aria-labelledby`,
  canonical footer actions, working close behaviour, one canonical sheet and
  zero legacy `.ui-modal` frames.

Dialog classification is now frozen:

```text
Dialog canonical system     COMPLETE
Clean HSE form migration    COMPLETE
Business dialog flows       PRESERVED
Dirty/deferred overlays     RECORDED DEBT
```

The exact remaining HSE `HseModal` debt is `Incidents.tsx`, `Inspections.tsx`,
`PPEManager.tsx` and `inspections/InspectionDialogs.tsx`; each has pre-existing
lint blockers. The broader pre-v2 `Modal` and `HrfinWizardModal` consumers are
named ownership debt for later natural touches and the Wizard cycle rather than
a reason to keep Dialog open.

The next canonical component is Wizard / Stepper.

## Wizard / Stepper programme — frozen

Classification and clean migration completed:

- migrated Copy Budget, a real ordered two-step Finance flow, to canonical
  `Wizard` composed inside canonical `Dialog`;
- preserved its fiscal-year and adjustment validation, gated progression,
  preview query, back navigation, terminal copy mutation and busy state;
- correctly reclassified four one-step `HrfinWizardModal` flows as Dialogs —
  record payment, resolve warning, create disbursement and create remittance —
  instead of manufacturing meaningless one-step wizards;
- passed all 34 focused Wizard/classification tests with zero lint errors, held
  the 49-error known frontend typecheck baseline, increased canonical app
  adoption from 101 to 104 files and reduced deprecated-import files from 78
  to 74;
- browser-verified the ordered two-step flow inside Dialog: one labelled step
  navigation, correct `aria-current`, working Continue transition, panel focus
  update, terminal submit action and zero legacy wizard frames.

Wizard / Stepper classification is now frozen:

```text
Wizard canonical system     COMPLETE
Clean ordered migration     COMPLETE
Single-step pseudo-wizards  RECLASSIFIED AS DIALOG
Dirty/deferred flows        RECORDED DEBT
```

The remaining true multi-step `HrfinWizardModal` flows and four `Stepper`
consumers are named ownership debt. The HSE permit/risk wizard files are exact
deferred debt because they have pre-existing lint and type blockers. Wizard
must not be reopened solely to chase those counts.

The next canonical component is PageHeader / PageActionBar.

## PageHeader / PageActionBar programme — frozen

Canonical promotion and clean action-family migration completed:

- corrected PageHeader at the source: it is now a native page landmark with
  one semantic `h1`, keyed breadcrumb fragments and decorative icons removed
  from the accessibility tree;
- deleted the no-op `meta` and `hidePill` contract, relocated the only shared
  meta-chip type to its actual owner (`UserPill`), and removed PageHeader's
  unreachable meta surface CSS;
- built PageActionBar as the canonical labelled action group for context,
  secondary actions, one primary action and the shared DropdownMenu overflow;
- migrated the complete Organization Structure header-action family from
  `.obx-btn` controls to PageActionBar plus canonical Buttons;
- registered both real components and removed PageActionBar from the planned
  catalogue; catalogue completeness is now 42% (20 canonical components),
  with app adoption held at 31%;
- passed all three focused tests with zero lint errors, held the 49-error known
  frontend typecheck baseline and browser-verified one page `h1`, the labelled
  action group, working overflow menu and zero legacy header buttons.

PageHeader / PageActionBar classification is now frozen:

```text
PageHeader canonical system     COMPLETE
PageActionBar canonical system  COMPLETE
Clean action family migration   COMPLETE
Hrfin/dirty header consumers    RECORDED DEBT
```

The nine `HrfinPageHeader` consumers remain named migration debt. They do not
justify another broad header sweep; migrate them only when their owning feature
is naturally touched. The next canonical component is EmptyState.

## EmptyState / Skeleton / Loading programme — frozen

Canonical feedback states and the clean workflow family are complete:

- promoted EmptyState into a component-owned recipe with default/compact sizes,
  Font Awesome or canonical icon nodes, configurable heading level and opt-in
  status/alert announcement semantics;
- retained static absence as quiet content by default rather than making every
  empty card an unsolicited live-region announcement;
- registered the existing canonical Skeleton shape family and compact Spinner,
  and corrected Spinner so an omitted visible label still has a screen-reader
  loading name;
- migrated the complete platform/HSE workflow family from two conflicting
  `.wf-empty` systems to canonical EmptyState and Spinner;
- deleted HSE Workflows' module-local Skeleton and migrated all six cold paths
  to canonical ListSkeleton, reducing module-local primitives from 26 to 25;
- deleted both `.wf-empty` CSS definitions and moved EmptyState's base, navy
  drawer and light Finance drawer styling into its canonical recipe;
- passed all four focused tests with zero new lint errors, held the 49-error
  known frontend typecheck baseline and browser-verified default and compact
  treatments, semantic headings, dark-drawer contrast, the loading status and
  three aria-hidden skeleton rows;
- catalogue completeness is now 45% (23 canonical components). The newly
  registered `.hrfin-empty` and `.obx-empty` debt is measured but is not a
  mandate for another broad migration sweep.

Feedback-state classification is now frozen:

```text
EmptyState canonical system    COMPLETE
Skeleton canonical system      COMPLETE
Spinner / Loading system       COMPLETE
Clean workflow family          COMPLETE
Dirty/local empty states       RECORDED DEBT
```

The exact local EmptyState debt remains in `PermitDetailDrawer.tsx`,
`HazardDrawer.tsx`, `JsaDrawer.tsx` and `RiskAssessmentDrawer.tsx`; those HSE
files were already deferred for existing blockers. Broader `.hrfin-empty` and
`.obx-empty` text states migrate only during natural feature work. The next
canonical family is Checkbox / RadioGroup / Switch.

## Checkbox / RadioGroup / Switch programme — frozen

The canonical choice controls were already implemented and registered; this
cycle verified their native behavior and completed the highest-leverage clean
family:

- added focused coverage for the real native checkbox indeterminate property,
  read-only enforcement, radio grouping/value selection and Switch pending
  state with `aria-busy`;
- deleted NavCustomizer's module-local button-based Switch and its entire
  `.navcust-switch` CSS system; navigation visibility still applies immediately
  through canonical Switch and retains state-specific accessible names;
- migrated Calendar's all-day form value to canonical Checkbox and removed its
  raw input sizing rule;
- migrated the lint-clean Pay Policy and segregation-of-duties governed choice
  cards to canonical Radio while deliberately preserving their business card
  layout and feasibility/current-state treatments;
- passed all five focused behavior/migration tests with zero new lint errors,
  held the 49-error known frontend typecheck baseline, reduced module-local
  primitives from 25 to 24 and reduced unmanaged raw markup by seven;
- browser-verified real selected indicators, the two governed card layouts,
  working radio selection, Switch state/name updates and zero legacy switches.

Choice-control classification is now frozen:

```text
Checkbox canonical system     COMPLETE
RadioGroup canonical system   COMPLETE
Switch canonical system       COMPLETE
Clean choice family           COMPLETE
Raw/dirty consumers           RECORDED DEBT
```

`NotificationPreferences.tsx` retains a Toggle-shaped local control because the
file has an existing lint blocker. Remaining raw checkbox/radio sites are named
consumer debt and do not justify a broad forms sweep. The next component is Menu.

## Menu programme — frozen

The canonical action-menu system and its clean described-action family are
complete:

- extended canonical DropdownMenu actions with optional descriptions while
  preserving keyboard navigation, type-ahead, disabled-item skipping, Escape
  dismissal and focus return;
- corrected the menu's open-state focus effect so it follows the actual flattened
  item collection rather than a stale derived value;
- migrated Training and Statutory Configuration from `NewMenu` to canonical
  DropdownButton, retaining icons, disabled rules and explanatory copy;
- deleted the unused pre-v2 `Menu.tsx` runtime, its barrel export and the surface
  CSS owned only by that implementation;
- passed all 24 focused action/menu tests with zero lint errors in changed files,
  held the 49-error known frontend typecheck baseline and browser-verified initial
  focus, arrow navigation, disabled-item skipping, wraparound, Escape dismissal
  and trigger focus restoration;
- catalogue completeness remains 45% (23 canonical components), while app
  adoption advances to 32% (107 of 331 measured consumers).

Menu classification is now frozen:

```text
Menu canonical system             COMPLETE
Clean described-action migration  COMPLETE
Unused pre-v2 runtime             DELETED
Dirty/local action menus          RECORDED DEBT
```

The remaining `NewMenu` consumers in `RiskJsa.tsx`, `Incidents.tsx`,
`Inspections.tsx` and `Permits.tsx` are exact dirty-file debt. Existing
RowActionMenu compositions remain domain-owned debt and migrate only during
natural feature work. Menu must not be reopened to chase those counts.

## Remaining programme

The overall mandate is not yet complete. Continue automatically:

1. one bounded classification/promotion pass for genuinely small registered
   canonical components
2. polished UI Kit Studio interface
3. Brand Theme application preview at all required breakpoints
4. final full-suite and browser verification gate

No component should chase mathematical zero. Exact dirty files and genuine
domain/interaction exceptions remain recorded debt; clean generic migration is
the completion criterion. The hard migration boundary has now been reached:
after the bounded small-component pass, broad legacy sweeps stop and the Studio
plus its real registry-backed Brand/Application workbench becomes the primary
workstream.
