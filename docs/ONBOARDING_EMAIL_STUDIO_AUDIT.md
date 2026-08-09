# SIOMAC Email Studio — Architecture Decision

Status: native editor selected; first frontend interaction slice implemented.

## Product decision

SIOMAC owns the editor architecture in Preact, Vite and TypeScript. The product
uses one allow-listed block schema, one ordered email canvas and one contextual
inspector. The discarded HTML mockup builder, React Email editor, GrapesJS/MJML
editor proposal and any legacy property system are not implementation sources
and must not remain as parallel fallbacks.

This is a focused enterprise template builder, not a marketing automation suite.
HR users assemble professional transactional emails without seeing arbitrary
HTML, CSS or MJML. SIOMAC owns the document, validation, permissions, assets,
variables, versions and delivery rules. A renderer/compiler is a replaceable
backend boundary, never the editable source of truth.

## Integration boundary

- Preact owns the full-screen Payslip Studio-style shell, routing, permission
  gates, template library, canvas, selection, drag/drop, history and inspector.
- `EmailEditorSchema` in `types/emailTemplates.ts` is the only editable source.
  It stores registered flow blocks, nested sections/columns and controlled styles.
- HTML and plain text are deterministic derived outputs. Production regenerates
  them server-side from the stored document before test or delivery.
- The Studio is lazy-loaded into its own HR chunk. Other HR pages do not download
  the editor.
- A future pinned MJML compiler may implement the server renderer after security
  and email-client compatibility review. It does not own editor state.

## Implemented frontend slice

- dedicated full-screen Email Studio and template library;
- blank and professional starter documents;
- left content/layout/saved/variable/structure tools;
- section-owned canvas: root nodes are containers and loose content is
  normalized into a section at the editor/service boundary;
- ordered nested content with visible before/between/after/beside guides;
- content drops inside full-width sections and individual columns;
- persistent root-section move rails, dedicated grab cursors, overflow actions,
  keyboard delete and Alt+Arrow movement;
- direct section width/height resize handles, exact dimensions, per-side
  section padding and editable column-cell containers;
- image selection/upload adapter, alt text, display width and profile-photo block;
- inline rich text basics, contextual properties and approved variables;
- undo/redo, autosave, explicit save, desktop/mobile view and sandboxed preview;
- table-based HTML plus plain-text derivation from the same structured document;
- published-template read-only enforcement and isolated development data adapter.

## Deliberately not faked

The repository still has no production email-template persistence, governed
asset storage routes, server compiler, variable/sender/branding catalogs, sample
data resolver, test-send command, approval workflow, immutable version store or
trigger-binding service. Production calls authenticated API routes and never
silently falls back to the development adapter.

Local image upload in development is a bounded preview adapter. Production must
use authenticated presigned upload/complete routes and persist asset ids/URLs
that are governed, auditable and scoped to the template.

## Required next slices

1. Production template/version persistence with optimistic concurrency.
2. Governed asset storage, library, crop/replace and usage protection.
3. Server-owned variable, trigger, sender and branding catalogs.
4. Pinned deterministic server compilation and compatibility fixtures.
5. Rich-text links/lists, responsive visibility/stacking and reusable sections.
6. Sample/live preview, validation, accessibility and link checks.
7. Test send with non-production invitation actions.
8. Approval, immutable publish, restore, usage and trigger bindings.
9. Narrow permissions, audit/events/workflow side effects and live E2E.

Each slice must be complete before its controls appear. There is one editor and
one canonical document; no legacy builder may be kept as a fallback.
