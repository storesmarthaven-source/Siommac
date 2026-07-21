# Widget Platform v3 implementation handoff

Ownership: the platform owns the contract, registry, placement/migration engine, access chain, persistence, library shell, package integration, governance policy registry, and approved data-source registry. Product modules own widget definitions, API-backed TanStack hooks, business permissions, record scope, and action permissions.

Architecture: `src/ui/widgets` remains the single engine and continues to use `react-grid-layout`. Code packages self-register globally; pages may still provide closure-backed local widgets. Definitions normalize to contract v3. New boards use a 12-column desktop grid, while responsive tablet/mobile placements are derived unless explicitly supplied.

Permissions: administrative surfaces use `ui.widgets.governance.view/manage`, `ui.widgets.sources.view/manage`, and `ui.widgets.packages.view/manage`. These capabilities expose platform administration only and never grant business-data access. The mount chain fails closed: page capability → governance → widget view capability → approved source capability → server-enforced record scope → mount.

Data flow: live first-party widgets keep using authenticated `/api/` module hooks. Approved generic sources must register an `/api/` endpoint, permission, user/org/record scope, and refresh policy. Realtime is invalidation only. Static preview and action-gated states are explicit.

Migration and persistence: historical `ui_layout.layout` values are normalized in memory to v3 without dropping unknown fields, instances, config, or legacy geometry. Drag, resize, add, remove, and configure are staged; Save writes the v3 envelope, Cancel restores the persisted baseline, and Reset returns to the organization/page default. Missing, disabled, restricted, or uninstalled widgets retain their placement as placeholders.

Verification completed in the dedicated worktree: backend/frontend TypeScript checks passed; production build passed; 46 frontend files / 429 tests passed; all 30 backend suites / 835 assertions passed after building the generated backend required by `helpers.test.js`; focused changed-file frontend lint passed; and the generated repository index check passed. The repository-wide lint command remains red on 4,042 pre-existing findings outside this slice. Live `widgets` E2E is implemented but could not execute because this isolated worktree has no `.env` or `.env.local`; credentials were not read from the prohibited worktrees.

Employee Master widgets are the next consumer pack, but their new implementation has not started.
