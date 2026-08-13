/**
 * scripts/scan-button-usage.mjs — every Button in the app, as data.
 *
 * The Studio's component pages show what Button CAN do. This shows what the app
 * actually asks of it: every call site, deduped by prop signature, so ~200 call
 * sites collapse to the handful of distinct shapes that really exist.
 *
 * Derived, never hand-maintained. A hand-written list of "buttons in the app"
 * is wrong the first time someone adds one — the same failure the component
 * registry exists to prevent. Regenerates with `npm run repo:index`.
 *
 * ⚠ HONEST LIMITS, surfaced in the output rather than hidden:
 *
 *  • A prop whose value is an expression (`variant={tone}`) cannot be resolved
 *    statically. Those sites are counted in `dynamic` and NOT rendered, because
 *    rendering a guess would be worse than admitting the gap.
 *  • Legacy `<button class="…">` markup is counted separately. It is the
 *    migration debt, and leaving it out would make the page read as if the
 *    app were fully migrated.
 *
 * Usage: node scripts/scan-button-usage.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
/* NOT docs/generated/: that directory is owned exclusively by
   generate-codebase-index.mjs, which treats anything it did not write as stale
   and DELETES it. Generated data lives beside the only code that reads it. */
const OUT = path.join(ROOT, 'src/ui/studio/generated/button-usage.json');

/** Where the call site lives, which changes what it means. */
const zoneOf = (posix) =>
  /src\/ui\/(registry|studio|gallery)\//.test(posix) ? 'docs'
  : /src\/ui\//.test(posix) ? 'kit'
  : 'app';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!p.includes('node_modules')) walk(p, out); }
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Button's canonical defaults, read from src/ui/primitives/Button.tsx.
 *
 * Writing `variant="secondary"` and omitting it entirely produce the same
 * button, so they must normalize to the same structure — otherwise the
 * inventory invents a difference the rendered UI does not have.
 */
const DEFAULTS = { variant: 'secondary', tone: 'default', size: 'md' };

/**
 * Props whose PRESENCE is structural but whose VALUE is not.
 *
 * `iconLeft` is a VNode, so every icon button passes an expression. Treating
 * that as unresolvable pushed most icon buttons into the dynamic bucket and hid
 * them from the inventory. What matters for design consistency is that the
 * button HAS a leading icon — not which glyph it is.
 */
const PRESENCE_ONLY = ['iconLeft', 'iconRight'];

/** Props that say nothing about the button's design. */
const IGNORED = [
  'onClick', 'onKeyDown', 'onFocus', 'onBlur', 'ref', 'key', 'style', 'children',
  'label', 'title', 'id', 'class', 'className', 'aria-label', 'type', 'form', 'name',
  'forceState',   // a Studio preview prop, never an application design decision
];

/**
 * Parse one `<Button …>` opening tag into a raw and a structural signature.
 *
 * `dynamic` is set only when a VALUE-carrying prop is an expression
 * (`variant={tone}`), because that genuinely cannot be resolved. A presence-only
 * prop being an expression is expected and resolvable.
 */
function parseProps(tag) {
  const raw = {};
  const structural = {};
  let dynamic = false;

  const note = (k, v) => {
    if (IGNORED.includes(k)) return;
    raw[k] = v;
    if (PRESENCE_ONLY.includes(k)) { structural[k] = true; return; }
    // An explicitly-written canonical default is not a distinct design.
    if (DEFAULTS[k] !== undefined && DEFAULTS[k] === v) return;
    // The icon ASSET is content, not structure — fa-plus and fa-save are one shape.
    if (k === 'icon') { structural.iconLeft = true; return; }
    if (k === 'href') { structural.href = true; return; }   // anchor semantics, not the URL
    structural[k] = v;
  };

  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) note(m[1], m[2]);
  for (const m of tag.matchAll(/(?:^|\s)(disabled|loading|fullWidth|iconOnly|pressed)(?=\s|\/|>|$)/g)) {
    note(m[1], true);
  }
  for (const m of tag.matchAll(/([\w-]+)=\{/g)) {
    const k = m[1];
    if (IGNORED.includes(k)) continue;
    if (PRESENCE_ONLY.includes(k)) { raw[k] = '{node}'; structural[k] = true; continue; }
    raw[k] = '{expr}';
    dynamic = true;
  }
  return { raw, structural, dynamic };
}

