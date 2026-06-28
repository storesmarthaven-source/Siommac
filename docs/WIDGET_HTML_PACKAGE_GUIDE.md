# HTML Design-Widget Packages — authoring guide

> Design a board of widgets as plain **HTML + CSS** (gauges, charts, SVG, whatever), drop the
> file into **Widget Library → Add widget ▾ → Install package**, and each card becomes an installable
> widget that renders in a sandboxed iframe. These are **design / mock widgets** — the numbers are
> baked into the HTML (perfect for mocking page layouts). Wiring to live data is a separate, later
> step. (For data-driven widgets, see the declarative format in `WIDGET_AUTHORING_GUIDE.md`.)
>
> **The one rule: author FLUID.** A widget FILLS its board cell and REFLOWS — exactly like the
> built-in widgets. There is **no fixed design size and nothing is scaled**, so text stays crisp and
> selectable and the card never floats inside an empty "container". See §3 for how (it's two lines of CSS).
>
> **Start from [`docs/examples/widget-template.html`](examples/widget-template.html)** — copy it,
> keep one `<section data-widget-id>` for a single widget or several for a pack, restyle inside.
>
> **Accepted files** at install: a bare **`.html`** (each `[data-widget-id]` section → a widget),
> a **`.zip`** (a `manifest.json` + referenced html/css/data files, or a single `.html` inside), or a
> **`.json`** declarative manifest. The package is stored in the DB (org-wide); install/uninstall is admin-only.

---

## 1. The file

One self-contained **`.html`** file (or a `.zip` containing it). It holds:

- One or more **`<style>`** blocks → bundled as the package CSS, applied inside every widget's iframe.
- One or more **widget elements**, each a top-level element marked with **`data-widget-id`**.
- *(optional)* **`<script>`** blocks → JavaScript (see §5). A `<script>` **inside** a section runs in
  that one widget; a shared `<script>` **outside** every section runs in all of them.

The importer parses the file (DOMParser), pulls the `<style>`(s) and every `[data-widget-id]`
element, and turns each into one widget. Use **inline `<style>`** — external `<link rel="stylesheet">`
won't load inside the sandbox.

### Do I need a `manifest.json`? — three equivalent forms

A `manifest.json` is **optional**. Pick whichever is convenient; all three install identically:

| Form | What's in it | When to use |
|---|---|---|
| **Bare `.html`** | one file: `<style>` + `[data-widget-id]` sections | quickest — design it, drop it in. **No JSON needed.** |
| **`.zip` (manifest + files)** | `manifest.json` listing widgets, each referencing a `*.html` + `styles.css` by filename | the canonical, portable form — split files, version control, multiple stylesheets |
| **`.json`** | a declarative manifest with `view` specs inline | data-driven (non-HTML) widgets — see `WIDGET_AUTHORING_GUIDE.md` |

The HTML-section form and the manifest form carry the **same metadata** (`data-widget-*` attrs ≡
manifest fields `id/title/icon/category/tags/size/sizes` + `kind:"html"`, `html`/`css` file refs).
In a `.zip`, a manifest entry's `"html": "recordHealth.html"` and `"css": "styles.css"` are resolved
against the files in the archive.

**Worked example (the health pack, both forms):**
- bare HTML — [`docs/examples/employee-master-health-pack.html`](examples/employee-master-health-pack.html)
- canonical `.zip` + its unpacked folder — [`docs/examples/employee-master-health/`](examples/employee-master-health/)
  (`manifest.json` + `styles.css` + one `.html` per widget) and `employee-master-health-pack.zip`.

Regenerate the `.zip`/folder from any single design file:
`node scripts/build-widget-package.mjs <source.html> <out-name>`.

```html
<!doctype html><html><head><meta charset="utf-8">
  <meta name="widget-package-name" content="Employee Master Health">
  <meta name="widget-package-version" content="1.0.0">
  <style>
    /* the card fills its cell and reflows; sizes are vmin/clamp, not fixed px */
    .card{width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;
      padding:clamp(14px,5vmin,30px);border-radius:clamp(14px,3.2vmin,26px);background:#fff}
    .title{font-size:clamp(15px,4.4vmin,26px);font-weight:850}
    /* … the rest of your card CSS, in relative units … */
  </style>
</head><body>
  <section class="card"
           data-widget-id="hr.employeeMaster.recordHealth"
           data-widget-title="Employee Record Health"
           data-widget-description="Data-quality score"
           data-widget-icon="fa-heart-pulse"
           data-widget-category="Employee Master"
           data-widget-size="tall"
           data-widget-sizes="standard,wide,tall,large">
     …your fluid card markup…
  </section>
  <!-- more <section data-widget-id="…"> cards -->
</body></html>
```

---

## 2. Attributes the importer reads

| Attribute | Required | Meaning |
|---|---|---|
| `data-widget-id` | ✅ | Unique widget id, `module.area.thing` (e.g. `hr.employeeMaster.recordHealth`). |
| `data-widget-title` | – | Library title. Falls back to the element's first `.title`/`h1`/`h2`/`h3` text, then the id. |
| `data-widget-description` | – | Library subtitle. Falls back to the first `.sub` text. |
| `data-widget-icon` | – | Font Awesome class for the **library tile** (`fa-heart-pulse`). Default `fa-table-cells-large`. |
| `data-widget-category` | – | Catalogue grouping. Default `Custom`. |
| `data-widget-tags` | – | Comma-separated search tags. |
| `data-widget-size` | – | Default board size: `compact·standard·wide·large·tall·hero`. Default `standard`. |
| `data-widget-sizes` | – | Comma-separated allowed sizes. Default = just the default size. |
| `<meta name="widget-package-name">` / `-version` | – | Package name/version (else derived from the file name). |

Only `data-widget-id` is mandatory; everything else has a sensible fallback. There is **no**
`data-widget-design-width/height` — widgets are fluid (see §3), so there's nothing to scale.

---

## 3. How it renders — author FLUID

Each widget renders in a **sandboxed `<iframe>`** that fills its board cell: the iframe document is
`your <style> + the card's HTML`. Because it's an iframe, your CSS/SVG/animations work as-is, fully
isolated from the app (no style bleed, no security risk).

The board does **not** scale your card — it just gives it the cell. So your card must **fill the cell
and scale as ONE object**, exactly like the built-in widgets. Treat each card as a small responsive app.
The full system is in [`widget-template.html`](examples/widget-template.html); copy its skeleton. The rules:

1. **Card root fills its cell:** `width:100%; height:100%; box-sizing:border-box`. (The board also sets
   `body{display:flex}` + `body>*{flex:1}` so a single root element fills automatically.)
2. **One scale token — `--s`.** Put `--s: 1vmin` on the card and size **everything** with
   `calc(var(--s) * N)` (`font-size:calc(var(--s)*6)`, `padding:calc(var(--s)*5)`, …). `vmin` = 1% of the
   cell's smaller side, so one token grows/shrinks the whole card together. (Plain `Nvmin` works too — `--s`
   just gives you a single tuning point.)
