# Design System Studio operating model

## What Studio controls

Studio is the control plane for SIOMAC's design tokens and governed component recipes. It does not create a second styling system.

- **Theme Generator** owns brand, foundation and semantic tokens.
- **Component editors** inherit those tokens and may add component-owned recipe overrides. Button owns only `--ui-button-*` and `--ui-toggle-*` overrides.
- **Preview options** (sample state, viewport, label and example content) stay in the browser and are never published.
- Canonical component types, variants and behaviour remain locked in the typed registry and component source. Studio cannot publish arbitrary CSS, new variant names, ARIA behaviour or keyboard semantics.

## The user workflow

1. Select a component and variant in Studio.
2. Change its governed controls. The result appears only inside the scoped preview.
3. The browser keeps a local recovery copy so a refresh does not discard work.
4. Choose **Save draft** to store the current typed configuration on the server.
5. Choose **Review & publish** to review validation and publish with a summary.
6. Publishing atomically creates an immutable version, updates the runtime root, closes the draft, emits an app event and writes an audit record.
7. **History** compares published versions and rollback creates a new immutable version from the selected configuration; history is never rewritten.

The publishing controls belong to the Studio header because the draft is one design-system configuration shared by Theme Generator and every component editor. Individual component pages edit their owned portion of that configuration; they do not publish independently.

## How a published change reaches SIOMAC

```text
Studio control
  -> scoped CSS custom property in the preview (draft only)
  -> authenticated /api/theme/studio/draft/save
  -> app_theme_drafts configuration + optimistic revision
  -> authenticated /api/theme/studio/publish
  -> publish_app_theme() database transaction
     -> app_theme.configuration + flattened runtime tokens
     -> immutable app_theme_versions snapshot
     -> app_events + audit_logs
  -> /api/theme/get
  -> initTheme() applies tokens to :root and caches them
  -> canonical components consume the same semantic tokens and recipe variables
```

At application startup, `initTheme()` applies the last cached published tokens first to avoid a flash, then refreshes them from the authoritative API. Publishing also updates the current browser immediately. Other open sessions receive the new configuration on their next application load; a future realtime invalidation can trigger the same authenticated refetch without becoming an authorization source.

## Backend and database contract

The production contract is already implemented at the existing theme root:

| Layer | Implementation |
| --- | --- |
| Typed schema | `types/designSystem.ts` (`schemaVersion: 1`) |
| Frontend API | `src/api/theme.ts` |
| Authenticated routes | `netlify/functions/routes/uiPrefs.ts` |
| Runtime application | `src/ui/theme/applyTheme.ts` |
| Draft state | `src/ui/gallery/galleryStore.ts` |
| Database source | `supabase/migrations/20260623000000_ui_theme_layout.sql` |
| Live E2E coverage | `scripts/e2e/suites/designSystemStudio.mjs` |

The database model uses:

- `app_theme`: the single published global runtime root and current version.
- `app_theme_drafts`: one open global draft, its base version and optimistic revision, authorship and server validation result.
- `app_theme_versions`: immutable published snapshots used for comparison and rollback.
- `publish_app_theme(...)`: one transaction that locks the root and draft, rejects stale revisions/base versions, publishes tokens and writes the event and audit records.
- `rollback_app_theme(...)`: restores a historical configuration as a new version and records the rollback event and audit entry.

All Studio state routes require an admin session. Database writes use the service role behind the API; RLS prevents direct browser writes. The public runtime route returns only the flattened, non-sensitive token map needed to theme sign-in and application surfaces.

## Extension rule

A new editable component is registered through its typed component definition, recipe schema and owned token prefix. The catalogue and inspector are generated from that registration. A new component editor must not add bespoke persistence, a parallel table, a second publish button or raw CSS input.

Before adding another recipe to schema version 1, add its typed configuration, ownership validation, registry definition, canonical consumer impact mapping, route tests and the live Studio E2E assertions together. A breaking schema change requires a new schema version and an explicit server migration path.

## Next production hardening

The current vertical slice is deployable for tokens and Button recipes. The next planned increments are:

1. Add authenticated realtime invalidation so already-open SIOMAC sessions refetch the published runtime configuration after `platform.theme.published`.
2. Generalize recipe configuration from Button into a typed component-key map, preserving per-component ownership validation.
3. Expand impact reporting from the current canonical-consumer metadata into the publish review, grouped by application surface.
4. Add draft compare against the base published version before confirmation.
5. Add explicit draft ownership/lease policy if concurrent Studio authors need separate working drafts rather than the governed single global draft.
