/**
 * scripts/e2e/coverage-gate.mjs — static E2E route-coverage gate.
 *
 * Reads every mounted POST route from the deterministic codebase index and every
 * `api('<path>', …)` call in scripts/e2e/suites,
 * then fails when a route is neither exercised by a suite nor listed in
 * coverage-waivers.json. The waiver file is the EXPLICIT debt list — the gate's
 * job is to stop NEW endpoints shipping without E2E coverage, per the Testing
 * Standard ("a module is not done until its suite covers every endpoint").
 *
 * USAGE:
 *   node scripts/e2e/coverage-gate.mjs            # gate (exit 1 on new gaps)
 *   node scripts/e2e/coverage-gate.mjs --report   # full covered/waived/gap listing
 *   node scripts/e2e/coverage-gate.mjs --write-waivers   # regenerate waivers from current gaps
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const suitesDir = join(here, 'suites');
const waiversPath = join(here, 'coverage-waivers.json');
const routeIndexPath = join(repoRoot, 'docs', 'generated', 'ROUTE_INDEX.tsv');

// ── 1. Mounted routes ────────────────────────────────────────────────────────
// The index resolves default/named router exports, constant template paths, and
// finite registration loops. Refuse to reason from it when source has drifted.
try {
  execFileSync(process.execPath, [join(repoRoot, 'scripts', 'generate-codebase-index.mjs'), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
catch (error) {
  process.stderr.write(error.stdout ?? '');
  process.stderr.write(error.stderr ?? '');
  console.error('\nThe E2E coverage gate requires a current codebase index. Run: npm run repo:index');
  process.exit(1);
}

if (!existsSync(routeIndexPath)) {
  console.error(`Route index missing: ${routeIndexPath}\nRun: npm run repo:index`);
  process.exit(1);
}

const [routeHeader, ...routeRows] = readFileSync(routeIndexPath, 'utf8').trim().split(/\r?\n/).map(line => line.split('\t'));
const routePathIndex = routeHeader.indexOf('path');
const routeFileIndex = routeHeader.indexOf('file');
if (routePathIndex < 0 || routeFileIndex < 0) throw new Error('ROUTE_INDEX.tsv is missing path/file columns');
const routes = routeRows
  .map(row => ({ path: row[routePathIndex], file: row[routeFileIndex] }))
  .filter(route => !route.path.startsWith('UNMOUNTED:'));
const unresolvedRoutes = routes.filter(route => route.path.includes('${...}'));
if (unresolvedRoutes.length) {
  console.error('Mounted route definitions could not be resolved statically:');
  for (const route of unresolvedRoutes) console.error(`  ${route.path}  (${route.file})`);
  process.exit(1);
}

// ── 2. Suite calls: api('<path>', …) — paths are relative to /api/ ─────────────
const called = new Set();
for (const f of readdirSync(suitesDir).filter(f => f.endsWith('.mjs'))) {
  const src = readFileSync(join(suitesDir, f), 'utf8');
  for (const m of src.matchAll(/api\(\s*[`']([^`'$]+)[`']/g)) called.add(`/api/${m[1]}`.replace(/\/{2,}/g, '/'));
  // template-literal paths with interpolation cover their static prefix — treat
  // the prefix as covering any route that starts with it.
  for (const m of src.matchAll(/api\(\s*`([^`]*)\$\{/g)) called.add(`PREFIX:/api/${m[1]}`.replace(/\/{2,}/g, '/'));
}
const prefixCalls = [...called].filter(c => c.startsWith('PREFIX:')).map(c => c.slice(7));

const isCovered = (path) =>
  called.has(path) || prefixCalls.some(p => p.length > 5 && path.startsWith(p));

// ── 4. Waivers — two kinds of accepted debt ─────────────────────────────────────
//   waived   : flat list — routes backing BUILT/shipped pages that simply lack a
//              suite yet. REAL debt: write suites and delete the entries.
//   deferred : { <group>: { reason, routes[] } } — routes whose FEATURE/PAGE is
//              not built out yet. Do NOT chase these now; per the Testing Standard
//              a module gets its suite WHEN it's built. Kept so the intent to cover
//              them at build time is never lost. Preserved across --write-waivers.
const wf = existsSync(waiversPath) ? JSON.parse(readFileSync(waiversPath, 'utf8')) : {};
const flatWaived   = new Set(wf.waived ?? []);
const deferred     = wf.deferred ?? {};
const deferredSet  = new Set(Object.values(deferred).flatMap(g => g.routes ?? []));
const isWaived     = (p) => flatWaived.has(p) || deferredSet.has(p);

const uniq = [...new Map(routes.map(r => [r.path, r])).values()].sort((a, b) => a.path.localeCompare(b.path));
const covered      = uniq.filter(r => isCovered(r.path));
const gaps         = uniq.filter(r => !isCovered(r.path));
const newGaps      = gaps.filter(r => !isWaived(r.path));
const realDebt     = gaps.filter(r => flatWaived.has(r.path) && !deferredSet.has(r.path));
const deferredGaps = gaps.filter(r => deferredSet.has(r.path));
const staleWaivers = [...flatWaived, ...deferredSet].filter(w => !gaps.some(g => g.path === w));

const mode = process.argv[2];
if (mode === '--write-waivers') {
  // Preserve the deferred (feature-not-built) groups verbatim; recompute `waived`
  // as the remaining gaps NOT already parked under a deferred group.
  writeFileSync(waiversPath, JSON.stringify({
    _comment: 'waived = routes backing BUILT pages that lack an E2E suite (real debt — write suites, remove entries). deferred = routes whose feature/page is not built out yet; cover them WHEN the module is built (see each group\'s reason). The gate fails on any route that is neither covered, waived, nor deferred.',
    generatedAt: new Date().toISOString(),
    deferred,
    waived: gaps.map(g => g.path).filter(p => !deferredSet.has(p)),
  }, null, 2) + '\n');
  console.log(`Wrote ${gaps.length - deferredGaps.length} waived + ${deferredGaps.length} deferred to ${waiversPath}`);
  process.exit(0);
}

console.log(`Routes mounted: ${uniq.length} · covered: ${covered.length} · real debt (built, untested): ${realDebt.length} · deferred (feature not built): ${deferredGaps.length} · NEW gaps: ${newGaps.length}`);
if (mode === '--report') {
  console.log('\n── NEW gaps ──');            for (const g of newGaps)      console.log(`  ${g.path}  (${g.file})`);
  console.log('\n── Real debt (built, untested) ──'); for (const g of realDebt) console.log(`  ${g.path}  (${g.file})`);
  console.log('\n── Deferred (feature not built) ──');
  for (const [group, { reason, routes: rs }] of Object.entries(deferred)) {
    console.log(`  [${group}] ${reason}`);
    for (const p of rs) console.log(`      ${p}`);
  }
  if (staleWaivers.length) { console.log('\n── Stale waivers (now covered — remove them) ──'); for (const w of staleWaivers) console.log(`  ${w}`); }
}
if (newGaps.length) {
  console.error(`\n✖ ${newGaps.length} route(s) have no E2E coverage and no waiver:`);
  for (const g of newGaps) console.error(`  ${g.path}  (${g.file})`);
  console.error('\nAdd suite coverage (preferred), or park it in coverage-waivers.json — under `deferred` if its page is not built yet, else `waived`.');
  process.exit(1);
}
console.log('✓ No unwaived coverage gaps.');
