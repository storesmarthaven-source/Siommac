// scripts/verify-workflow-tx-apply.mjs
//
// Post-apply verification for the workflow decide-tx migrations (150–180).
// Proves — from the app's side of PostgREST, per the assume-don't-verify rule —
// that every new table/column/function is LIVE, not just that the SQL editor
// said "Success":
//   • new tables + the active_transition_id column are selectable;
//   • each RPC exists AND executes: we call it with sentinel UUIDs and assert
//     the controlled error raised from INSIDE the function body (WF404/WF409
//     message text). A missing function fails PostgREST-side with PGRST202
//     ("Could not find the function") — unmistakably different.
//
// Run:  node scripts/verify-workflow-tx-apply.mjs
// Exit 0 = everything live. Non-zero = something missing/stale (details printed).

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map(l => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map(m => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok  = (name)      => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, why) => { fail++; console.log(`  ✗ ${name}\n      → ${why}`); };

// ── 1. Tables + column (migration 150) ────────────────────────────────────────
console.log('▸ Schema (migration 150)');
for (const t of ['workflow_transitions', 'workflow_outbox', 'workflow_source_receipts']) {
  const { error } = await sb.from(t).select('*').limit(1);
  error ? bad(`table ${t}`, error.message) : ok(`table ${t} selectable`);
}
{
  const { error } = await sb.from('workflow_instances').select('id, active_transition_id').limit(1);
  error ? bad('workflow_instances.active_transition_id', error.message)
        : ok('workflow_instances.active_transition_id column live');
}

// ── 2. RPCs — each must exist AND raise its own controlled error ──────────────
// expect: substring of the in-function error message for sentinel inputs.
const rpcProbes = [
  ['workflow_decide_task_tx',
    { p_workflow_id: randomUUID(), p_task_id: randomUUID(), p_actor_id: 'VERIFY-SENTINEL', p_decision: 'approved' },
    'not found'],                                       // WF404 from inside the fn
  ['workflow_outbox_claim',
    { p_worker_id: 'verify-probe', p_limit: 1 },
    null],                                              // should SUCCEED (empty set)
  ['workflow_finalize_transition_tx',
    { p_transition_id: randomUUID(), p_lease_token: randomUUID(), p_final_status: 'completed' },
    'not found'],                                       // WF404
  ['workflow_outbox_complete',
    { p_transition_id: randomUUID(), p_lease_token: randomUUID() },
    'stale or missing lease'],                          // WF409
  ['workflow_outbox_fail',
    { p_transition_id: randomUUID(), p_lease_token: randomUUID(), p_error: 'probe' },
    'stale or missing lease'],                          // WF409
  ['finance_payroll_workflow_transition_tx',
    { p_transition_id: randomUUID(), p_run_id: randomUUID(), p_actor_id: 'VERIFY-SENTINEL',
      p_target_status: 'approved', p_comment: null, p_input_hash: 'probe' },
    'not found'],                                       // WF404
];

console.log('▸ RPCs (migrations 160/170/180)');
for (const [fn, args, expectErr] of rpcProbes) {
  const { data, error } = await sb.rpc(fn, args);
  if (expectErr === null) {
    error ? bad(`rpc ${fn}`, error.message)
          : ok(`rpc ${fn} executes (returned ${Array.isArray(data) ? data.length + ' rows' : typeof data})`);
    continue;
  }
  if (!error) { bad(`rpc ${fn}`, `expected controlled error "${expectErr}" for sentinel ids, got success: ${JSON.stringify(data)?.slice(0, 120)}`); continue; }
  const missing = /could not find the function|PGRST202/i.test(error.message + (error.code ?? ''));
  if (missing)                                    bad(`rpc ${fn}`, `NOT APPLIED — ${error.message}`);
  else if (error.message.toLowerCase().includes(expectErr)) ok(`rpc ${fn} live (controlled: "${error.message.slice(0, 70)}…")`);
  else                                            bad(`rpc ${fn}`, `unexpected error (applied but misbehaving?): ${error.message}`);
}

// ── 3. Idempotency backstop index (migration 150, workflow_decisions) ─────────
// Can't insert probe rows without real FK parents, so assert via the catalog RPC
// path is unavailable over PostgREST — instead confirm no duplicate task_ids exist
// (the precondition the migration guard enforced).
console.log('▸ Invariants');
{
  const { data, error } = await sb.from('workflow_decisions').select('task_id').not('task_id', 'is', null);
  if (error) bad('workflow_decisions readable', error.message);
  else {
    const counts = new Map();
    for (const r of data) counts.set(r.task_id, (counts.get(r.task_id) ?? 0) + 1);
    const dups = [...counts.values()].filter(n => n > 1).length;
    dups === 0 ? ok('workflow_decisions: no duplicate task_id rows (index precondition holds)')
               : bad('workflow_decisions duplicates', `${dups} task_id(s) have multiple decisions — the unique index cannot be in place`);
  }
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
