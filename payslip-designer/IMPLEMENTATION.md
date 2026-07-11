# Payslip Studio — Implementation Document

> Full specification of the **Payslip Studio** app plus the blueprint for integrating it
> into the **SIOMAC ERP**. This document is the source of truth to hand to Claude when
> wiring the studio into Siomac. **Keep it updated as the app changes** (see §13).

- **App:** `payslip-designer/` — a standalone Preact + TypeScript + Vite WYSIWYG payslip designer.
- **Status:** studio complete & verified; Siomac DB integration specified here (not yet built into the ERP).
- **Last updated:** 2026‑07‑13.

---

## 1. Purpose

A drag‑and‑drop editor for designing **payslip templates** on an A4/A5 canvas, with dynamic
merge fields (`{{employee.name}}`, `{{pay.net}}`, …), a properties inspector, a colour picker,
named/auto‑saved designs, and print‑to‑PDF. Inside Siomac it becomes the tool payroll admins use
to author payslip templates; the payroll run then merges real data into a chosen template and
emits PDFs.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| UI | Preact 10 + TypeScript (strict, `noUncheckedIndexedAccess`) |
| Build | Vite 5, `@preact/preset-vite` |
| State | `useReducer` store + Context (no external state lib) |
| Styling | one hand‑authored `app.css` (CSS variables), Google Fonts |
| Storage | `TemplateStore` adapter — localStorage now, Siomac API on integration |
| Persistence format | self‑contained `Design` JSON (logos embedded as data‑URIs) |

Path alias: `@/*` → `src/*`. Scripts: `npm run dev | build | typecheck | preview`.

---

## 3. Architecture / file map

```
payslip-designer/
├─ src/
│  ├─ types/index.ts            Domain model (Design, DesignElement union, EditableProps)
│  ├─ constants/                pageSizes, fonts, tokens (+ SAMPLE_DATA), logos (SVG data-URIs)
│  ├─ lib/
│  │  ├─ color.ts               hex/rgb/hsv maths
│  │  ├─ geometry.ts            snap, clamp, resizeRect, DRAG threshold
│  │  ├─ id.ts                  nextId / reseedIds
│  │  ├─ download.ts            file pick / read / JSON download
│  │  ├─ print.ts               @page rule + window.print
│  │  ├─ fit.ts                 computeFitZoom
│  │  ├─ toast.ts               tiny event bus for toasts
│  │  └─ store/                 ★ storage adapter (see §8)
│  │     ├─ types.ts            TemplateStore interface + StoredTemplate
│  │     ├─ localTemplateStore.ts   localStorage impl (default)
│  │     ├─ apiTemplateStore.ts     Siomac API impl (swap-in)
│  │     ├─ autosave.ts         draft autosave slot (always local)
│  │     └─ index.ts            exports the active `templateStore`
│  ├─ model/
│  │  ├─ factory.ts             createElement defaults + z helpers
│  │  ├─ renderTokens.ts        {{token}} → chip / sample value
│  │  └─ guards.ts              isStyled(), StyledElement
│  ├─ templates/
│  │  ├─ builder.ts             TemplateBuilder DSL + page()
│  │  ├─ detailedPayslip.ts     shared 3-column layout (SIOMAC/PROLAS/ICT share it)
│  │  ├─ siomac.ts prolas.ts incorrtech.ts blank.ts
│  │  └─ index.ts               TEMPLATES registry + DEFAULT_TEMPLATE_ID
│  ├─ state/
│  │  ├─ reducer.ts             DesignerState, actions, undo/redo, savedRef
│  │  └─ DesignerContext.tsx    Provider + useDesigner()
│  ├─ hooks/
│  │  ├─ useKeyboardShortcuts.ts
│  │  └─ useAutosave.ts
│  ├─ components/
│  │  ├─ Toolbar.tsx  DesignsMenu.tsx  Workspace.tsx  StatusBar.tsx  PrintView.tsx
│  │  ├─ canvas/      Canvas, ElementView (drag/resize), ElementContent (per-type), TokenText, ResizeHandles, elementStyles
│  │  ├─ color/       ColorField, ColorPickerPopover, presets
│  │  ├─ inspector/   Inspector (shell) + sections (typed per-type)
│  │  ├─ panels/      PalettePanel, TokenPanel, PageSetupPanel, LayersPanel
│  │  └─ ui/          controls (form primitives), CollapsibleSection, Toast
│  ├─ styles/app.css
│  ├─ App.tsx  main.tsx
├─ siomac-integration/          ★ reference artifacts for the ERP (this doc §10)
│  ├─ migrations/…_payroll_payslip_templates.sql
│  ├─ routes/payslipTemplates.reference.ts
│  └─ resolver/resolvePayslipTokens.reference.ts
└─ IMPLEMENTATION.md            (this file)
```

