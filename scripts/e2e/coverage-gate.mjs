/**
 * scripts/e2e/coverage-gate.mjs — static E2E route-coverage gate.
 *
 * Parses every mounted POST route (api.ts mount prefixes × routes/*.ts
 * router.post paths) and every `api('<path>', …)` call in scripts/e2e/suites,
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

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fnRoot = join(here, '..', '..', 'netlify', 'functions');
const suitesDir = join(here, 'suites');
const waiversPath = join(here, 'coverage-waivers.json');

// ── 1. Mount prefixes: app.route('/api/xxx', someRouter) → routerVar → prefix ──
const apiSrc = readFileSync(join(fnRoot, 'api.ts'), 'utf8');
const mounts = new Map(); // routerVar -> [prefixes]
for (const m of apiSrc.matchAll(/app\.route\('([^']+)',\s*(\w+)\)/g)) {
  const [, prefix, routerVar] = m;
  (mounts.get(routerVar) ?? mounts.set(routerVar, []).get(routerVar)).push(prefix);
}
// routerVar -> file: import xxxRouter from './routes/yyy'
const importOf = new Map();
for (const m of apiSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([\w.-]+)'/g)) {
  importOf.set(m[1], m[2]);
}

// ── 2. Routes per file: router.post('/path', …) ────────────────────────────────
const routes = []; // { path: '/api/finance/disbursements/list', file }
for (const [routerVar, prefixes] of mounts) {
  const file = importOf.get(routerVar);
  if (!file) continue;
  const p = join(fnRoot, 'routes', `${file}.ts`);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  for (const m of src.matchAll(/router\.post\(\s*'([^']+)'/g)) {
    for (const prefix of prefixes) {
      routes.push({ path: `${prefix}${m[1]}`.replace(/\/{2,}/g, '/'), file: `routes/${file}.ts` });
    }
  }
}

// ── 3. Suite calls: api('<path>', …) — paths are relative to /api/ ─────────────
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

// ── 4. Waivers (explicit accepted debt) ─────────────────────────────────────────
const waivers = new Set(existsSync(waiversPath) ? JSON.parse(readFileSync(waiversPath, 'utf8')).waived : []);

const uniq = [...new Map(routes.map(r => [r.path, r])).values()].sort((a, b) => a.path.localeCompare(b.path));
const covered = uniq.filter(r => isCovered(r.path));
const gaps    = uniq.filter(r => !isCovered(r.path));
const newGaps = gaps.filter(r => !waivers.has(r.path));
const waived  = gaps.filter(r => waivers.has(r.path));
const staleWaivers = [...waivers].filter(w => !gaps.some(g => g.path === w));

const mode = process.argv[2];
if (mode === '--write-waivers') {
  writeFileSync(waiversPath, JSON.stringify({
    _comment: 'Routes with NO E2E coverage yet — explicit accepted debt. Remove entries as suites gain coverage; the gate fails on any UNWAIVED gap.',
    generatedAt: new Date().toISOString(),
    waived: gaps.map(g => g.path),
  }, null, 2) + '\n');
  console.log(`Wrote ${gaps.length} waivers to ${waiversPath}`);
  process.exit(0);
}

console.log(`Routes mounted: ${uniq.length} · covered: ${covered.length} · waived (accepted debt): ${waived.length} · NEW gaps: ${newGaps.length}`);
if (mode === '--report') {
  console.log('\n── NEW gaps ──');   for (const g of newGaps) console.log(`  ${g.path}  (${g.file})`);
  console.log('\n── Waived ──');     for (const g of waived)  console.log(`  ${g.path}  (${g.file})`);
  if (staleWaivers.length) { console.log('\n── Stale waivers (now covered — remove them) ──'); for (const w of staleWaivers) console.log(`  ${w}`); }
}
if (newGaps.length) {
  console.error(`\n✖ ${newGaps.length} route(s) have no E2E coverage and no waiver:`);
  for (const g of newGaps) console.error(`  ${g.path}  (${g.file})`);
  console.error('\nAdd suite coverage (preferred) or, for consciously deferred debt, add the path to scripts/e2e/coverage-waivers.json.');
  process.exit(1);
}
console.log('✓ No unwaived coverage gaps.');
