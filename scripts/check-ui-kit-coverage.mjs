#!/usr/bin/env node
/**
 * scripts/check-ui-kit-coverage.mjs — UI Kit adoption, as a number.
 *
 *   node scripts/check-ui-kit-coverage.mjs            report
 *   node scripts/check-ui-kit-coverage.mjs --check     fail if any count went UP
 *   node scripts/check-ui-kit-coverage.mjs --write     record the current counts
 *   node scripts/check-ui-kit-coverage.mjs --json      machine-readable
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The Phase 0 audit had to be done by hand: 1,679 raw <button>, 151 button class
 * families, 225 overlay class families, 6 dialog implementations. That answer was
 * accurate for one afternoon. This script makes it a build artefact, so "which
 * reusable patterns are still not in the kit?" stops being a periodic manual
 * exercise.
 *
 * ── The ratchet ────────────────────────────────────────────────────────────
 * 100% adoption is not required and is not the gate. The gate is DIRECTION:
 * a change may lower any count, and may not raise one. If a PR adds the
 * 1,680th raw <button>, --check fails and the author either uses the kit or
 * consciously raises the baseline with a reason.
 *
 * A ratchet is chosen over a hard limit because the debt is real and large;
 * a hard limit would just be switched off within a week.
 *
 * ── What it deliberately does NOT do ───────────────────────────────────────
 * It does not parse TypeScript. Counting `<button` and `class="…btn…"` with
 * regexes is approximate — a string containing "<button" in a comment counts.
 * That is acceptable because the number is used as a TREND, not as an
 * assertion about any single line, and a real parser would be a week of work
 * to make the same decision.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'ui-kit-baseline.json');

const args = new Set(process.argv.slice(2));
const MODE = args.has('--write') ? 'write' : args.has('--check') ? 'check' : args.has('--json') ? 'json' : 'report';

/* ── Source scan ──────────────────────────────────────────────────────────── */

/** Files the kit itself owns — its own markup is not "unmanaged". */
const KIT_PREFIXES = ['src/ui/'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map(f => ({
  path: path.relative(ROOT, f).split(path.sep).join('/'),
  text: fs.readFileSync(f, 'utf8'),
}));

const appFiles = files.filter(f => !KIT_PREFIXES.some(p => f.path.startsWith(p)));

function countOccurrences(text, needle) {
  let n = 0, i = 0;
  for (;;) {
    const at = text.indexOf(needle, i);
    if (at === -1) return n;
    n++; i = at + needle.length;
  }
}

/* ── Registry (read as source; this script must not need a bundler) ───────── */

/**
 * The registry is TSX, so it is read textually rather than imported. Only three
 * fields are needed — id, status and migration targets — and those are
 * unambiguous enough to extract without a parser.
 */
/**
 * Every registry file that declares BUILT components, in one place.
 *
 * This list used to be duplicated — once for the catalogue scan and once for the
 * broken-path check — and forgetting a new `*.defs.tsx` in either silently
 * under-counted the catalogue AND dropped its migration targets, which reads as
 * progress that did not happen. It cost real time twice (forms.defs, data.defs),
 * so there is now exactly one list.
 */
const BUILT_REGISTRY_FILES = [
  'src/ui/registry/definitions.tsx',
  'src/ui/registry/actions.defs.tsx',
  'src/ui/registry/forms.defs.tsx',
  'src/ui/registry/data.defs.tsx',
  'src/ui/registry/containers.defs.tsx',
  'src/ui/registry/navigation.defs.tsx',
  'src/ui/registry/wizard.def.tsx',
];

function readRegistry() {
  const regFiles = [...BUILT_REGISTRY_FILES, 'src/ui/registry/planned.ts']
    .map(p => path.join(ROOT, p)).filter(fs.existsSync);

  const components = [];
  for (const file of regFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const isPlanned = file.endsWith('planned.ts');

    // A component definition is `id:` + `name:` + `category:` in close proximity.
    // `category:` is the discriminator that matters — demo data and menu items
    // also carry id/name pairs, and without it DEMO_PEOPLE counted as five
    // canonical components.
    // The three fields must be ADJACENT and in this order. Proximity alone was
    // not enough: a menu item's `id` picked up the *next* definition's name and
    // category, and DEMO_PEOPLE counted as five canonical components.
    // Every definition in the registry is written id → name → category, so the
    // adjacency requirement is exact rather than heuristic.
    const defRe = /\bid:\s*'([a-z0-9-]+)',\s*\n?\s*name:\s*'([^']+)',\s*\n?\s*category:\s*'([a-z]+)'/g;
    let m;
    while ((m = defRe.exec(text))) {
      const [, id, name] = m;
      const after = text.slice(m.index, m.index + 400);
      const statusMatch = /\bstatus:\s*'([a-z]+)'/.exec(after);
      const status = isPlanned ? 'missing' : (statusMatch ? statusMatch[1] : 'stable');
      if (components.some(c => c.id === id)) continue;
      components.push({ id, name, status, file: path.relative(ROOT, file) });
    }

    // Migration targets, collected per file rather than per component: the
    // report aggregates them, and attributing a class to one component is not
    // worth a parser.
    const grab = (key) => {
      const out = [];
      const re = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, 'g');
      let mm;
      while ((mm = re.exec(text))) {
        for (const lit of mm[1].matchAll(/'([^']+)'/g)) out.push(lit[1]);
      }
      return out;
    };
    components.replaces = (components.replaces ?? []).concat(grab('replaces'));
    components.deprecated = (components.deprecated ?? []).concat(grab('deprecatedImports'));
    components.raw = (components.raw ?? []).concat(grab('rawPatterns'));
  }
  return components;
}

