# SIOMAC Mockup Authoring Guide (for Codex)

You are building a **visual page mockup** that will be ported into the SIOMAC ERP app
(Preact + TypeScript, plain scoped CSS). Follow these rules so the port is a faithful, drop-in
copy — no restructuring needed.

> **Why this exists:** the onboarding overview mockup ported to a pixel-faithful result, but two
> things cost real time — (1) the mockup wrapped the page in fake app chrome (a blank sidebar +
> app-frame) that had to be stripped because SIOMAC supplies its own sidebar and top bar, and
> (2) the stylesheet grew into 60+ stacked "version" override passes (13.6k lines, `!important`
> chains) that render correctly but are a nightmare to maintain. The rules below prevent both.

## 1. Page content ONLY — no app chrome
- Do **not** render a left navigation/sidebar, a global top bar, an app frame, a window, or a
  browser mock. SIOMAC already provides all of that.
- Output only the page's own content: its title row and its sections/cards.
- ❌ No `<aside>` sidebar, no `<header>`/topbar, no `app-frame` / `workspace` / `shell` wrappers,
  no placeholder logo or nav links.
- ✅ The top-most element is the page's own root (see rule 2), whose first child is the page's
  title row (heading + page-level actions), then the content sections.

## 2. One scoped root class — wrap everything, scope every rule
- Wrap the entire page in a single root element with ONE stable class:
  `<div class="mock-<module>-<page>"> … </div>` (e.g. `mock-onboarding-overview`).
- **Every** CSS selector must be prefixed with that root class so nothing leaks into the host app:
  `.mock-onboarding-overview .kpi-card { … }` — never a bare `.kpi-card { … }`.
- This makes the whole mockup a self-contained island that can be dropped in unchanged.

## 3. Semantic, stable, prefixed class names — no version/appearance names
- Prefix every class with a short module token (e.g. `ob-` for onboarding): `ob-health-banner`,
  `ob-kpi-card`, `ob-blocked-list`.
- Name classes by **role/content**, never by appearance or iteration:
  ✅ `ob-critical-path`, `ob-deadline-row` ❌ `ob-purple-box`, `ob-card-v2`, `ob-left-thing`.
- If you revise the design, **edit the class's rules in place** — do NOT add `-v2`/`-new` classes
  or append override blocks. One class = one final definition.

## 4. One clean stylesheet, final state only
- Deliver **one** CSS file. Write each selector **once**, with its final values. Do not stack
  "version" layers, and avoid `!important` (only as a genuine last resort).
- Organize the file top-to-bottom by section with plain comment headers
  (`/* Header */`, `/* KPI cards */`, `/* Critical path */`), roughly matching DOM order.
- Goal: a developer can read any selector and see its real styling in one place.

## 5. Theme with CSS variables
- Define the palette, spacing, and radii as custom properties on the root, then reference them:
  `.mock-onboarding-overview { --bg:#fff; --text:#0b1b3a; --muted:#6d7794; --accent:#684be8;
  --radius:18px; }` then `background: var(--bg);`.
- Fonts: use standard weights (400/500/600/700). If you deliberately want a lighter/heavier
  variable-font weight, keep it in a normal range (≤ ~650) and note it — avoid 800–900 walls of bold.

## 6. Build as discrete, self-contained sections (they become components)
- Structure the page as independent sections/cards. Each is one wrapper element + its children:
  `<article class="ob-kpi-card"> … </article>`. Repeatable items (rows, cards) share one class and
  differ only by data.
- Keep each section's CSS self-contained under its own wrapper class. Avoid cross-section selectors
  that reach from one card into another (`.ob-header + .ob-list .row`). This lets each section lift
  into its own Preact component cleanly.

## 7. Portable placeholder data — mirror real field names
- Drive the mockup from a small JS array/object per section, not hard-coded inline text.
- Use field names that mirror real domain data so the mock→real swap is a rename, not a rewrite:
  `{ employeeName, caseNo, status, workerType, dueAt, progressPercent, ownerName }`.
- Use realistic sample values and **initials-based avatars** (e.g. a tinted circle with `JD`) —
  ❌ no stock photos, no external image URLs.
- Where a number/label comes from real data later, keep it in the data object (not baked into JSX).

## 8. Inline SVG icons, one consistent convention
- Icons are inline `<svg viewBox="0 0 24 24">` referenced by a name, drawn as **stroke outlines**:
  base rule `svg { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round;
  stroke-linejoin:round; }`, sized with explicit `width`/`height` in px.
- Keep one small icon set in the file. ❌ No icon fonts (FontAwesome), no icon CDNs, no emoji as UI icons.

## 9. Self-contained, zero external dependencies
- Plain HTML + one CSS file (+ minimal vanilla JS or Preact for interactivity).
- ❌ No Tailwind/Bootstrap/jQuery, no Google Fonts / CDN `<link>`s, no build-tool-specific syntax.
  Everything needed must live in the two delivered files.

## 10. Semantic HTML + basic accessibility
- Real `<button>` for every clickable action (they map to real handlers on port), correct heading
  order (`<h1>` once, then `<h2>`), `aria-label` on icon-only buttons, `alt`/`aria` where needed.
- Interactive states via classes (`.is-active`, `.is-open`), not inline style toggling.

## 11. Responsive within the page only
- Lay out with CSS grid/flex inside the page root. Add a couple of sensible breakpoints
  (`@media (max-width: …)` or `@container`). Don't assume a fixed viewport or that app chrome exists.

## Deliverable shape
Hand back exactly:
1. **`<Page>.tsx`** (or `<Page>.html`) — the page root (rule 2), title row, and sections, driven by
   per-section placeholder data (rule 7).
2. **`<Page>.css`** — one stylesheet, every selector scoped under the root (rule 2), written once (rule 4).
3. A short note listing, per section, the **intended real data source** in one line each
   (e.g. "KPI strip ← onboarding dashboard stats"), so wiring is obvious.

## Quick checklist before delivering
- [ ] No sidebar / top bar / app frame — page content only
- [ ] Single root class; every CSS selector scoped under it
- [ ] Role-based class names, module-prefixed, no `-v2`/appearance names
- [ ] One CSS file, each selector defined once, minimal `!important`
- [ ] CSS variables for colors/spacing; sane font-weights
- [ ] Sections are self-contained (no cross-section selectors)
- [ ] Data-driven with real-ish field names; initials avatars, no stock photos
- [ ] Inline stroke-SVG icons; no icon fonts/CDNs
- [ ] No external CSS/JS frameworks or fonts
- [ ] Semantic HTML, real buttons, aria labels

---

## Paste-to-Codex prompt (short form)

> Build a **visual page mockup only** — no left sidebar, no top bar, no app frame (the host app
> supplies those). Wrap everything in one root `<div class="mock-<name>">` and **scope every CSS
> selector under that class**. Use role-based, module-prefixed class names (no `-v2`/appearance
> names); define each selector **once** in a **single CSS file** (no stacked version overrides, avoid
> `!important`). Theme with CSS variables; keep font-weights ≤ ~650. Build the page as discrete,
> self-contained sections/cards (each becomes a component) with **no cross-section selectors**. Drive
> it from small per-section data objects using real-ish field names (`employeeName`, `caseNo`,
> `status`, `dueAt`, `progressPercent`); use **initials avatars, no stock photos**. Icons are inline
> stroke SVGs (`fill:none; stroke:currentColor; stroke-width:2`), no icon fonts/CDNs. No external
> frameworks/fonts. Semantic HTML, real `<button>`s, aria labels. Deliver `<Page>.tsx` + `<Page>.css`
> plus a one-line note of the intended real data source per section.
