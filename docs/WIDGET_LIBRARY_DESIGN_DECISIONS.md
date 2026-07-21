# Widget Library design decisions

Status: design capture and planning only. This note does not authorize module implementation.

## Canonical sources

- The authenticated v2 Widget Library currently rendered by `WidgetLibraryModal` and `widgetLibrary.css`.
- Standalone extracted reference: `docs/mockups/widget-library.html`.
- Proposed enterprise overhaul: `docs/mockups/widget-library-enterprise.html`.
- HTML authoring and proportional resize reference: `docs/examples/widget-template.html`.
- Existing eight-widget visual pack: `docs/examples/employee-master-health-pack.html`.

The Widget Library is an enterprise platform used across the application. HR is a consumer, not the owner.

## Preserve from the live library

- Wide modal with catalogue and selected-widget detail pane.
- Search, module/category filters, live-preview and demo-data controls.
- Curated bundles and individual catalogue tiles.
- True widget previews, supported-size selector, data-source metadata, dependencies and refresh metadata.
- Preview-on-board, add, configure, package options and persistent-layout footer.
- Responsive single-column state for narrow viewports.
- Explicit locked, already-added, unavailable and permission-denied states.

## Existing HTML widget assets to retain as references

1. Employee Record Health
2. Data Change Trend
3. Record Risk Monitor
4. Workforce Coverage
5. Profile Completeness
6. Master Data Workload
7. Lifecycle Activity
8. Weekly Activity

These assets establish useful rules for proportional widget scaling, visual hierarchy and card composition. They are design references until their data contracts and permissions are explicitly implemented.

## Platform decisions

- Keep one global catalogue, board contract, layout engine and governance model across HR, HSE, Finance, Payroll, Operations and platform surfaces.
- First-party live widgets fetch through existing TanStack hooks backed by authenticated JWT APIs.
- Realtime only invalidates/refetches authorized queries.
- Installed HTML remains sandboxed and network-blocked. It cannot be treated as a live-data integration mechanism.
- A future declarative live-data system must resolve only allowlisted source keys with server-enforced permissions and record scope.
- Page access, widget data access, widget action access, personal layout access, organization-default management and package governance are separate capabilities.
- The current visual shell is evolved rather than replaced.
- Employee Master widgets are authored only after the shared platform contract and governance decisions are verified.

## Enterprise redesign prototype

The proposed overhaul keeps the current catalogue/detail relationship and adds:

- A persistent navigation rail for catalogue discovery, recommendations, bundles, personal layouts,
  installed packages, governance and approved data sources.
- Page context so users always know where a selected widget will be placed.
- Module, source, status, permission and tag discovery in one search surface.
- Clear `Live API`, `Static preview`, `Restricted`, `Action gated` and `On this page` states.
- A dedicated data-and-access inspector that names the source, permission, refresh behavior,
  supported pages and allowed sizes before placement.
- Separate user layout, package management and administrator governance surfaces.
- Explicit representation of the Employee Master Health HTML pack as preview-only until a governed
  server data binding exists.

The overhaul is a design proposal. Production components remain unchanged until the interaction,
access and governance decisions are approved.