---

## 4. Data model (the contract)  — `src/types/index.ts`

A **`Design`** is `{ page: PageConfig, elements: DesignElement[] }`. `DesignElement` is a
discriminated union on `type`:

| type | key fields (beyond geometry `x,y,w,h,z,id`) |
|---|---|
| `heading` / `text` | `text` + StyleProps |
| `field` | `label`, `token`, `labelWidth` + StyleProps (label‑less = plain token value) |
| `table` | `rows[{label,amount,hours?,rate?,bg?,color?,height?}]`, `labelCol/amtCol`, `showHead/showTotal/totalLabel`, `showHoursRate/hoursCol/rateCol`, `accent`, `headColor`, `totalColor` + StyleProps. Per-row `bg`/`color`/`height` override zebra + auto height; total row uses neutral bg + `totalColor` text. |
| `summary` | `label`, `token`, `value` (static override), `sub`, `accent` + StyleProps |
| `divider` | `color`, `thickness`, `style` |
| `image` | `src` (data‑URI), `fit`, `radius` |
| `box` | StyleProps only |

`StyleProps` = `color,bg,fontSize,fontFamily,bold,italic,underline,align,valign,borderW,borderColor,borderStyle,radius,padding,lineHeight`.
`PageConfig` = `{ size: 'a4'|'letter'|'legal'|'a5'|'half', orient: 'portrait'|'landscape', bg, grid }`.
`EditableProps` = the flattened superset of all element props (used for typed patches — see the note in the file about why `Omit`/intersection over the union doesn't work).

**Persistence:** a `Design` is fully self‑contained (images inline). It is exactly what gets
stored in `payroll_payslip_templates.design` (jsonb) and what Export/Import writes.

---

## 5. State management — `src/state/reducer.ts`

Single `useReducer` store behind Context (`useDesigner()`), exposing `{ state, dispatch }`.

`DesignerState = { design, selectedIds[], view{zoom,snap,preview}, past[], future[], checkpoint, savedRef }`.

- **Selection & grouping:** `selectedIds` is a multi-selection (shift-click / Layers shift-click).
  Elements carry an optional `group` id; selecting any member selects the whole group. `group`/
  `ungroup` (Ctrl+G / Ctrl+Shift+G) assign/clear it. `patchMany` moves all selected together
  (snapped by the dragged element so spacing is preserved); the `SelectionBox` overlay scales all
  selected elements' x/y/w/h + font sizes together. Selection-scoped ops: `deleteSelected`,
  `duplicateSelected` (remaps group ids), `bringSelectedToFront`, `sendSelectedToBack`.

- **History:** discrete actions (add/delete/duplicate/setPage/z‑order) commit immediately.
  Live edits (drag/typing/colour) dispatch transient `patch` actions and finalise with `endEdit`,
  so one interaction = one undo entry (checkpoint model). `undo`/`redo` swap `past`/`future`.
- **`savedRef`**: `{id,name} | null` — the saved template currently open. Set by `loadDesign`
  when opening a saved design; cleared when a template/import loads. Drives the Designs menu's
  “Update this design” vs “Save as new”.

Actions: `select, add, insertField, patch, endEdit, delete, duplicate, bringToFront, sendToBack,
setPage, loadDesign(+savedRef?), setSavedRef, undo, redo, setView`.

---

## 6. Rendering engine

- **Canvas** (`canvas/Canvas.tsx`) renders the page at `view.zoom` (CSS transform). Page size from
  `pageDimensions(page)` (portrait dims, swapped for landscape).
- **ElementView** handles pointer **drag/resize** (4px drag threshold so selecting doesn't nudge;
  button‑released safety end), double‑click to edit text / upload image, and renders **ElementContent**.
- **ElementContent** is the per‑type presenter. Notable:
  - text/heading never clip (overflow visible); token chips in edit, resolved values in preview.
  - **table** is a flex column; a growing `.pt-spacer` row pins the total to the bottom, so
    **resizing the table box fills space automatically — no manual blank rows**. `headColor` /
    `totalColor` make header/total text legible on any accent (e.g. black on yellow).
  - **summary** figure uses Inter, weight follows Bold, `value` overrides the token when set.
- **PrintView** renders a static, preview‑mode copy into `#print-root`, shown only in `@media print`
  with `print-color-adjust: exact` (so backgrounds/colours survive PDF export). `print.ts` injects a
  matching `@page { size … }` rule.

---

## 7. Features

Templates (registry), Palette (add element), Data fields (token insert; label‑less = plain value),
Page setup (size/orientation/background), Inspector (typed sections per element incl. typography,
alignment, fill/border, table rows + hours/rate, colour swatches), custom **ColorPicker**
(SV/hue/alpha, hex, presets, recents, eyedropper, transparent), Layers, Zoom/Fit, Grid, Snap,
**Preview** (resolves tokens to `SAMPLE_DATA`), Undo/Redo, keyboard shortcuts, Export/Import JSON,
Print/PDF, **Designs menu** (named save, update‑in‑place, set default, delete) + **auto‑save**.

---

## 8. Storage adapter — `src/lib/store/`  ★ the integration seam

Everything that persists named templates goes through **`TemplateStore`**:

```ts
interface TemplateStore {
  list(): Promise<StoredTemplate[]>;
  get(id): Promise<StoredTemplate | null>;
  create(name, design): Promise<StoredTemplate>;
  update(id, { name?, design? }): Promise<StoredTemplate | null>;
  remove(id): Promise<void>;
  setDefault(id): Promise<void>;
}
StoredTemplate = { id, name, isDefault, updatedAt, design }
```

- `store/index.ts` exports `templateStore` = `new LocalTemplateStore()` today.
- **To run inside Siomac, change that one line to `new ApiTemplateStore()`.** `ApiTemplateStore`
  already targets `payslipTemplates.*` routes and posts `{ args }` bodies. The UI (DesignsMenu,
  future payroll selector) depends only on the interface.
- **Auto‑save** (`store/autosave.ts`) is a local draft slot, restored on boot; keep it local (or map
  to a per‑user draft row later).

---

## 9. Merge tokens (data contract) — `src/constants/tokens.ts`

`TOKEN_GROUPS` + `SAMPLE_DATA` define the catalogue. Keys used by templates:

```
company.name|address|reg
employee.name|id|position|department|nis|tin|bank|account
pay.period|date|frequency|method|currency|ref
pay.gross|deductions|net|ytd.gross|ytd.net
```

In the studio these resolve to `SAMPLE_DATA` in Preview. In Siomac they resolve to real pay‑run data
via `resolvePayslipTokens.reference.ts` (§10.5). Totals‑bar GROSS/DEDUCTIONS/NET are computed from
the table rows in the templates (see `detailedPayslip.ts`).

---

## 10. SIOMAC integration blueprint

> Reference artifacts live in `siomac-integration/`. Adapt to the repo's exact helpers
> (`requirePermission`, `runModuleMutation`, apiPost, the mutation‑backbone RPC). Respect the
> build‑order + no‑band‑aids rules.

### 10.1 Database
Add `payroll_payslip_templates` — see `migrations/…_payroll_payslip_templates.sql`.
`design jsonb`, `is_default boolean` with a **unique partial index** (one active default),
`status` (active/archived — soft delete), `created_by/updated_by text references app_users(id)`,
timestamps + `updated_at` trigger, RLS enabled.

### 10.2 Permissions (catalogue — exact keys)
- `payroll.templates.view` — list / get
- `payroll.templates.manage` — create / update / setDefault / delete
Add to the permission catalogue (single source of truth) and Console matrix.

### 10.3 Backend routes (POST‑only, `requirePermission`)
`payslipTemplates.list | get | create | update | setDefault | delete` — see
`routes/payslipTemplates.reference.ts`. Rules honoured:
- validate `body.args ?? body`;
- each mutation writes **business row → app_events → audit_logs** atomically via the
  transactional‑outbox RPC / `runModuleMutation()` (no stitched PostgREST calls);
- soft‑delete (status = archived), never hard‑delete;
- `setDefault` flips `is_default` in one statement (unique index guards single default).
Response DTO exactly matches `StoredTemplate` (so `ApiTemplateStore` is a drop‑in).

### 10.4 Studio storage swap
`store/index.ts` → `new ApiTemplateStore()`. Provide `apiPost` (JWT + `{args}` envelope) either by
editing `apiTemplateStore.ts`'s `call()` to use the app helper, or DI. Auto‑save stays local.

### 10.5 Payroll page — selector, default, generation
1. **Template selector** on the pay‑run page: `payslipTemplates.list`, preselect the `isDefault` one.
2. **Set default**: `payslipTemplates.setDefault` (or reuse the studio's star action).
3. **Generate payslips** per employee:
   - load the chosen template's `Design`;
   - build the token map from the employee + pay‑run row (`buildTokenMap`, `resolver/…`);
   - `resolveDesignTokens(design, map)` to bake values in;
   - render to PDF (see §10.6).
4. Store/attach each generated PDF to the payslip record; wire notifications/handoffs per §2 rules.

### 10.6 PDF rendering options
- **Server‑side (recommended for batch):** run the same `ElementContent` render in a headless
  browser (Playwright/Puppeteer) → PDF. Reuse the `PrintView` markup + `app.css`; the design is
  self‑contained. Fonts: bundle the six Google fonts or self‑host.
- **Client‑side (single):** open the studio's print path (`printDesign(page)` + `@media print`).

### 10.7 Token → pay‑run mapping
`PayslipData` in `resolver/resolvePayslipTokens.reference.ts` is the join contract; wire each field
to the real payroll row (NIS/PAYE/Health Surcharge/net, YTD, employee master, company profile).
Earnings/deduction table rows are static per template today — if you want them data‑driven, populate
`table.rows` from the pay‑run before render (totals auto‑compute).

---

## 11. Build & run

```bash
cd payslip-designer
npm install
npm run dev        # http://localhost:5173 (or --port)
npm run build      # tsc -b && vite build
npm run typecheck
```

---

## 12. Testing

Studio: `npm run typecheck` + `npm run build` gate every change; behaviour verified via the browser.
**For the Siomac integration, follow the platform Testing Standard:** a live E2E suite
`scripts/e2e/suites/payslipTemplates.mjs` covering every route (list/get/create/update/setDefault/
delete), access control (view vs manage; negative paths), response shape (`StoredTemplate`), and
§2 side‑effects (app_events + audit_logs rows after each mutation), with tagged cleanup.

---

## 13. Keeping this document current

When the app changes, update the relevant section here **in the same change**:
- new element type / prop → §4;
- new store method / route → §8, §10.3, and the reference files;
- new merge token → §9 and `buildTokenMap`;
- new feature → §7.
Treat this file as part of the definition of done for the studio.

---

## 14. Change log
- **2026‑07‑13** — Added multi‑select + Group/Ungroup (move & resize together), per‑row table
  styling (bg/color/height), adjustable table header (size/height), "Ruled fill" toggle,
  per‑element Reset to default, and the swappable storage adapter + named designs/auto‑save.
- **2026‑07‑13** — Initial document. Studio complete (templates SIOMAC/PROLAS/ICT, table auto‑fill,
  colour picker, named designs + auto‑save + set‑default, storage adapter). Siomac integration
  specified with reference migration/routes/resolver.
