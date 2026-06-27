# Skeleton & Loading System — Implementation Spec

> Hand this whole file to the implementer. It is self-contained: it states the
> principles, the exact component APIs, the query conventions, the two known bugs
> to fix, the CSS rules, the per-surface rollout, and the acceptance criteria.
> Tech stack: Preact + TypeScript, TanStack Query (`@tanstack/preact-query`),
> design system under `src/ui` (barrel `@ui`), global CSS in `assets/styles/*`.

---

## 0. Current state (DONE — do not rebuild, extend)

Already implemented and on `main`/working tree:

- **Primitives** — `src/ui/components/Skeleton.tsx`: `Skeleton` (atom; `width`/`height`/
  `radius`/`circle`), `SkeletonText` (`lines`/`width`/`lastWidth`/`gap`),
  `TableSkeleton` (`rows`/`cols` — emits `<tr><td>` for a `<tbody>`),
  `ListSkeleton` (`rows`/`avatar`). Exported from `src/ui/index.ts`.
- **CSS** — `.ui-skeleton*` in `assets/styles/uikit-layout.css` (shimmer sweep +
  `prefers-reduced-motion` pulse fallback). Globally loaded via
  `src/styles/index.css` (`layer(sections)`).
- **Component loading props** — `StatsCard` (`loading`) and `MiniTable` (`loading`)
  in `src/ui/components/`. Both render skeletons internally.
- **HR reference wiring** — `src/api/hr/employees.ts` (`useHrEmployee` with
  `placeholderData` from the list cache + `usePrefetchHrEmployee`), debounced hover
  prefetch + `EmStatCard`/`KpiGrid` `loading` + register `TableSkeleton` +
  per-tab `MiniTable loading` + `DrawerSkeleton` + a `ready` record-id gate in
  `src/components/sections/HR/ProfileDrawer.tsx`.
- **QueryClient defaults** — `src/lib/queryClient.ts`: `staleTime 60_000`,
  `gcTime 5*60_000`, `retry 2`, `refetchOnWindowFocus true`.
- **Demo** — a Skeletons section in `src/ui/examples/UIKitPage.tsx`.

This spec completes the system: **two open bugs** (§5, §6) + **generalisation**
(§3, §4) + **app-wide rollout** (§7).

---

## 1. Principles (non-negotiable)

1. **Instant-from-cache first.** If data is already cached (revisit) or derivable
   from a parent list, render it immediately. Skeletons are the *cold-path*
   fallback only — never shown when real data is available.
2. **Never a fabricated value.** Do NOT render `value={x ?? 0}` / `"—"` /
   `"Loading…"` text while a query is pending. Show a skeleton instead. A momentary
   `0` is wrong data (this is a band-aid per repo rules).
3. **No layout shift (CLS = 0).** The skeleton MUST occupy the same box as the real
   content: same row count, same row height, same column widths, same card height.
   Loading → loaded must not move a single pixel.
4. **No cross-record bleed.** Never render record A's data on a surface currently
   requesting record B. Gate every record-scoped value by a record-id match (§4).
5. **Honour reduced motion.** Shimmer animation must degrade to a static/pulse under
   `prefers-reduced-motion: reduce` (already done for `.ui-skeleton`).
6. **One system, reused.** All skeletons come from `@ui` primitives + component
   `loading` props. No page-local shimmer divs.

### Loading-state decision table (apply at every call site)

| Condition | Render |
|---|---|
| `query.isError` | the existing error/empty state |
| data is cached/placeholder AND belongs to the requested record | the **real** content |
| `query.isLoading && !query.data` (cold, nothing to show) | **skeleton** |
| data exists but belongs to a *different* record (stale switch) | **skeleton** (never the stale data) |

Canonical gate: `loading={query.isLoading && !query.data}` for non-record-scoped;
`ready`/id-match gate (§4) for record-scoped surfaces.

---

## 2. Primitive API (`src/ui/components/Skeleton.tsx`) — extend

Keep the existing four. ADD these presets (same file, same export style, add to
`src/ui/index.ts` and the UIKit demo):

```ts
// Field/label-value rows (for FieldList / DetailGrid loading)
SkeletonFields({ rows = 4 }: { rows?: number }): VNode
//   renders `rows` label+value lines that match `.ui-field-row` height.

// A KPI / stat card grid placeholder (N cards matching the page's stat row)
SkeletonStatGrid({ count = 4 }: { count?: number }): VNode
//   renders `count` StatsCard shells with loading bodies.

// Generic block list with configurable line count per row
//   (already have ListSkeleton — keep)
```

All primitives:
- `aria-hidden="true"` on every shimmer node (the region announces loading once,
  not per block — see §8 a11y).
- Accept a `class`/`style` passthrough for sizing at the call site.

---

## 3. Component `loading` props — add to the rest of `@ui`

Add a `loading?: boolean` prop to each data component; when true it renders an
internally-sized skeleton that matches its loaded layout (no CLS):

