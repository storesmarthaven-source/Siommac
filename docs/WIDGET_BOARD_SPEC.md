# Resizable Widget Board (gridstack) — Implementation Spec

> A Grafana-style dashboard board: every panel — the register table included — has a
> position + size, drag to move, drag an edge to resize, the page reflows, and the
> layout persists per-user with an org default. Built on **gridstack.js** + Preact.
> Reference page: HR ▸ Employee Master. The board lives **below the stats-card row**.

---

## 0. Already done / verified (don't redo)

- **`gridstack@^11` installed** (standalone — 0 transitive deps; the npm-audit warnings
  are pre-existing, not from gridstack).
- **Persistence column is ready:** `ui_layout.card_order` is **`jsonb`**
  (`supabase/migrations/20260623000000_ui_theme_layout.sql`) — it can store the full
  board geometry `[{id,x,y,w,h}]` with **NO migration**.
- **The one backend gap:** the existing route `netlify/functions/routes/uiPrefs.ts`
  runs `cleanOrder()` which **coerces to `string[]`** (strips objects). So the board
  layout can't go through `layout/saveOverride`/`saveDefault` as-is — add a board
  variant (§2).
- **Reuse, don't reinvent:** edit-mode toolbar = `ArrangeControls`
  (`src/ui/components/reorder.tsx`); admin "set default" + per-user override model =
  `useModuleLayout` (`src/ui/theme/useModuleLayout.ts`). The board extends these.

---

## 1. Architecture

gridstack owns the grid DOM (drag/resize/reflow/responsive); Preact renders each
widget's content INTO the gridstack-created cell. Never let Preact re-render the
gridstack-managed nodes — Preact renders only into each cell's content element.

```
EmployeeMaster
  PageHeader
  KPI StatsCard row            ← stays, NOT in the board
  <WidgetBoard pageKey="hr.employees" registry={HR_WIDGETS} />
        └─ gridstack grid
             ├─ item id="hr.table"        (the register table widget, default w=12)
             ├─ item id="hr.deptDist"     (w=4)
             ├─ item id="hr.demographics" (w=4)
             └─ …
```

Grid config: **12 columns**, `cellHeight: ~110px` (tune), `margin: 12px`, `float:false`
(compact up), `disableDrag/Resize` unless edit mode is on, `handle` for drag, resize
handles `'se'` (+ `'e','s'` optional). Responsive: `gridstack` `column()` down to 1 col
under a breakpoint (use `oneColumnSize` or the responsive `columnOpts`).

---

## 2. Persistence

### 2a. Backend — add a board endpoint (`uiPrefs.ts`)

`cleanOrder()` strips objects, so add a parallel cleaner + two routes (mirror the
existing default/override pair, same `requireRole(['admin'])` / `requireUser` gates,
same one-default-per-page + one-override-per-(page,user) rows, same `ui_layout` table):

```ts
// accepts the gridstack geometry array; bounds-checked, capped
function cleanBoard(v: unknown): Array<{id:string;x:number;y:number;w:number;h:number}> | null {
  if (!Array.isArray(v)) return null;
  return v.filter(o => o && typeof o.id === 'string')
          .map(o => ({ id: String(o.id).slice(0,80),
                       x: Math.max(0, o.x|0), y: Math.max(0, o.y|0),
                       w: Math.min(12, Math.max(1, o.w|0)), h: Math.min(40, Math.max(1, o.h|0)) }))
          .slice(0, 60);
}
// POST /api/layout/saveBoardDefault   (admin)  → card_order = cleanBoard(args.board)
// POST /api/layout/saveBoardOverride  (user)   → card_order = cleanBoard(args.board)
// reuse GET /api/layout/get (returns card_order jsonb as-is for default + override)
```

