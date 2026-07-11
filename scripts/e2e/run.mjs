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

const only = process.argv.slice(2).map(s => s.toLowerCase());

const h = new Harness();
await h.ping();
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
const fail = h.report();
process.exit(fail > 0 ? 1 : 0);
