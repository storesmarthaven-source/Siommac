// scripts/verify-payroll-reports-apply.mjs
//
// Post-apply LIVE verification for Payroll Reports Center (F-12) migrations
// (20260919000740–746, incl. the Slice-4 hardening: reconcile_claim/reap RPCs +
// append-only artifact trigger). Proves — from the app's side of PostgREST,
// per the assume-don't-verify rule — that every table/column/grant/RPC/bucket is
// actually LIVE, not that the SQL editor said "Success":
//   1. the three tables are selectable + key columns (incl. purge saga) exist;
//   2. jobs.artifact_id (the deferred FK column) is live;
//   3. the artifact write-boundary: the client-reachable anon role is fully
//      denied writes, and service_role may update a purge-saga column. (On this
//      Supabase project service_role holds blanket table privileges, so base-
//      column immutability is enforced by RPC discipline, not the column grant —
//      see the inline note; same as the existing finance_payroll_finding_activity.)
//   4. every RPC EXISTS and EXECUTES: sentinel inputs raise the controlled PRxxx
//      error from INSIDE the function (a missing fn fails PostgREST-side PGRST202
//      "Could not find the function" — unmistakably different), with no side
//      effects (probes hit validation guards before any INSERT);
//   5. the payroll-report-artifacts bucket exists and is PRIVATE.
//
// Run (from the main checkout, which has node_modules + .env):
//   node scripts/verify-payroll-reports-apply.mjs
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
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok  = (name)      => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, why) => { fail++; console.log(`  ✗ ${name}\n      → ${why}`); };

// ── 1. Tables + key columns ──────────────────────────────────────────────────
console.log('▸ Tables + columns');
{
  const { error } = await sb.from('payroll_report_jobs')
    .select('id, report_key, format, requires_view_all, requires_export, state, attempts, max_attempts, claim_token, lease_expires_at, artifact_id')
    .limit(1);
  error ? bad('payroll_report_jobs (+ artifact_id, requires_*)', error.message)
        : ok('payroll_report_jobs selectable incl. artifact_id + requires_* + claim_token');
}
{
  const { error } = await sb.from('payroll_report_upload_attempts')
    .select('id, job_id, claim_token, storage_path, sha256, byte_size, committed_at, cleanup_attempts')
    .limit(1);
  error ? bad('payroll_report_upload_attempts', error.message)
        : ok('payroll_report_upload_attempts selectable incl. committed_at + cleanup_attempts');
}
{
  const { error } = await sb.from('payroll_report_artifacts')
    .select('id, job_id, storage_path, sha256, requires_view_all, requires_export, format, retention_expires_at, purge_state, purged_at, purge_token, purge_lease_expires_at, purge_attempts, purge_error')
    .limit(1);
  error ? bad('payroll_report_artifacts (+ purge saga columns)', error.message)
        : ok('payroll_report_artifacts selectable incl. all purge-saga columns');
}

// ── 2. Artifact write-boundary ───────────────────────────────────────────────
// NOTE: on this Supabase project `service_role` holds blanket table privileges, so
// the column-level UPDATE grant never constrained service_role. Migration 746 now
// adds an append-only TRIGGER that enforces evidence-column immutability at the DB
// (only purge columns + retention_expires_at may change, and created_by may only be
// CLEARED — the ON DELETE SET NULL cascade — never reassigned), closing the gap that
// RPC discipline alone left open. Here we verify the REAL client boundary (anon fully
// denied) + that a purge-saga column update is still permitted to service_role.
console.log('▸ Artifact write-boundary');
{
  // The client-reachable anon role must NOT be able to write the artifacts table.
  // Probe with an INSERT (not an UPDATE by random id — a 0-row UPDATE is
  // indistinguishable from a denied one). A denied INSERT returns a real error
  // (42501 permission denied / RLS violation), which unambiguously proves denial.
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.from('payroll_report_artifacts')
    .insert({ job_id: randomUUID(), storage_path: `anon/${randomUUID()}.csv`, content_type: 'text/csv',
              byte_size: 1, sha256: 'x', scope: {}, scope_id: 'v', retention_class: 'standard',
              retention_expires_at: new Date().toISOString(), requires_view_all: false,
              requires_export: true, format: 'csv' })
    .select();
  if (error) {
    ok(`anon cannot write payroll_report_artifacts (denied: ${error.code || error.message.slice(0, 40)})`);
  } else {
    // No error → the write landed. Clean it up and FAIL the boundary check.
    if (Array.isArray(data)) for (const r of data) await sb.from('payroll_report_artifacts').delete().eq('id', r.id);
    bad('anon write boundary', 'anon INSERT was NOT blocked (row was written)');
  }
}
{
  // service_role may update the purge-saga columns (0 rows, no error).
  const { error } = await sb.from('payroll_report_artifacts')
    .update({ purge_error: { code: 'verify', message: 'probe' } })
    .eq('id', randomUUID());
  error ? bad('UPDATE of purge column (purge_error)', `expected allowed (0 rows), got: ${error.message}`)
        : ok('service_role UPDATE of purge-saga column (purge_error) is permitted');
}