- `RegisterTable` (`src/ui/components/RegisterTable.tsx`) — **required.** When
  `loading`, render `<thead>` as-is and a `TableSkeleton` body with
  `rows = pageSize` (or a `skeletonRows` prop, default 10) and `cols = columns.length`.
  Skeleton row height MUST equal a real row's height (see §5).
- `FieldList` / `DetailGrid` — render `SkeletonFields` when `loading`.
- `MetricRow` / `SparkCard` / `ChartCard` — render a sized shimmer block when
  `loading` (chart area height preserved).
- `Card` / `MiniCard` / `RecordRow` — optional `loading` for list item shells.

Pattern (consistency): `loading` short-circuits at the top of the component and
returns the same outer wrapper with skeleton children, so the box size is identical.

---

## 4. Query conventions — instant + no cross-record bleed

### 4a. Record-scoped detail queries — a reusable helper

Create `src/lib/recordQuery.ts`:

```ts
// useRecordQuery — a useQuery wrapper for "detail of ONE record" surfaces.
// Guarantees: (1) optional instant placeholder from a parent list cache,
// (2) the returned `data` is ONLY surfaced when it belongs to `recordId`
// (no cross-record flash), (3) a single `ready` flag for the UI gate.
interface RecordQueryResult<T> {
  data: T | undefined;     // ONLY set when it belongs to recordId
  ready: boolean;          // data present AND belongs to recordId AND not errored
  isLoading: boolean;
  isError: boolean;
  query: UseQueryResult<T>;
}
function useRecordQuery<T>(opts: {
  recordId: string | null;
  queryKey: QueryKey;
  queryFn: (signal?: AbortSignal) => Promise<T>;
  getId: (data: T) => string;          // how to read the record id off T
  placeholder?: () => T | undefined;   // e.g. from list cache
}): RecordQueryResult<T>;
```

`ready = !!data && getId(data) === recordId && !isError`. The UI renders the
record only when `ready`; otherwise a skeleton. This is the **generic version** of
the `ready` gate already in `ProfileDrawer.tsx`.

### 4b. EVERY record-scoped value on a surface must be id-gated

The drawer flash bug (§6) is caused by **secondary** queries (training summary,
audit, workflow summary, etc.) still showing the previous record's data while the
primary is already switched. Rule: **a surface that shows record B must not render
ANY value sourced from a query whose data still belongs to record A.** Either:
- gate each secondary value on `secondaryData?.<idField> === recordId`, OR
- key the whole surface so secondary queries reset (preferred: pass `recordId` into
  every secondary hook and render its section's skeleton until that section's data
  matches `recordId`).

### 4c. Instant open for list → detail (already proven in HR; generalise)

- Detail query gets `placeholderData` built from the parent list-cache row
  (`qc.getQueriesData({ queryKey: <list key prefix> })`, find by id) — real data,
  not a fake.
- Provide a `usePrefetch<Entity>()` hook (`qc.prefetchQuery`, `staleTime 60s`).
- Wire it to row `onMouseEnter`/`onFocusCapture`, **debounced ~140ms** (cursor must
  rest), with `onMouseLeave` cancelling the timer — so list sweeps don't storm the
  API. (See `EmployeeMaster.tsx` `onRowHover`/`onRowHoverEnd` for the reference.)

### 4d. Retry / rate-limit hygiene (already fixed in `src/lib/api.ts`)

`429` is NOT in `RETRYABLE_STATUS` (don't fast-retry rate limits). Keep it that way.

---

## 5. BUG #1 — table layout jumps when data replaces skeleton (FIX)

**Symptom:** the register table shifts/resizes the moment real rows replace the
skeleton.

**Root cause:** `.hr-emp-master table { table-layout: auto }`
(`src/components/sections/HR/HR.css`). With `auto`, column widths are computed from
*content*. Skeleton cells (short spans) produce different widths than real text →
columns (and row heights) recalculate → visible jump.

**Fix (both required):**

1. **Lock column widths** so they never depend on content:
   - Set `table-layout: fixed` on the register table, and give every column an
     explicit width (`<col>` elements or `th:nth-child(n){width}`) summing to 100%
     (the table already pins col 1 = 22% and col 10 = 72px — extend to all columns).
   - This makes skeleton and real rows share identical column geometry.
2. **Match skeleton row metrics to real rows:**
   - Skeleton **row count** = the page size actually rendered (pass `skeletonRows =
     pageSize`), not a hard-coded 10.
   - Skeleton **row height** = real row height. The employee row is tall because of
     the avatar (circle + 2 lines). The skeleton's first cell MUST mimic that
     (avatar circle + 2 short lines), and other cells a single 12px bar, with the
     same `td` vertical padding as real rows. Add a `firstCellAvatar?: boolean` to
     `TableSkeleton` (or a dedicated `RegisterTable loading` body) so the first
     column renders the avatar+lines shape.

Apply the same rule to every register/`MiniTable`: fixed layout OR guaranteed
equal row dimensions. Acceptance: toggling loading on/off moves nothing (verify by
overlaying screenshots / CLS = 0).

---

## 6. BUG #2 — previous record's tags flash in the detail drawer (FIX)

**Symptom:** opening employee B briefly shows employee A's pills/tags (status,
training, etc.), then updates.

