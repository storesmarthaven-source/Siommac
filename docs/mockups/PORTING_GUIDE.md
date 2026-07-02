# Siomac page mockups — restyle & port-back guide

Four **self-contained** HTML files (HTML + all CSS inlined in one `<style>`, Inter + Font Awesome
from CDN). Open any in a browser, restyle the `<style>` (and markup if you want), send it back,
and I'll port the changes into the real Preact components + CSS files.

| Mockup file | Real page component | What's on it |
|---|---|---|
| `profile.html` | `src/components/sections/Profile/MyProfileSection.tsx` | PageHeader + hero + Account info / Security / Activity cards |
| `onboarding-overview.html` | `src/components/sections/HR/OnboardingOverview.tsx` | PageHeader + Customize grid (KPI tiles + cases table) |
| `onboarding-case-detail.html` | `src/components/sections/HR/OnboardingCaseDetail.tsx` | PageHeader (+ lifecycle actions) + Customize grid (KPI tiles + functional tables) |
| `employee-master.html` | `src/components/sections/HR/EmployeeMaster.tsx` | PageHeader + Customize grid (StatsCard KPIs + register table) |

## How to restyle (so port-back is clean)

1. **Edit the `<style>` block, keep the class names.** Each visible thing has a CSS *scope* (a
   prefix). Restyle the rules under a scope and I drop them straight into that scope's source file.
   Renaming classes or changing the markup structure makes porting harder — tweak values, not names,
   where possible. If you DO restructure markup, that's fine, just flag it.
2. **One scope = one source file.** When you change a scope's rules, I know exactly where they go:

   | Scope (class prefix) | Where it appears | Source CSS file to port into |
   |---|---|---|
   | `.ui-page-*` | the page header (title, breadcrumb, meta) — **every page** | `assets/styles/uikit-layout.css` |
   | `.profile-notif-pill`, `.pnp-*` | the profile pill (top-right) — **every page** | `assets/styles/dashboard-panel.css` |
   | `.pf-*` | profile page body | `src/components/sections/Profile/profilePage.css` |
   | `.obx-*` | case-detail action buttons + functional tables | `src/components/sections/HR/onboardingCase.css` |
   | `.ocw-*` | case-detail KPI tiles | `src/ui/widgets/onboardingCaseWidgets.css` |
   | `.obw-*` | onboarding-overview KPI tiles | `src/ui/widgets/onboardingWidgets.css` |
   | `.hr-emp-master *`, `.hr-onboarding-overview *` | the register / cases tables + toolbars + filters | `src/components/sections/HR/HR.css` |
   | `.stat-card*` | employee-master KPI cards | `assets/styles/uikit-layout.css` |
   | `.wbi-*` | the "Customize" toolbar | `src/ui/widgets/widgetBoard.css` |

3. **`:root` tokens** at the very top of each file (`--siomac-navy`, `--text-muted`, `--border`,
   `--bg-subtle`, …) are the app-wide design tokens (`assets/styles/base.css`). Change a token and it
   re-themes everything — the cleanest way to restyle broadly.

## Two important caveats

- **`.mock-board` / `.mock-cell` are MOCKUP-ONLY.** The real customize grid is laid out by
  **gridstack** (drag/resize, saved per user) — not this CSS grid. So **don't restyle `.mock-board`/
  `.mock-cell`** (they won't exist in the app). Restyle the widget **cards** inside them
  (`.ocw-*`, `.obw-*`, `.obx-*`, `.stat-card`). The `style="grid-column:span N"` on cells just
  approximates each widget's default width.
- **Shared chrome is global.** `.ui-page-*` (PageHeader), `.profile-notif-pill`/`.pnp-*` (ProfilePill),
  `.stat-card`, and the tokens appear on **every** page. Restyling them changes the whole app, not
  just one page — which is usually what we want for "make pages standard", but flag if you only meant
  it for one page.

## Sample data
All text/numbers are hardcoded sample data (e.g. "Keisha Boodram", "68%"). Ignore the content —
focus on layout, spacing, colour, shape. The real pages bind live data into the same markup.

## Feeding back
Send the edited file(s). For each, I'll diff the `<style>` against the current source, port each
scope's changed rules into the file in the table above, then run typecheck + vitest. If you
restructured markup, I'll mirror the structure change in the component's JSX too.