const registry = readRegistry();
const uniq = a => [...new Set(a)];
const replacesClasses = uniq(registry.replaces ?? []).filter(s => s.startsWith('.'));
const deprecatedImports = uniq(registry.deprecated ?? []);
const rawPatterns = uniq(registry.raw ?? []);

/* ── Metrics ──────────────────────────────────────────────────────────────── */

const byStatus = s => registry.filter(c => c.status === s).length;

/** Registered components whose `componentPath` does not exist — a broken entry. */
const brokenPaths = [];
for (const file of BUILT_REGISTRY_FILES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  for (const m of text.matchAll(/componentPath:\s*'([^']+)'/g)) {
    if (!fs.existsSync(path.join(ROOT, m[1]))) brokenPaths.push(m[1]);
  }
}

/** Raw markup the kit has a canonical answer for. */
const rawCounts = {};
for (const pattern of rawPatterns) {
  rawCounts[pattern] = appFiles.reduce((n, f) => n + countOccurrences(f.text, pattern), 0);
}
const unmanagedRaw = Object.values(rawCounts).reduce((a, b) => a + b, 0);

/** Legacy class families the kit supersedes, still referenced in app code. */
const legacyClassCounts = {};
for (const cls of replacesClasses) {
  const bare = cls.slice(1);
  const n = appFiles.reduce((acc, f) => {
    let c = 0;
    for (const m of f.text.matchAll(/class=["'`]([^"'`]*)["'`]/g)) {
      if (m[1].split(/\s+/).includes(bare)) c++;
    }
    return acc + c;
  }, 0);
  if (n > 0) legacyClassCounts[cls] = n;
}
const legacyClassUsages = Object.values(legacyClassCounts).reduce((a, b) => a + b, 0);

/** Imports of superseded symbols/paths. */
const deprecatedCounts = {};
for (const sym of deprecatedImports) {
  const n = appFiles.filter(f =>
    new RegExp(`(from\\s+['"][^'"]*${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"])|(\\b${sym.replace(/[^A-Za-z0-9_]/g, '')}\\b\\s*[,}].*from\\s+'@ui')`).test(f.text),
  ).length;
  if (n > 0) deprecatedCounts[sym] = n;
}
const deprecatedUsages = Object.values(deprecatedCounts).reduce((a, b) => a + b, 0);

/** Module-local reimplementations of things the kit owns. */
const LOCAL_PRIMITIVE_RE =
  /^\s*(?:export\s+)?(?:function|const)\s+(Button|IconButton|Modal|Dialog|Drawer|Pagination|Toast|Badge|StatusPill|Pill|Chip|Tabs|Stepper|Wizard|EmptyState|Skeleton|Spinner|Select|TextInput|SearchInput|Checkbox|Switch|Tooltip|Popover|Menu|DataTable|Avatar|FormField|Field)\b/gm;
const localPrimitives = [];
for (const f of appFiles) {
  for (const m of f.text.matchAll(LOCAL_PRIMITIVE_RE)) {
    localPrimitives.push({ file: f.path, symbol: m[1] });
  }
}

/** Kit adoption: files importing a canonical component from the barrel. */
const KIT_SYMBOLS = ['Button', 'IconButton', 'TextInput', 'Select', 'Combobox', 'PersonSearchSelect', 'Dialog', 'SegmentedControl', 'DropdownButton', 'SplitButton', 'ToggleButton', 'LinkButton', 'ButtonGroup', 'FormField'];
const adoptingFiles = appFiles.filter(f =>
  /from\s+'@ui'/.test(f.text) && KIT_SYMBOLS.some(sym => new RegExp(`\\b${sym}\\b`).test(f.text)),
).length;
const uiFiles = appFiles.filter(f => f.path.endsWith('.tsx')).length;

const metrics = {
  canonicalComponents: byStatus('stable') + byStatus('beta'),
  missingComponents:   byStatus('missing'),
  deprecatedComponents: byStatus('deprecated'),
  totalRegistered:     registry.length,
  brokenComponentPaths: brokenPaths.length,
  legacyClassUsages,
  deprecatedImportFiles: deprecatedUsages,
  localPrimitives: localPrimitives.length,
  unmanagedRaw,
  rawByPattern: rawCounts,
};

const completeness = metrics.totalRegistered === 0 ? 0
  : metrics.canonicalComponents / metrics.totalRegistered;
const adoption = uiFiles === 0 ? 0 : adoptingFiles / uiFiles;

/* ── Baseline ratchet ─────────────────────────────────────────────────────── */

/** Counts that must never increase. Component COUNTS are excluded — building a
 *  component legitimately raises `canonicalComponents`. */
const RATCHETED = ['legacyClassUsages', 'deprecatedImportFiles', 'localPrimitives', 'unmanagedRaw', 'brokenComponentPaths'];

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline() {
  const payload = {
    _comment: 'UI Kit adoption ratchet. These counts may go DOWN, never UP. Regenerate with: node scripts/check-ui-kit-coverage.mjs --write',
    ratcheted: Object.fromEntries(RATCHETED.map(k => [k, metrics[k]])),
    informational: {
      canonicalComponents: metrics.canonicalComponents,
      missingComponents: metrics.missingComponents,
      totalRegistered: metrics.totalRegistered,
    },
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

/* ── Output ───────────────────────────────────────────────────────────────── */

const pct = n => `${Math.round(n * 100)}%`;
const pad = (s, n) => String(s).padEnd(n);

function report() {
  console.log('\nUI Kit Coverage\n');
  console.log(`  ${pad('Canonical components', 26)} ${metrics.canonicalComponents}`);
  console.log(`  ${pad('Missing components', 26)} ${metrics.missingComponents}`);
  console.log(`  ${pad('Deprecated components', 26)} ${metrics.deprecatedComponents}`);
  console.log(`  ${pad('Registered total', 26)} ${metrics.totalRegistered}`);
  console.log('');
  console.log(`  ${pad('Legacy class usages', 26)} ${metrics.legacyClassUsages}`);
  console.log(`  ${pad('Deprecated import files', 26)} ${metrics.deprecatedImportFiles}`);
  console.log(`  ${pad('Module-local primitives', 26)} ${metrics.localPrimitives}`);
  console.log(`  ${pad('Unmanaged raw patterns', 26)} ${metrics.unmanagedRaw}`);
  console.log('');
  console.log(`  Catalogue completeness      ${pct(completeness)}`);
  console.log(`  App adoption                ${pct(adoption)}  (${adoptingFiles}/${uiFiles} .tsx files)`);

  if (Object.keys(rawCounts).length) {
    console.log('\n  Unmanaged raw markup');
    for (const [k, v] of Object.entries(rawCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${pad(k, 22)} ${v}`);
    }
  }
  const topLegacy = Object.entries(legacyClassCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topLegacy.length) {
    console.log('\n  Legacy classes still in use');
    for (const [k, v] of topLegacy) console.log(`    ${pad(k, 22)} ${v}`);
  }
  if (localPrimitives.length) {
    console.log('\n  Module-local reimplementations');
    for (const p of localPrimitives.slice(0, 12)) console.log(`    ${pad(p.symbol, 16)} ${p.file}`);
    if (localPrimitives.length > 12) console.log(`    … and ${localPrimitives.length - 12} more`);
  }
  if (brokenPaths.length) {
    console.log('\n  ✗ Registry entries pointing at files that do not exist');
    for (const p of brokenPaths) console.log(`    ${p}`);
  }
  console.log('');
}

if (MODE === 'json') {
  console.log(JSON.stringify({ metrics, completeness, adoption, components: registry.map(({ id, name, status }) => ({ id, name, status })) }, null, 2));
  process.exit(0);
}

if (MODE === 'write') {
  const written = writeBaseline();
  report();
  console.log(`  Baseline written to scripts/ui-kit-baseline.json`);
  console.log(`  ${JSON.stringify(written.ratcheted)}\n`);
  process.exit(0);
}

report();

if (MODE === 'check') {
  const baseline = loadBaseline();
  if (!baseline) {
    console.error('  ✗ No baseline. Run: node scripts/check-ui-kit-coverage.mjs --write\n');
    process.exit(1);
  }
  const regressions = RATCHETED
    .map(k => ({ k, was: baseline.ratcheted[k] ?? 0, now: metrics[k] }))
    .filter(r => r.now > r.was);

  if (regressions.length) {
    console.error('  ✗ UI Kit ratchet: these counts went UP.\n');
    for (const r of regressions) console.error(`    ${pad(r.k, 26)} ${r.was} → ${r.now}`);
    console.error('\n  Use the canonical component from @ui. If the increase is genuinely');
    console.error('  intended, raise the baseline deliberately:');
    console.error('    node scripts/check-ui-kit-coverage.mjs --write\n');
    process.exit(1);
  }

  const improvements = RATCHETED
    .map(k => ({ k, was: baseline.ratcheted[k] ?? 0, now: metrics[k] }))
    .filter(r => r.now < r.was);
  if (improvements.length) {
    console.log('  ✓ Ratchet improved — lower the baseline with --write:');
    for (const r of improvements) console.log(`    ${pad(r.k, 26)} ${r.was} → ${r.now}`);
    console.log('');
  } else {
    console.log('  ✓ UI Kit ratchet holding.\n');
  }
}