**Status:** a primary-query `ready = e.id === employeeId` gate is already in
`ProfileDrawer.tsx`, but the flash persists — meaning at least one **secondary**
record-scoped value is still rendered from the previous record before its query
catches up (candidates: `useHrWorkflowSummary`, `useHrTrainingSummary`,
`useHrAudit`, or any value not covered by the primary `ready` gate).

**Fix:** apply §4b rigorously.
1. Audit every value rendered in the drawer header + tabs. For each, identify its
   source query and that query's record-id field.
2. Render each value only when its source data belongs to `employeeId`; otherwise
   show that section's skeleton. Concretely:
   - Header "Open Workflows": already gated via `wfQ.data?.employee_id === employeeId`
     — confirm and keep.
   - Training pill / training snapshot: gate on the training query's employee id (or
     derive solely from the id-gated primary `detail` data).
   - Recent Activity / Audit: gate on the audit rows' employee id, else `ListSkeleton`.
3. Prefer the generic `useRecordQuery` (§4a) for all of these so the id-gate is
   uniform and not re-implemented per value.
4. Ensure no secondary hook uses `placeholderData: keepPreviousData` (that would
   intentionally surface the previous record — forbidden on record-scoped reads).

Acceptance: rapidly switching employees never shows another employee's data for a
single frame — only that employee's data or a skeleton.

---

## 7. CSS rules (extend `assets/styles/uikit-layout.css`)

- Keep `.ui-skeleton` base + `::after` sweep + reduced-motion pulse (done).
- Add row-stability helpers used by table skeletons: a `.ui-skeleton-row td` height
  that matches register rows, and an avatar-cell shape
  (`.ui-skeleton-cell--avatar`: circle + two lines via flex).
- All sizes via tokens (`var(--border)`, spacing tokens). No hard-coded font
  weights — use `var(--font-weight-*)` (repo rule: bold token = 500).

---

## 8. Accessibility

- Wrap a loading region with `aria-busy="true"` on the container and a visually
  hidden status (e.g. `role="status"` "Loading employees…"); individual shimmer
  nodes stay `aria-hidden`.
- On load, remove `aria-busy`; do not announce each row.

---

## 9. Rollout checklist (apply the system surface-by-surface)

For EACH module page + detail drawer (HR ✅ reference; then HSE Incidents, PTW,
Risk/JSA, Inspections, Training; Messages; Payroll; Tickets; Superadmin Console):

- [ ] KPI/stat row → `StatsCard loading` (or `SkeletonStatGrid`), gated
      `isLoading && !data`. No `?? 0`.
- [ ] Register table → `RegisterTable loading` (or `TableSkeleton`) with
      `skeletonRows = pageSize`, fixed column widths, matched row height. CLS = 0.
- [ ] Detail drawer → `useRecordQuery` + record-id `ready` gate + whole-drawer
      skeleton; every secondary value id-gated (§4b/§6).
- [ ] List→detail instant: `placeholderData` from list cache + debounced hover
      prefetch.
- [ ] All `MiniTable`/`FieldList`/`DetailGrid` in the drawer use their `loading`
      prop.
- [ ] No "Loading…" / "—" / `0` text remains on any cold path.

---

## 10. Acceptance criteria (definition of done)

1. No surface shows blank, "Loading…", or a fabricated `0`/`—` on cold load.
2. CLS = 0 on every list and card row when skeleton → data (no jump).
3. Switching the detail drawer between records never shows another record's data
   for any frame (skeleton or correct record only).
4. Revisiting a page within the cache window is instant (no skeleton).
5. `prefers-reduced-motion` shows a static/pulse, not a sweep.
6. Typecheck clean (`tsc -p tsconfig.frontend.json --noEmit`); full E2E green; the
   229 frontend tests still pass.
7. Every skeleton comes from `@ui` primitives / component `loading` props — no
   page-local shimmer.

---

## 11. Files to touch (map)

- `src/ui/components/Skeleton.tsx` — add `SkeletonFields`, `SkeletonStatGrid`,
  `TableSkeleton.firstCellAvatar`.
- `src/ui/components/RegisterTable.tsx`, `FieldList`/`DetailGrid`, `MetricRow`,
  `ChartCard`, `SparkCard` — add `loading`.
- `src/ui/index.ts` + `src/ui/examples/UIKitPage.tsx` — export + demo new pieces.
- `src/lib/recordQuery.ts` — new `useRecordQuery` helper.
- `assets/styles/uikit-layout.css` — table-skeleton row/avatar-cell helpers.
- Per module: `src/components/sections/<Module>/*` + `src/api/<module>/*`
  (placeholderData + prefetch + id-gates), starting from the HR reference impl.
- `src/components/sections/HR/HR.css` — register table `table-layout: fixed` +
  full column widths (BUG #1).
- `src/ui/PAGE_GUIDE.md` — document the loading standard so new pages follow it.
