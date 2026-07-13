/**
 * scripts/e2e/run.mjs — E2E suite runner.
 *
 * Runs one shared Harness across every suite in ./suites/, so identities and the
 * cleanup tag are shared and the final report is aggregated into a single
 * pass/fail summary with one process exit code.
 *
 * USAGE (with `netlify dev` running on :8888):
 *     node scripts/e2e/run.mjs                  # all suites
 *     node scripts/e2e/run.mjs communications   # only named suite(s)
 *     node scripts/e2e/run.mjs comms incidents  # several
 *     npm run test:e2e                          # all
 *     npm run test:e2e -- communications        # named
 *
 * Env:  BASE_URL (default http://localhost:8888) · KEEP_DATA=1 (skip cleanup)
 */

import { readdirSync } from 'node:fs';
import { Harness } from './harness.mjs';
import { sweepOrphans } from './sweep-orphans.mjs';

const only = process.argv.slice(2).map(s => s.toLowerCase());
const SWEEP = !process.env.KEEP_DATA;   // KEEP_DATA disables every sweep (debug runs)
const sweep = () => sweepOrphans(h.sb, { apply: true, log: (s) => console.log(`[sweep] ${s}`) });

const h = new Harness();
await h.ping();

// Clear any test data leaked by a previously-killed run BEFORE we borrow users —
// otherwise pickUsers() could hand a stale synthetic account to a suite, and the
// leaks would keep piling up (this is what put 34 dead users on the AC Users page).
if (SWEEP) {
  try { await sweep(); }
  catch (e) { console.warn(`[sweep] pre-run sweep skipped: ${e.message}`); }
}

// Ctrl-C / kill: run the LIFO cleanup + a full sweep so an aborted run leaves
// nothing behind (SIGKILL can't be caught — the pre-run sweep covers that case).
let _aborting = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (_aborting) return; _aborting = true;
    console.log(`\n${sig} received — cleaning up E2E test data…`);
    try { await h.runCleanup(); } catch { /* best-effort */ }
    if (SWEEP) { try { await sweep(); } catch { /* best-effort */ } }
    process.exit(130);
  });
}

await h.pickUsers();
console.log(`Server:  ${h.base}`);
console.log(`Users:   admin=${h.users.admin.username}  B=${h.users.b.username}  C=${h.users.c.username}`);
console.log(`Run tag: ${h.TAG}`);

// Discover suites (each file in ./suites/ exporting { title, default run(h) }).
const dir = new URL('./suites/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.mjs')).sort();

const selected = files.filter(f => {
  if (!only.length) return true;
  const base = f.replace('.mjs', '').toLowerCase();
  return only.some(o => base.includes(o));
});

if (!selected.length) {
  console.error(`\nNo suites matched ${JSON.stringify(only)}. Available: ${files.map(f => f.replace('.mjs', '')).join(', ')}`);
  process.exit(2);
}

for (const f of selected) {
  const mod = await import(new URL(`./suites/${f}`, import.meta.url));
  const title = mod.title || f.replace('.mjs', '');

  // Server-health gate: once the dev server dies (e.g. Netlify OOM), every
  // remaining suite would fail with meaningless `network: fetch failed` noise —
  // abort with a clear reason instead, and still run cleanup for what DID run.
  if (!(await h.isServerUp())) {
    const remaining = selected.length - selected.indexOf(f);
    console.error(`\n✖ Dev server at ${h.base} is DOWN — aborting before "${title}". ` +
      `${remaining} suite(s) not run. Restart npm run dev:netlify and re-run.`);
    h.results.push({ group: title, name: '(aborted — dev server down)', ok: false, detail: 'server unreachable before suite start' });
    break;
  }

  const t0 = Date.now();
  console.log(`\n── ${title} ─────────────────────────────`);
  h.section(title);
  try { await mod.default(h); }
  catch (e) { console.error(`\nSuite "${title}" crashed:`, e.stack || e.message); h.results.push({ group: title, name: '(suite crashed)', ok: false, detail: e.message }); }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const mem  = Math.round(process.memoryUsage().rss / 1048576);
  console.log(`\n   [${title}] ${secs}s · runner rss ${mem}MB`);
}

await h.runCleanup();
// Belt-and-suspenders: purge anything the per-suite closures missed (e.g. a suite
// that crashed before it could register its cleanup).
if (SWEEP) {
  try { await sweep(); }
  catch (e) { console.warn(`[sweep] post-run sweep skipped: ${e.message}`); }
}
const fail = h.report();
process.exit(fail > 0 ? 1 : 0);
