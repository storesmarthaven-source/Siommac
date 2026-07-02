# SIOMAC mockup guide — build mockups that port cleanly

Purpose: build UI mockups (in Codex or anywhere) that drop into this codebase with
minimal rework. The rule of thumb: **a mockup ports cleanly when it matches the
component MODEL, not the language.** A `.tsx` that hand-builds DOM strings ports no
better than plain HTML. What ports is Preact JSX + the real class names + the real
field shapes.

## TL;DR

- Build each mockup as ONE Preact `.tsx` component with **hardcoded data** in a single
  `const MOCK_* = [...]` at the top.
- Use the real `@ui` primitives (below) and the real CSS class families (below).
- Name your mock data with the **exact camelCase field names** from
  `types/hrOnboarding.ts` — then porting = delete the `MOCK_*` const, add the
  `useOnboarding*` hook, done.
- New CSS goes in a `.css` file next to the component; wrap its body in
  `@layer sections { … }` (a TS `import './x.css'` can't carry a layer token).

## Stack facts (non-negotiable, or it won't compile here)

- **Preact, not React.** `import { useState } from 'preact/hooks'`; `import { type VNode } from 'preact'`.
- `class=` not `className=`. Text inputs fire `onInput`, selects fire `onChange`.
- Path aliases: `@ui` → `src/ui`, `@api` → `src/api`, `@lib` → `src/lib`,
  `@store` → `src/store`, `@shared` → `src/components/shared`. Types live at
  `../../../../types/hrOnboarding` from an HR component.
- Icons are FontAwesome classes: `<i class="fas fa-list-check" />`.
- `noUncheckedIndexedAccess` is on — `arr[0]` is `T | undefined`; guard it.

---

## Component skeleton (copy this)

```tsx
// src/components/sections/HR/OnboardingXyzWorkspace.tsx  — MOCKUP
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { PageHeader, Modal, Field, FormGrid, TextInput, SelectInput } from '@ui';
import { humanize, fmtDate, taskStatusPill, pillClass } from './onboardingStatus';
import './onboardingCase.css';   // reuse the existing sheet; don't invent a parallel one

// Mock data — field names MATCH types/hrOnboarding.ts so the port is a find-replace.
const MOCK_ROWS = [
  { taskId: '1', taskTitle: 'Collect ID documents', caseNo: 'ONB-2026-0053',
    employeeName: 'Ervin Baptiste', status: 'pending', dueAt: '2026-07-12', isBlocking: true },
];

export function OnboardingXyzWorkspace({ onBack }: { onBack: () => void }): VNode {
  const [query, setQuery] = useState('');
  const rows = MOCK_ROWS.filter(r => r.taskTitle.toLowerCase().includes(query.toLowerCase()));
  return (
    <div class="hr-onboarding-xyz">
      <button class="obx-back" onClick={onBack}>← Onboarding</button>
      <PageHeader
        icon="fa-list-check" module="HR · Onboarding" title="Xyz"
        sub="One-line description of the workspace."
        meta={[{ icon: 'fa-list-check', label: `${rows.length} items` }]}
        actions={<button class="obx-btn primary">+ New</button>}
      />
      <div class="obx-toolbar">
        <input class="ui-input" style={{ flex: 1 }} placeholder="Search…"
          value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
        <select class="ui-select"><option>All statuses</option></select>
      </div>
      <div class="obx-section">
        <div class="obx-section-body">
          <table class="obx-table">
            <thead><tr><th>Task</th><th>Case</th><th>Status</th><th>Due</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.taskId}>
                <td><b>{r.taskTitle}</b>{r.isBlocking && <span class="obx-pill red" style={{ marginLeft: 8 }}>blocking</span>}</td>
                <td class="obx-meta">{r.caseNo}</td>
                <td><span class={`obx-pill ${pillClass(taskStatusPill(r.status))}`}>{taskStatusPill(r.status).label}</span></td>
                <td class="obx-meta">{fmtDate(r.dueAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

Porting this to real data: delete `MOCK_ROWS`, add `const q = useOnboardingTasksList({...})`,
`const rows = q.data ?? []`. The JSX and CSS are already final.

---

## `@ui` primitives — exact signatures (import from `'@ui'`)

Page shell:
- `PageHeader` — `{ icon: string; title: string; sub?: string; module?: string; crumbs?: string[]; meta?: {icon?: string; label: string}[]; actions?: VNode }`

Overlays:
- `Modal` — `{ open: boolean; title: string; sub?: string; icon?: string; size?: 'sm'|'md'|'lg'; children; onClose: () => void; onSubmit?: () => void; submitLabel?: string; submitDisabled?: boolean; cancelLabel?: string; footer?; overlayClass?: string }`
- `Drawer` — `{ open: boolean; title: string; sub?: string; children; onClose: () => void; foot?; noFooter?: boolean; headActions?; rich?: boolean }`
- `Wizard` / `WizardShell` — multi-step; see `OnboardingWizard.tsx` for a live example.

Forms (import `Field, TextInput, SelectInput, TextareaInput, FormGrid`):
- `Field` — `{ label: string; children; wide?: boolean }` (`wide` spans both grid columns)
- `TextInput` — `{ value: string; onInput: (v: string) => void; placeholder?: string; type?: string }` (use `type="date"`/`type="number"`)
- `SelectInput` — `{ value: string; onInput: (v: string) => void; options: string[] | {value: string; label: string}[]; placeholder?: string }`
- `TextareaInput` — `{ value: string; onInput: (v: string) => void; placeholder?: string; rows?: number }`
- `FormGrid` — `{ children }` (2-col responsive grid; put `<Field>`s inside)

Rich panel body (for Drawer/SidePanel contents):
- `InfoCard` — `{ title: string; action?: VNode; children }`
- `FieldList` — `{ children; loading?: boolean; skeletonRows?: number }` wrapping `FieldRow`s
- `FieldRow` — `{ icon?: string; label: string; value: VNode | string }`
- `MiniTable` — `{ cols: string[]; empty: VNode | string; children: VNode[]; loading?: boolean }`
- `Pill` — `{ tone: PillTone; children }` where `PillTone = 'green'|'amber'|'red'|'purple'|'blue'|'gray'`
- `PanelEmpty` — `{ children }`
- `EntityHead`, `PanelStats`, `PanelTabs`, `Callout`, `ActivityList` — for full entity panels

Data + empty/loading:
- `Tabs` — `{ tabs: {key: string; label: string}[]; active: string; onChange: (k) => void; counts?: Record<string, number> }`
- `EmptyState` — `{ icon: string; title: string; text?: string; note?: string; tone?: 'blue'|...; actions?: VNode }`
- `TableSkeleton` — `{ rows?: number; cols: number; firstCellAvatar?: boolean }` (drops into a `<tbody>`)
- `SkeletonText` — `{ lines?: number }` · `Skeleton` — `{ height?; width?; circle?; radius? }`
- `Pagination` / `usePagination` — server-paged tables (see `OnboardingOverview.tsx`)

Charts (SVG, no lib): `Sparkline`, `BarRow`, `ProgressBar`.

CSV export (for Reports mockups): `exportCsv(rows, columns, filenameBase)` where
`columns: { header: string; value: (row) => string|number|null }[]`.

---

## CSS class families — reuse these, don't fork them

Three scoped stylesheets already own the onboarding look. Import the matching one.

### `.obx-*` — plain admin tables/forms (`onboardingCase.css`)
Use for Case Detail, Tasks Workspace, Package Manager — any list/CRUD surface.
- `.obx-back` — the "← back" link
- `.obx-section` / `.obx-section-head` (`<h2><i/>Title</h2>`) / `.obx-section-body` — a card
- `.obx-table` — the table (uppercase gray headers, hover, hairline rows); `.obx-table b` = dark title
- `.obx-pill` + tone: `.obx-pill.green|.amber|.red|.blue|.gray` — status pills
- `.obx-btn` + `.primary` / `.amber` / `.danger`, and `.obx-btn-sm`; `.obx-mini` (row button); `.obx-mini-select` (inline reassign dropdown)
- `.obx-rowbtns` — flex wrapper for row actions; `.obx-meta` — muted cell; `.obx-overdue` — red bold
- `.obx-empty` — centered empty message; `.obx-checkline` — checkbox + label row
- `.obx-toolbar` — filter bar; `.obx-viewswitch` / `.obx-view-btn.active` — segmented view switch
- `.obx-board` / `.obx-board-col` / `.obx-board-head` / `.obx-board-count` / `.obx-board-cards` / `.obx-taskcard` — kanban board
- `.obx-actions` / `.obx-owner` — PageHeader action cluster + owner selector

### `.obw-*` — Overview KPI card widgets (`onboardingWidgets.css`)
White KPI card: `.obw` shell → `.obw-kpi` (`.obw-kpi-main` with `.obw-cap` + `.obw-kpi-icon`
[`.purple|.red|.green|.orange`] + `.obw-num` + `.obw-delta`) → a mini-chart on the right
(`.obw-spark` / `.obw-ring` / `.obw-growth`). Also `.obw-pt`/`.obw-pb` (panel header/body),
`.obw-rl`/`.obw-ready`/`.obw-bar`[`.orange|.red`] (readiness meters), `.obw-acts`/`.obw-act`
(activity feed), `.obw-empty`.

### `.ocw-*` — Case Detail KPI tiles (`onboardingCaseWidgets.css`)
Vibrant per-case tiles: `.ocw` + tint (`.tint-blue|green|amber|red|purple`), `.ocw-head`
(`.ocw-title`/`.ocw-sub` + `.ocw-chip`), `.ocw-body`, `.ocw-num`, `.ocw-gauge`/`.ocw-ring`/
`.ocw-batt` (viz), `.ocw-foot`/`.ocw-foot-cell` (sub-stat strip), `.ocw-list`/`.ocw-li`
(pill lists), `.ocw-pill` + tone.

### Generic (`ui*.css`, always available)
`.ui-input`, `.ui-select`, `.ui-textarea` (bare form controls), `.ui-mini-btn`,
`.ui-field`/`.ui-field-row`, `.ui-pill`, `.ui-warn`.

---

## Status colors — one source (`src/components/sections/HR/onboardingStatus.ts`)

Don't hardcode hex. Import the pill helpers so pills match everywhere:
- `caseStatusPill(status)` / `taskStatusPill(status)` / `handoffStatusPill(status)` /
  `blockerStatusPill(status)` / `severityPill(sev)` / `caseActionPill(status)` — each
  returns `{ label, c, b }` (text color, bg color).
- `pillClass(pill)` → `'green'|'blue'|'green'|'amber'|'red'|'purple'|'gray'` for the
  `.obx-pill`/`.ocw-pill` class suffix.
- `humanize(str)` → Title Case from a snake/dotted key. `fmtDate(iso)` / `fmtDateTime(iso)`.

Tone convention across the module: **gray** = draft/inactive/cancelled, **blue** =
in-progress/sent, **green** = active/ready/completed/delivered, **amber** =
paused/warning/pending-approval, **red** = blocked/overdue/critical/failed, **purple** =
one accent (readiness / activity).

---

## Field-name cheat sheet (use these exact keys in mock data)

From `types/hrOnboarding.ts`, so porting to hooks needs zero renames:
- **Case row**: `caseId, caseNo, employeeName, employeeNo, packageKey, packageLabel,
  ownerName, status, progressPercent, openTasks, blockingTasks, activeBlockers, ready,
  dueAt, startedAt, workerType`
- **Task row**: `taskId, caseId, caseNo, employeeName, packageKey, taskTitle, ownerRole,
  moduleKey, assignedTo, assignedToName, status, dueAt, completedAt, isBlocking,
  requiresEvidence, priority`
- **Handoff row**: `handoffId, caseId, caseNo, employeeName, targetModule, handoffType,
  status, ownerName, failureReason, payload, createdAt, lastEventAt`
- **Blocker row**: `blockerId, caseId, caseNo, employeeName, blockerTitle, blockingModule,
  severity, status, ownerName, dueAt, ageDays, taskId, handoffId`

---

## Navigation (no router)

HR sections switch via a `siomac:section` window event + `localStorage`; onboarding
drill-ins (case detail, package manager, tasks) are plain `useState` surface flags inside
`OnboardingOverview.tsx` — a `type OnboardingSurface = 'overview' | 'packages' | 'tasks' | …`
enum. A new full-page workspace = add a value to that enum + a toolbar button + a render
branch. Don't add URL routes or new sidebar items.

---

## If Codex has NO access to `@ui` / our CSS

Build self-contained: plain `<div>` + inline styles, NO `@ui` imports. But STILL:
- use the real class names as `class="obx-table"` etc. (they'll no-op in the sandbox but
  become live on port),
- use the real camelCase field names in mock data,
- keep the `humanize`/`fmtDate` call sites as tiny local helpers with the same names.

Then porting is: drop the inline styles (the real CSS classes take over), swap the local
helpers for the `onboardingStatus` imports, swap `MOCK_*` for the hook.
