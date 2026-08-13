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
  const legacy = text.match(/<button[^>]*class(?:Name)?="[^"]*\bbtn\b[^"]*"/g);
  if (legacy) {
    legacyButtons += legacy.length;
    legacyFiles.add(posix);
  }
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