3. **No `clamp()` caps, no fixed `px`.** `clamp(min,Nvmin,max)` caps the text so it stops scaling while the
   chart keeps going → inconsistent. Fixed px never scales. Want a readability floor only? `max(12px, calc(var(--s)*6))`.
4. **Fixed budget so the visual is never crushed** — a flex column of three parts:
   - `.head  { flex:none }`  · header (icon + title)  ≈ 20–25%
   - `.stage { flex:1; min-height:0 }`  · the chart / gauge / number  ≈ 45–60%
   - `.footer{ flex:none }`  · notes / mini-stats / legend  ≈ 20–30%
5. **Charts** → a chart stage with the SVG on top and the axis **below** it (`display:grid;grid-template-rows:1fr auto`)
   so the axis doesn't steal chart height. SVG `viewBox` + `vector-effect:non-scaling-stroke`.
6. **Gauges / donuts / rings / batteries** → a container with **`aspect-ratio`** holds the absolutely-positioned
   SVG (`.gauge{aspect-ratio:352/280}`, circular `{aspect-ratio:1}`), with the value overlaid via
   `position:absolute;inset:0;display:grid;place-items:center`.
7. **Reflow for extreme shapes** → a card can't look right in a square, a tall and a wide cell without reflowing.
   Add `@media (min-aspect-ratio:1.35/1)` (side-by-side layout) and `@media (max-aspect-ratio:.8/1)` (tighten)
   variants for cards that support several sizes.

That's it — no design size, no app scaling, text stays selectable, and the card fills its cell at any size
with **everything scaling together**. The cell's size/aspect is yours to control on the board (drag-resize).

