# Payslip Designer

A WYSIWYG payslip designer built with **Preact + TypeScript + Vite**. Design payslips on
an A4/A5 canvas with draggable, resizable elements, dynamic merge fields, a full properties
inspector, a custom colour picker, templates, undo/redo, and print-to-PDF.

## Scripts

```bash
npm install
npm run dev         # start Vite dev server
npm run build       # typecheck + production build
npm run typecheck   # tsc --noEmit
npm run preview     # preview the production build
```

## Architecture

```
src/
├─ types/            Domain model (discriminated-union DesignElement, Design, PageConfig)
├─ constants/        Page sizes, fonts, token catalogue + sample data, SVG logos
├─ lib/              Pure helpers: colour maths, geometry/resize, id, download, print, fit, toast
├─ model/            Element factory (defaults), token resolution, type guards
├─ templates/        Declarative template builder + registry (prolas, compact, executive, blank)
├─ state/            useReducer store with undo/redo history + Context provider/hook
├─ hooks/            useKeyboardShortcuts
└─ components/
   ├─ canvas/        Canvas, ElementView (drag/resize), ElementContent (per-type render)
   ├─ color/         ColorField swatch + ColorPickerPopover (SV/hue/alpha, presets, eyedropper)
   ├─ inspector/     Inspector shell + typed per-type sections
   ├─ panels/        Palette, Data-fields, Page-setup, Layers
   ├─ ui/            Reusable form controls, CollapsibleSection, Toast
   ├─ Toolbar.tsx    Templates, history, zoom, grid/snap, preview, save/load/export/print
   ├─ PrintView.tsx  Static preview-mode render used only in @media print
   └─ Workspace.tsx  App layout + shortcuts + fit-on-mount
```

### State

A single `useReducer` store (`state/reducer.ts`) holds the design, selection, view flags,
and undo/redo stacks. Live edits (drag / typing / colour picking) dispatch transient
`patch` actions and finalise with `endEdit`, so an interaction produces exactly one history
entry. Discrete actions (add/delete/duplicate/page) commit immediately.

### Data fields

Elements reference merge tokens like `{{employee.name}}`. In **Preview** mode they resolve
to `SAMPLE_DATA`; in edit mode they render as chips. Swapping the sample source for a real
payroll record is the integration seam for the Siomac ERP.

## Notes

This is a standalone tool. Wiring it into the Siomac ERP (auth'd persistence route, shared
`@ui` components, real payroll data source) is a separate, approval-gated step.