Stored in the SAME `card_order` jsonb column — order-of-strings pages and board pages
coexist (a board page's value is just an object array instead of a string array).

### 2b. Frontend — `src/api/layout.ts`

Add `BoardItem = {id,x,y,w,h}`, `saveBoardOverride(pageKey, BoardItem[])`,
`saveBoardDefault(...)`, and reuse `getLayout` (its `default`/`override` are now
`BoardItem[] | string[] | null` — board pages read the object form).

### 2c. Hook — `useBoardLayout(pageKey)` (new, mirrors useModuleLayout)

Returns `{ items: BoardItem[], persistMine, saveAsDefault, resetMine, hasOverride,
canSetDefault }`. localStorage cache for instant paint (`siomac.board.<pageKey>`) +
best-effort server save (same pattern as `useModuleLayout`, which tolerates a failed
server write). Effective layout = override ?? orgDefault ?? registry defaults.

---

## 3. `WidgetBoard` component — `src/ui/components/WidgetBoard.tsx`

The gridstack↔Preact bridge. The trickiest file — follow exactly.

```tsx
import 'gridstack/dist/gridstack.min.css';
import { GridStack } from 'gridstack';
import { render } from 'preact';
```

- `useRef` the grid container. In `useEffect` (mount): `GridStack.init({ column:12,
  cellHeight:110, margin:12, float:false, disableResize:!editing, disableDrag:!editing,
  handleClass:'wb-drag' }, el)`.
- For each item in the effective layout whose `id` is in the registry and passes its
  `dataGate`: `grid.addWidget({ id, x, y, w, h, content:'' })`, then
  `render(<WidgetFrame def=… editing=… onRemove=…/>, itemEl.querySelector('.grid-stack-item-content'))`.
- On gridstack `'change'`: read `grid.save(false)` → map to `BoardItem[]` →
  `layout.persistMine(items)` (debounced).
- Toggle edit: call `grid.enableMove(editing)` / `grid.enableResize(editing)` — do NOT
  re-init.
- Cleanup: `grid.destroy(false)` + unmount each Preact island (`render(null, contentEl)`).
- Re-render islands when their `def`/data changes WITHOUT touching gridstack geometry.

`WidgetFrame` = a card chrome (title + drag handle `.wb-drag` + remove ✕ in edit mode)
wrapping `def.render()`. Uses the same card tokens as `@ui` (white surface, 12px radius,
border) so widgets match the page.

Edit toolbar above the grid = reuse `ArrangeControls` semantics: **Edit layout** ↔
**Add widget** (opens picker, §4) · **Reset** · **Set default** (admin) · **Done**.

---

## 4. Widget registry + picker

### Registry — `src/ui/widgets/registry.ts` (+ per-module files)

```ts
export interface WidgetDef {
  id: string;                 // 'hr.deptDist'
  title: string;
  icon: string;               // fa-* or ti-*
  category: string;           // 'Workforce' | 'Compliance' | …
  defaultW: number; defaultH: number; minW?: number; minH?: number;
  /** Locked when its source data/module isn't available yet (return reason or null). */
  dataGate?: () => string | null;
  render: () => VNode;
}
export type WidgetRegistry = Record<string, WidgetDef>;
```

HR registry (`src/components/sections/HR/widgets/`): register `hr.table`,
`hr.deptDist`, `hr.demographics`, `hr.workforceTrend`, `hr.compliance`,
`hr.expiringCerts`, … Each `render()` returns the real panel (see §8).

### Picker — `src/ui/components/WidgetPicker.tsx`

A `Modal` (or popover) listing registry entries grouped by `category`. Each row:
icon · title · size chip · **Add** (disabled with tooltip if `dataGate()` returns a
reason; already-placed ones show "Added"). Adding → append to the board layout at the
bottom with the widget's default size; gridstack compacts it in.

---

## 5. The table becomes a widget

Move everything currently below the KPI row into the board. `hr.table` is a registered
widget whose `render()` is the existing toolbar + filters + register table (the unified
card we just built). Default `w:12`. Resizable down to e.g. `w:6` so a side panel sits
beside it. Keep the table's own internal horizontal scroll (`.table-scroll`).

Caveat: gridstack sets fixed item heights; the table widget should either (a) use a
fixed `h` with internal vertical scroll, or (b) opt into `sizeToContent` for that item.
Pick (a) for the table (predictable), (b) for short panels.

---

## 6. Edit mode UX

- View mode: no handles, no drag; board looks like static cards.
- "Edit layout" → drag handles + `'se'` resize grips appear; "Add widget" enabled.
- Changes autosave to the user's override (localStorage + server best-effort).
- Admin: "Set default" publishes the current board as the org default (`requireRole`).
- "Reset" clears the user override → reverts to org default → registry defaults.

---

## 7. Real widgets to build first (data-gated — NO fake data)

Build only the ones with real data now; everything else registers with a `dataGate`
that locks it until its module exists (so it shows in the picker as "coming soon",
never as fake numbers).

| Build now (real data) | Source |
|---|---|
| `hr.table` | existing register |
| `hr.deptDist` (pie) | computed from the loaded employee list (`departmentName`) |
| `hr.demographics` (age/tenure) | from `date_of_birth` / `start_date` on the list |
| `hr.workforceTrend` (line) | `hr/dashboard-stats` `active_workforce.trend` |
| **Locked (dataGate)** | |
| Compliance / Expiring certs | needs an aggregate `hr/compliance` endpoint |
| Attendance trend / exceptions / absences | needs the Attendance module |
| Lifecycle funnel / recent hires | needs a recruiting/ATS module |
| Skills heatmap / gap | needs the competency module |

Each panel is a reusable `@ui` piece where it makes sense (`DonutStat`, `MiniLineChart`,
`PieLegend`) so HSE/Finance can reuse them.

---

## 8. Files to touch

- `package.json` — `gridstack@^11` (done).
- `src/ui/components/WidgetBoard.tsx` — the bridge (new).
- `src/ui/components/WidgetPicker.tsx` — the picker (new).
- `src/ui/widgets/registry.ts` — registry types + helpers (new).
- `src/ui/theme/useBoardLayout.ts` — persistence hook (new).
- `src/api/layout.ts` — board API (extend).
- `netlify/functions/routes/uiPrefs.ts` — `cleanBoard` + 2 board routes (extend).
- `src/components/sections/HR/widgets/*` — HR widget defs + panels (new).
- `src/components/sections/HR/EmployeeMaster.tsx` — mount `<WidgetBoard>` below the
  KPI row; move the table into `hr.table` widget.
- `assets/styles/` — `.wb-*` chrome + import gridstack CSS (or import in WidgetBoard).
- `src/ui/index.ts` — export WidgetBoard / WidgetPicker / registry types.

---

## 9. Acceptance criteria

1. Below the stats cards, widgets render in a 12-col board; the **table is one of them**.
2. Edit layout → drag to move, drag a corner to resize (column/row steps); the page
   reflows; view mode hides handles.
3. Add widget (picker) inserts a panel; remove (✕) takes it out. Locked widgets can't
   be added (show why).
4. Layout persists per-user across reloads; admin can set the org default; reset works.
5. No fabricated data — locked widgets stay locked until their module exists.
6. `tsc -p tsconfig.frontend.json --noEmit` clean; 229 frontend tests still pass; the
   gridstack DOM never fights Preact (no duplicated/orphaned nodes on re-render).

---

## 10. Risks / watch-outs

- **Preact ↔ gridstack DOM ownership** — the #1 risk. gridstack moves DOM nodes;
  Preact must only render INTO cell content elements, never re-render the grid itself.
  Manually `render(null, …)` on widget removal to avoid leaks.
- **Item height vs content** — gridstack uses row units; tall/dynamic content (the
  table) needs fixed `h` + internal scroll, or `sizeToContent` per item.
- **Mobile** — collapse to 1 column under ~700px; disable resize on touch.
- **Don't block first paint** — render from the localStorage-cached layout immediately,
  reconcile with the server layout when it arrives (same as `useModuleLayout`).