---

## 4. Converting a fixed-size design to fluid

Have a mockup built at a fixed canvas size (e.g. `.canvas{grid-template-columns:repeat(4,461px);
grid-template-rows:640px}` with cards full of absolute `px`)? Convert it once:

1. **Make each card fill:** on the `[data-widget-id]` element set `width:100%;height:100%;display:flex;
   flex-direction:column` and drop the fixed canvas wrapper (keep it only for standalone browser
   preview — the importer ignores non-widget markup).
2. **Replace fixed px with relative units:** `font-size:83px` → `clamp(28px,11vmin,72px)`;
   `padding:44px 31px` → `clamp(14px,5vmin,30px)`; gauge boxes → an SVG `viewBox` in a `flex:1` area.
3. **Turn absolute overlays into flow:** an absolutely-positioned footer/note becomes a normal flex
   child at the bottom; a number centered over a gauge becomes an overlay (`position:absolute;inset:0;
   display:grid;place-items:center`) inside the `flex:1` stage.
4. **Add the metadata** (`data-widget-title/icon/category/size/sizes`) and package `<meta>`.

The reference conversion is the Employee Master Health pack — compare the cards in
[`docs/examples/employee-master-health-pack.html`](examples/employee-master-health-pack.html) (each is
a fluid `.card` with a `.stage` flex:1 visual). Copy that skeleton.

---

## 5. JavaScript & interactivity

Widgets can run JS — for animations, charts, interactivity, local computation.

- **Per-widget:** a `<script>` **inside** a `[data-widget-id]` section runs in *that* widget only.
- **Shared:** a `<script>` **outside** every section is bundled as the package JS and runs in *every*
  widget. In a manifest `.zip`, this is a widget entry's `"js": "shared.js"` (a file ref, like `css`).
- **Inline only** — external `<script src="…">` won't load (blocked by CSP).

```html
<section data-widget-id="pack.pulse" data-widget-title="Live Pulse" data-widget-size="standard">
  <div class="mw-card"><div class="mw-metric" id="pulse">0</div></div>
  <script>
    (function(){var el=document.getElementById('pulse'),n=0,t=setInterval(function(){
      n+=Math.ceil((248-n)/12); if(n>=248){n=248;clearInterval(t);} el.textContent=n; },60);})();
  </script>
</section>
```

**The sandbox (important):** every widget runs in an `<iframe sandbox="allow-scripts">` with a strict
CSP (`default-src 'none'`). JS runs, but it **cannot** reach the network, the parent app/DOM, cookies,
or storage. So widget JS is for *presentation* only — it **cannot fetch live data**. That's deliberate:
it's the boundary that lets you install third-party widgets without risk. (Live data is a separate,
server-backed path — see `WIDGET_AUTHORING_GUIDE.md`.)

---

## 6. File format, the `.siowidget` extension & what's protectable

A package archive is a **zip**. You may keep the `.zip` extension or rename it to the branded
**`.siowidget`** — both install identically (the importer treats `.siowidget` as a zip). Build either:

```
node scripts/build-widget-package.mjs <source.html> <out-name> [--min] [--ext=siowidget]
  --min            strip comments + collapse whitespace (harder to skim)
  --ext=siowidget  write a .siowidget archive instead of .zip
```

**Honest limit — client-side code can't be hidden.** A widget renders in the browser, so its HTML/CSS/JS
is **always** visible in DevTools (Elements/Sources) regardless of the archive extension or `--min`.
`.siowidget` and minification are **deterrents (obscurity), not protection** — they slow a casual
viewer, not a determined one.

What *is* protected: the **sandbox** stops a widget from touching your app, data, or network. If you
need to keep *logic or secrets* truly private, don't ship them in the package — put them **server-side**
behind an authenticated API and have a (code) widget call it. The installable HTML format is for
presentation/design, by design.

---

## 7. Install

Admin → **Widget Library → Install package** → pick the `.html`, `.zip`, or `.siowidget`. The cards
become widgets (title, icon, category as above), browseable in the library and addable to any board
exactly like the built-in widgets — each filling its cell and reflowing. Manage/uninstall via **Manage**
(removing a package also clears its widgets from boards).

> Static by design: the values shown are whatever's in your HTML. To make a card show *live* data
> later, it would be re-authored as a code or declarative widget (separate path).
