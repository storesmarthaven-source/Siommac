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
  console.log(`\n── ${title} ─────────────────────────────`);
  h.section(title);
  try { await mod.default(h); }
  catch (e) { console.error(`\nSuite "${title}" crashed:`, e.stack || e.message); h.results.push({ group: title, name: '(suite crashed)', ok: false, detail: e.message }); }
}

await h.runCleanup();
const fail = h.report();
process.exit(fail > 0 ? 1 : 0);
