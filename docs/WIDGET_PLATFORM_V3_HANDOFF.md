# Widget Platform v3 implementation handoff

Ownership: the platform owns the contract, registry, placement/migration engine, access chain, persistence, library shell, package integration, governance policy registry, and approved data-source registry. Product modules own widget definitions, API-backed TanStack hooks, business permissions, record scope, and action permissions.

Architecture: `src/ui/widgets` remains the single engine and continues to use `react-grid-layout`. Code packages self-register globally; pages may still provide closure-backed local widgets. Definitions normalize to contract v3. New boards use a 12-column desktop grid, while responsive tablet/mobile placements are derived unless explicitly supplied.

Permissions: administrative surfaces use `ui.widgets.governance.view/manage`, `ui.widgets.sources.view/manage`, and `ui.widgets.packages.view/manage`. These capabilities expose platform administration only and never grant business-data access. The mount chain fails closed: page capability → governance → widget view capability → approved source capability → server-enforced record scope → mount.

Data flow: live first-party widgets keep using authenticated `/api/` module hooks. Approved generic sources must register an `/api/` endpoint, permission, user/org/record scope, and refresh policy. Realtime is invalidation only. Static preview and action-gated states are explicit.

Migration and persistence: historical `ui_layout.layout` values are normalized in memory to v3 without dropping unknown fields, instances, config, or legacy geometry. Drag, resize, add, remove, and configure are staged; Save writes the v3 envelope, Cancel restores the persisted baseline, and Reset returns to the organization/page default. Missing, disabled, restricted, or uninstalled widgets retain their placement as placeholders.

The Employee Master catalogue includes the approved A, D, E, F, H, and L-O design previews. Calendar-backed Upcoming Deadlines and Task Planner widgets use authenticated TanStack hooks; the deadlines presentation is shared with Statutory Configuration so the two surfaces cannot drift.

Verification completed in the dedicated worktree: backend and frontend TypeScript checks passed; 54 frontend files / 472 tests passed; the production build passed; and the live widget package, layout, preference, and Employee Master dashboard contracts passed, including negative access and persistence. The repository index was regenerated after the final source changes.

After Widget Platform v3 was completed, the user explicitly approved the Employee Master follow-on. That production slice now owns eight authenticated dashboard widgets, a 24-column overview layout, persisted per-user register columns, and the expanded register workspace. The four `Key metrics` widgets reuse the Statutory `KpiTile`, have a single fixed 6x2 size, and are not resizable. Workforce Trend uses Chart.js, shows its values, and remains responsive/resizable. No unrelated HR modules were started.
