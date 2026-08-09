# Email Template Studio integration contract

## Current status

The first native frontend slice is implemented as a standalone HR Email Studio.
It is a native Preact/Vite/TypeScript editor using one SIOMAC-owned block
registry, ordered canvas and contextual property inspector. React Email,
GrapesJS, Unlayer and the former HTML mockup editor are superseded; none may be
reintroduced or maintained as a second system.

The browser never reads Supabase directly. `src/api/hr/emailTemplates.ts` is the
only frontend service boundary. Development uses the explicitly separate typed
adapter in `emailTemplates.dev.ts`; production always calls authenticated APIs
and never silently falls back to development data.

## Canonical document and outputs

`types/emailTemplates.ts` owns the shared contract:

- `editorSchema`: canonical renderer-neutral SIOMAC block document;
- `compiledHtml`: derived rendered HTML;
- `compiledText`: derived plain-text alternative.

HTML is never the editable source of truth. A draft save persists all three so
the backend can later verify that the compiled artifacts correspond to the
canonical schema. Production compilation must revalidate and regenerate output
server-side before test send or publication.

The editor supports ordered top-level and nested blocks, drop positions before,
between and after blocks, images inside columns, direct block width/height
resizing, per-side padding, column proportions, inline text editing, undo/redo,
autosave and desktop/mobile preview. Layout is flow-based; no browser x/y
coordinates are persisted.

## Existing frontend routes

All production routes are POST-only and require the central JWT/capability
middleware:

- `hr/email-templates/catalog`
- `hr/email-templates/list`
- `hr/email-templates/get`
- `hr/email-templates/create`
- `hr/email-templates/draft/update`
- `hr/email-templates/duplicate`
- `hr/email-templates/archive`

The catalog is authoritative for triggers, audiences, languages, business
units, owners, variables, sender profiles, and branding profiles. The UI must
not invent catalog entries absent from the backend.

## Production backend gaps

Before production enablement:

1. Add narrow capabilities for view/create/edit/archive/test/review/publish,
   assets, branding, variables, bindings, audit, and live preview.
2. Add template, immutable version, binding, branding, governed asset, and audit
   storage by reusing equivalent platform entities where they already exist.
3. Add draft revisions or ETags; stale autosave must return a conflict instead
   of overwriting another author.
4. Add the record-scoped authenticated email-asset upload routes already defined
   by `src/api/hr/emailTemplateAssets.ts`. Enforce MIME, size, dimensions,
   business scope, alt text and usage tracking. Development data URLs are never
   a production persistence format.
5. Revalidate the JSON and generate sanitized, email-compatible HTML and text on
   the server. Reject unknown nodes, arbitrary HTML, unsafe links, unsupported
   variables, and untrusted assets.
6. Implement validation, preview, test send, approval, immutable publish,
   restore, version comparison, usage, and bindings as confirmed mutations.
7. Major mutations must write the business record, `app_events`, `audit_logs`,
   and workflow/notification/handoff side effects required by policy.
8. Add live E2E for every route, response contract, negative permission path,
   mutation side effect, immutable published version, active-binding protection,
   and non-production invitation links in test sends.
9. Implement the versioned server compiler behind the renderer interface. A
   pinned MJML candidate may be used only after dependency review and fixture,
   accessibility and supported-client checks; the editor document remains
   independent of that library.

No production gap may be hidden behind a decorative or non-functional control.

## MJML renderer status (2026-08-03)

The production rendering pipeline is implemented per the architecture decision:
SIOMAC editor -> canonical block schema -> `renderEmailMjml()`
(`src/lib/emailTemplateDocument.ts`) -> MJML compile -> client-compatible HTML
with Outlook conditionals. Preview and persisted `compiledHtml` use the
COMPILED output, never raw MJML (`src/lib/emailMjmlCompiler.ts`).

- `mjml-browser` pinned exactly at 5.4.0 (lazy-loaded; editor bundle unaffected).
  `mjml` 5.4.0 is a devDependency reserved for the future server recompile route.
- Simple blocks map to native mj-* components; surfaces, Smart Blocks and
  transactional designs travel via `mj-raw` so their table markup is preserved.
- Fixture gate: `src/lib/emailMjmlCompiler.test.ts` compiles all 13 starter
  templates and fails on any MJML validation error.
- Outstanding: the versioned SERVER-side recompile before test send/publication
  (blocked on the templates backend), and hosted asset URLs for illustrations.
