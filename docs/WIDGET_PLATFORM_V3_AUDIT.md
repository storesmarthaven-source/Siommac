# Widget Platform v3 audit disposition

Audit date: 2026-07-21. Scope: the existing `src/ui/widgets` engine and its authenticated layout/package boundaries.

## Confirmed

- One production widget engine already existed on `react-grid-layout`; page-local and global self-registration were both active.
- `ui_layout.layout` already persisted instance/zone geometry through authenticated JWT API routes. Existing values had no schema version.
- Package list/install/uninstall already used authenticated APIs and install/uninstall emitted the platform event/audit side effects.
- First-party widgets fetch through module hooks. Declarative HTML widgets remain sandboxed and are not a live-data integration surface.
- Employee Master, Onboarding, Payroll Command Center, and Statutory Dashboard are current consumers whose widgets and saved layouts must survive the upgrade.

## Fixed in this slice

- Added the typed v3 contract, canonical 12-column default, responsive placement derivation, definition normalization, and a lossless v1/v2-to-v3 migration.
- Replaced unresolved-instance pruning with explicit Missing, Disabled, and Restricted placeholders; positions no longer collapse when packages or permissions change.
- Added a fail-closed mount decision for page permission, governance, widget view permission, approved data source, and then live mount. Backend record scope remains the API's responsibility.
- Added capability-only Governance, Data Sources, and Package administration visibility. No role-name checks were introduced.
- Added an approved data-source registry that rejects non-`/api/` endpoints and declares permission, scope, refresh, and realtime-invalidation behavior.
- Changed board edits to a staged transaction with explicit Save layout and Cancel changes across every current board consumer.
- Extended the authenticated layout sanitizer and E2E contract to retain v3 envelope, config, responsive placement, hidden, and admin-lock metadata.
- Added the approved Employee Master A, D, E, F, H, and L-O catalogue previews with content-safe minimum sizes and responsive internal layouts.
- Added authenticated Calendar-backed Upcoming Deadlines and Task Planner widgets; Upcoming Deadlines reuses the Statutory Configuration presentation rather than maintaining a duplicate.

## Deferred by scope

- Persisted organization governance/source authoring APIs. v3 currently consumes first-party/package policy declarations; it does not expose a fake editor.
- Converting legacy 10/24-column page-specific layouts to 12 columns. New layouts default to 12; legacy column metadata and geometry remain intact to prevent data loss.
- Employee Master production business-data implementation and broader page improvements, Contracts, Reports Center, Payroll/HSE/Messenger/Ticket/Notification work, and unrelated module refactors. The approved static catalogue previews are present, but production Employee Master work has not started.