const files = walk('src').map(f => ({ f, posix: f.split(path.sep).join('/') }));

const shapes = new Map();      // raw prop signature      -> entry
const structures = new Map();  // structural signature    -> entry
let dynamicSites = 0;

/* ── Retirement classification ────────────────────────────────────────────────
   The Button retirement programme needs every raw <button> sorted into the
   bucket that decides what happens to it — not one undifferentiated debt number:

     active-legacy      a legacy family on a page the app can still reach.
                        MIGRATE the consumer to its canonical owner, then delete
                        the runtime/CSS once the family hits zero consumers.
     legacy-page-only   a legacy family whose only consumers sit on pages nothing
                        imports. Do NOT mechanically migrate.

                        ⛔ UNREACHABLE IS NOT THE SAME AS OBSOLETE. A page is
                        also unreachable when it is BUILT BUT NOT YET WIRED —
                        the Email Studio is exactly that, and deleting it would
                        destroy in-flight work. This bucket is a SHORTLIST FOR A
                        HUMAN, never an auto-retire list. `inFlight` below names
                        the surfaces already known to be not-yet-wired.
     unresolved         no class, or `class={expr}`. Cannot be attributed to a
                        family by any static rule, so it needs a human per site.
                        Counted loudly rather than quietly dropped.

   "Reachable" is import-graph reachability from the real entry, so a page is
   called dead only when nothing imports it — never because it looked unused. */

const ENTRY = 'src/main.tsx';

/**
 * Unreachable, but NOT obsolete — do not propose these for retirement.
 *
 * Each is an active programme whose page is not wired into the shell yet.
 * Listed here rather than silently excluded, so the exemption is auditable and
 * someone can challenge an entry that has since gone stale.
 */
const IN_FLIGHT = [
  ['src/components/sections/HR/emailStudio/', 'Email Template Studio — active programme; also holds the protected stash@{0}'],
];
const inFlightReason = (posix) => IN_FLIGHT.find(([prefix]) => posix.startsWith(prefix))?.[1];

/** vite.config.ts aliases, longest-prefix first. Kept in sync by hand — a
 *  missing alias makes a live file look dead, so unresolved imports are counted
 *  and reported rather than silently skipped. */
const ALIASES = [
  ['@api/', 'src/api/'], ['@store/', 'src/store/'], ['@lib/', 'src/lib/'],
  ['@shared/', 'src/components/shared/'], ['@payslip/', 'src/components/sections/PayslipStudio/'],
  ['@sections/', 'src/components/sections/'], ['@ui/', 'src/ui/'],
  ['@components/', 'src/components/'], ['@cfg/', 'src/config/'],
  ['@shell/', 'src/shell/'], ['@/', 'src/'],
];
const BARE = { '@store': 'src/store/index.ts', '@cfg': 'src/config/index.ts',
  '@lib': 'src/lib/index.ts', '@ui': 'src/ui/index.ts', '@shell': 'src/shell/index.ts' };

const EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts'];
let unresolvedImports = 0;

function resolveSpec(spec, fromPosix) {
  let base = null;
  if (BARE[spec]) base = BARE[spec];
  else {
    for (const [a, r] of ALIASES) if (spec.startsWith(a)) { base = r + spec.slice(a.length); break; }
    if (!base && spec.startsWith('.')) {
      base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPosix), spec));
    }
  }
  if (!base) return null;                       // package import — not our graph
  for (const ext of ['', ...EXTS]) {
    const cand = base + ext;
    if (fs.existsSync(path.join(ROOT, cand)) && fs.statSync(path.join(ROOT, cand)).isFile()) return cand;
  }
  unresolvedImports += 1;
  return null;
}