// ── 3. RPCs — each must EXIST and raise its controlled PRxxx (no side effects) ─
console.log('▸ RPCs (exist + execute; sentinel inputs)');
const rpcProbes = [
  ['finance_payroll_report_enqueue_tx',
    { p_actor_id: 'VERIFY-SENTINEL', p_report_key: 'payroll_register', p_params: {}, p_format: 'csv',
      p_scope: {}, p_scope_id: 'verify', p_requires_view_all: true, p_requires_export: true,
      p_idempotency_key: 'verify-sentinel-key' },
    'not an active user'],                                    // PR403 from inside the fn
  // NOTE: claim / purge_claim / reap / reconcile_claim are NOT executed here — they
  // would lease or fail real queue rows. They are existence-checked below via the
  // read-only finance_payroll_report_rpc_exists probe (non-mutating).
  ['finance_payroll_report_heartbeat',
    { p_job_id: randomUUID(), p_claim_token: randomUUID(), p_lease_seconds: 300 },
    'not running under this claim token'],                    // PR409
  ['finance_payroll_report_register_upload_tx',
    { p_job_id: randomUUID(), p_claim_token: randomUUID(), p_storage_path: 'x/y/z.csv', p_sha256: 'abc', p_byte_size: 1 },
    'was not found'],                                         // PR404
  ['finance_payroll_report_complete_tx',
    { p_job_id: randomUUID(), p_claim_token: randomUUID(), p_storage_path: 'x/y/z.csv', p_content_type: 'application/x',
      p_byte_size: 1, p_sha256: 'abc', p_scope: {}, p_scope_id: 'v', p_row_count: 0, p_retention_class: 'standard', p_retention_days: 30 },
    'was not found'],                                         // PR404
  ['finance_payroll_report_fail_tx',
    { p_job_id: randomUUID(), p_claim_token: randomUUID(), p_error_code: 'X', p_error_message: 'y', p_retryable: true },
    'was not found'],                                         // PR404
  ['finance_payroll_report_log_run',
    { p_actor_id: '', p_report_key: 'payroll_register', p_params: {}, p_scope_id: 'v', p_format: 'preview' },
    'actor is required'],                                     // PR400 (no audit insert)
  ['finance_payroll_report_log_download',
    { p_actor_id: '', p_artifact_id: randomUUID() },
    'actor is required'],                                     // PR400 (no audit insert)
  ['finance_payroll_report_purge_fail',
    { p_artifact_id: randomUUID(), p_purge_token: randomUUID(), p_error: { code: 'x', message: 'y' } },
    'was not found'],                                         // PR404
  ['finance_payroll_report_purge_finalize',
    { p_artifact_id: randomUUID(), p_purge_token: randomUUID() },
    'was not found'],                                         // PR404
];
for (const [fn, args, expect] of rpcProbes) {
  const { error } = await sb.rpc(fn, args);
  if (expect === null) {
    error ? bad(`rpc ${fn}`, `expected success, got: ${error.message}`)
          : ok(`rpc ${fn} exists + executes (empty set)`);
  } else if (!error) {
    bad(`rpc ${fn}`, `expected controlled error "${expect}", but call succeeded`);
  } else if (/PGRST202/i.test(error.code || '') || /Could not find the function/i.test(error.message)) {
    bad(`rpc ${fn}`, `function is MISSING (PGRST202): ${error.message}`);
  } else if (error.message.includes(expect)) {
    ok(`rpc ${fn} exists + raises "${expect}"`);
  } else {
    bad(`rpc ${fn}`, `expected "${expect}", got: ${error.message}`);
  }
}

// ── 3b. Claim-family RPCs — existence ONLY (executing them would mutate queues) ─
// Verified via the read-only rpc_exists probe (migration 746).
console.log('▸ Claim-family RPCs (non-mutating existence check)');
const existenceProbes = [
  'public.finance_payroll_report_claim(text, integer, integer)',
  'public.finance_payroll_report_purge_claim(text, integer, integer)',
  'public.finance_payroll_report_reap(text, integer)',
  'public.finance_payroll_report_reconcile_claim(text, integer)',
];
for (const sig of existenceProbes) {
  const { data, error } = await sb.rpc('finance_payroll_report_rpc_exists', { p_qualified_name: sig });
  if (error) bad(`exists ${sig}`, /PGRST202|Could not find/i.test(error.code || error.message) ? 'rpc_exists probe itself is MISSING (apply migration 746)' : error.message);
  else if (data === true) ok(`rpc ${sig.split('(')[0].replace('public.', '')} is live`);
  else bad(`exists ${sig}`, 'function does NOT exist (migration not applied)');
}

// ── 4. Private bucket ────────────────────────────────────────────────────────
console.log('▸ Storage bucket');
{
  const { data, error } = await sb.storage.getBucket('payroll-report-artifacts');
  if (error) bad('payroll-report-artifacts bucket', error.message);
  else if (data?.public === true) bad('payroll-report-artifacts bucket', 'bucket is PUBLIC (must be private)');
  else ok('payroll-report-artifacts bucket exists and is private');
}

console.log(`\n${fail === 0 ? '✅ ALL LIVE' : '❌ INCOMPLETE'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
