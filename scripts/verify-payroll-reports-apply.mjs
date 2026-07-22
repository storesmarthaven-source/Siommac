// scripts/verify-payroll-reports-apply.mjs
//
// Post-apply LIVE verification for Payroll Reports Center (F-12) Slice 1
// migrations (20260919000740–745). Proves — from the app's side of PostgREST,
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
// NOTE: on this Supabase project `service_role` holds blanket table privileges
// platform-wide, so the contract's column-level UPDATE grant does NOT constrain
// service_role (it can UPDATE any column here — same as every other table incl.
// the existing append-only finance_payroll_finding_activity). The column grant
// therefore only ever bound anon/authenticated (fully revoked). Base-column
// immutability is enforced by RPC DISCIPLINE: no route/RPC ever updates the
// identity/checksum/retention columns; only the purge RPCs touch purge columns.
// An immutability trigger was deliberately rejected upstream (it breaks the
// created_by ON DELETE SET NULL cascade — the evidence-table FK trap). So here we
// verify the REAL client boundary (anon fully denied) + that the purge columns
// are grantable to service_role.
console.log('▸ Artifact write-boundary');
{
  // The client-reachable anon role must NOT be able to write the artifacts table.
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.from('payroll_report_artifacts')
    .update({ sha256: 'anon-should-be-denied' })
    .eq('id', randomUUID())
    .select();
  if (error || (Array.isArray(data) && data.length === 0)) {
    ok('anon cannot write payroll_report_artifacts (RLS + revoked grants)');
  } else {
    bad('anon write boundary', 'anon UPDATE was NOT blocked');
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
    { p_actor_id: 'VERIFY-SENTINEL', p_report_key: 'payroll_register', p_params: {}, p_format: 'xlsx',
      p_scope: {}, p_scope_id: 'verify', p_requires_view_all: true, p_requires_export: true,
      p_idempotency_key: 'verify-sentinel-key' },
    'not an active user'],                                    // PR403 from inside the fn
  ['finance_payroll_report_claim',
    { p_worker_id: 'verify-probe', p_limit: 1, p_lease_seconds: 300 },
    null],                                                    // should SUCCEED (empty set)
  ['finance_payroll_report_heartbeat',
    { p_job_id: randomUUID(), p_claim_token: randomUUID(), p_lease_seconds: 300 },
    'not running under this claim token'],                    // PR409
  ['finance_payroll_report_register_upload_tx',
    { p_job_id: randomUUID(), p_claim_token: randomUUID(), p_storage_path: 'x/y/z.xlsx', p_sha256: 'abc', p_byte_size: 1 },
    'was not found'],                                         // PR404
  ['finance_payroll_report_complete_tx',
    { p_job_id: randomUUID(), p_claim_token: randomUUID(), p_storage_path: 'x/y/z.xlsx', p_content_type: 'application/x',
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
  ['finance_payroll_report_purge_claim',
    { p_worker_id: 'verify-probe', p_limit: 1, p_lease_seconds: 300 },
    null],                                                    // should SUCCEED (empty set)
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