/** Files reachable from the entry by static import. */
function reachableFromEntry() {
  const seen = new Set();
  const queue = [ENTRY];
  /* Three forms, and the SECOND is the one that matters: `import '@sections/HR';`
     is a side-effect import with no `from` clause, and it is how every module
     self-registers. Missing it made 136 live pages look unreachable. */
  const importRe = new RegExp(
    String.raw`(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]` + '|' +
    String.raw`import\s+['"]([^'"]+)['"]` + '|' +
    String.raw`import\(\s*['"]([^'"]+)['"]\s*\)`,
    'g',
  );
  while (queue.length) {
    const cur = queue.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    let text;
    try { text = fs.readFileSync(path.join(ROOT, cur), 'utf8'); } catch { continue; }
    importRe.lastIndex = 0;
    let m;
    while ((m = importRe.exec(text))) {
      const next = resolveSpec(m[1] ?? m[2] ?? m[3], cur);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

const REACHABLE = reachableFromEntry();

const retirement = {
  activeLegacy: new Map(),      // family -> { count, files:Set }
  legacyPageOnly: new Map(),
  unresolved: { noClass: 0, dynamic: 0, files: new Set() },
  deadFiles: new Set(),
  inFlightFiles: new Set(),
};
let rawTotal = 0;

function classifyRaw(text, posix) {
  if (zoneOf(posix) !== 'app') return;          // the kit and its docs are not debt
  const live = REACHABLE.has(posix);
  const re = /<button\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text))) {
    rawTotal += 1;
    const attrs = m[1];
    const cm = attrs.match(/class(?:Name)?=\{?["']([^"']+)["']/);
    if (!cm) {
      if (/class(?:Name)?=\{/.test(attrs)) retirement.unresolved.dynamic += 1;
      else retirement.unresolved.noClass += 1;
      retirement.unresolved.files.add(posix);
      continue;
    }
    const inFlight = inFlightReason(posix) !== undefined;
    if (!live && !inFlight) retirement.deadFiles.add(posix);
    if (!live && inFlight) retirement.inFlightFiles.add(posix);
    // An in-flight surface is neither active-legacy nor retirable. Counting it
    // as either would put real work on a deletion list.
    if (!live && inFlight) continue;
    const bucket = live ? retirement.activeLegacy : retirement.legacyPageOnly;
    for (const cls of cm[1].trim().split(/\s+/)) {
      if (!bucket.has(cls)) bucket.set(cls, { count: 0, files: new Set() });
      const e = bucket.get(cls);
      e.count += 1;
      e.files.add(posix);
    }
  }
}

const famList = (m) => [...m.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .map(([family, e]) => ({ family, count: e.count, files: [...e.files].sort() }));

let legacyButtons = 0;
const legacyFiles = new Set();

const record = (map, props, posix) => {
  const sig = JSON.stringify(Object.fromEntries(Object.entries(props).sort()));
  const entry = map.get(sig) ?? { props, count: 0, files: new Set(), zones: {} };
  entry.count += 1;
  entry.files.add(posix);
  const z = zoneOf(posix);
  entry.zones[z] = (entry.zones[z] ?? 0) + 1;
  map.set(sig, entry);
};

for (const { f, posix } of files) {
  const text = fs.readFileSync(f, 'utf8');

  // Canonical <Button …>. `s` flag: JSX props routinely span lines.
  for (const m of text.matchAll(/<Button(\s[^>]*?)\/?>/gs)) {
    if (m[1].includes('${')) continue;   // a `code:` template string, not a call site
    const { raw, structural, dynamic } = parseProps(m[1]);
    if (dynamic) { dynamicSites += 1; continue; }
    record(shapes, raw, posix);
    record(structures, structural, posix);
  }

  // Legacy raw markup — the migration debt, counted not hidden.
  //
  // ⚠ This pattern matches only `class="…btn…"`, which is why it reports ~544
  // when the real figure is ~1,500: most legacy buttons carry a module family
  // (`hse-btn`, `hrfin-action`, `obx-mini`) that never contains the token `btn`.
  // Kept for continuity of the number; `retirement` below is the honest one.
  const legacy = text.match(/<button[^>]*class(?:Name)?="[^"]*\bbtn\b[^"]*"/g);
  if (legacy) {
    legacyButtons += legacy.length;
    legacyFiles.add(posix);
  }

  classifyRaw(text, posix);
}

const payload = {
  _comment:
    'GENERATED by scripts/scan-button-usage.mjs — do not edit. Every Button call ' +
    'site in the app, deduped by prop signature. Regenerate with npm run repo:index.',
  scannedFiles: files.length,
  totals: {
    canonicalSites: [...shapes.values()].reduce((n, s) => n + s.count, 0),
    /** Every distinct prop spelling — inflated by icon assets and explicit defaults. */
    distinctShapes: shapes.size,
    /** Distinct DESIGNS. This is the number that matters for consistency. */
    structuralPatterns: structures.size,
    dynamicSites,
    legacyButtons,
    legacyFiles: legacyFiles.size,
    /** Every raw <button> in app code, the honest denominator for retirement. */
    rawAppButtons: rawTotal,
  },

  /* The retirement programme's working set. One inventory, four buckets — a
     second scanner would drift from this one within a week. */
  retirement: {
    _comment:
      'active-legacy = migrate the consumer, then delete the family once it hits ' +
      'zero. legacy-page-only = the page itself is unreachable from src/main.tsx; ' +
      'retire page + component + styles together, do NOT mechanically migrate. ' +
      'unresolved = no class or class={expr}; needs a decision per site.',
    counts: {
      activeLegacy: [...retirement.activeLegacy.values()].reduce((n, e) => n + e.count, 0),
      legacyPageOnly: [...retirement.legacyPageOnly.values()].reduce((n, e) => n + e.count, 0),
      unresolved: retirement.unresolved.noClass + retirement.unresolved.dynamic,
      unreachablePages: retirement.deadFiles.size,
      inFlightPages: retirement.inFlightFiles.size,
      /** Aliases this scan could not resolve — a high number invalidates the split. */
      unresolvedImports,
    },
    activeLegacy: famList(retirement.activeLegacy),
    legacyPageOnly: famList(retirement.legacyPageOnly),
    unresolved: {
      noClass: retirement.unresolved.noClass,
      dynamic: retirement.unresolved.dynamic,
      files: [...retirement.unresolved.files].sort(),
    },
    /** Unreachable AND not known in-flight. A shortlist to confirm, not to delete. */
    unreachablePages: [...retirement.deadFiles].sort(),
    inFlight: IN_FLIGHT.map(([prefix, why]) => ({ prefix, why })),
    inFlightPages: [...retirement.inFlightFiles].sort(),
  },
  /** Structural first: it is what a design review acts on. */
  structures: [...structures.values()]
    .sort((a, b) => b.count - a.count)
    .map(s => ({ props: s.props, count: s.count, zones: s.zones, files: [...s.files].sort().slice(0, 8) })),
  shapes: [...shapes.values()]
    .sort((a, b) => b.count - a.count)
    .map(s => ({ props: s.props, count: s.count, zones: s.zones, files: [...s.files].sort().slice(0, 8) })),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

console.log(
  `Button usage: ${payload.totals.canonicalSites} sites → ${payload.totals.distinctShapes} raw signatures → ` +
  `${payload.totals.structuralPatterns} STRUCTURAL patterns · ${dynamicSites} dynamic · ` +
  `${legacyButtons} legacy <button class="btn…"> across ${legacyFiles.size} files`,
);
console.log(
  `Retirement: ${payload.retirement.counts.activeLegacy} active-legacy · ` +
  `${payload.retirement.counts.legacyPageOnly} legacy-page-only ` +
  `(${payload.retirement.counts.unreachablePages} unreachable, ` +
  `${payload.retirement.counts.inFlightPages} in-flight excluded) · ` +
  `${payload.retirement.counts.unresolved} unresolved · ` +
  `${unresolvedImports} unresolved imports`,
);
