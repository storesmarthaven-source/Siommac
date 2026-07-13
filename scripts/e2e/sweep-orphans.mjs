/**
 * scripts/e2e/sweep-orphans.mjs
 *
 * Removes leftover E2E test data from ANY prior run, not just the current process.
 *
 * Why this exists: each suite's own `h.onCleanup()` only knows the row IDs it created
 * IN MEMORY during that run. If a run is interrupted (Ctrl+C, a Bash timeout, a crash),
 * those IDs are lost and nothing else ever revisits them — `h.TAG` is a fresh
 * `TEST-E2E-<timestamp>` per run, so a later run's cleanup never matches an earlier
 * run's rows. Over many interrupted runs this leaves permanent orphan rows (this is
 * what once put 34 dead users on the Access Control → Users page).
 *
 * Every synthetic user any suite creates carries the marker "test-e2e" in its
 * `username` (as the `TEST-E2E-<ts>_suffix` prefix, or embedded lowercase), OR — for a
 * few suites that mint a custom username — an "(E2E …)" `full_name`. Both are anchors:
 * find those app_users, delete everything that references them (tables without an
 * ON DELETE CASCADE FK), sweep non-user-keyed text columns suites also stamp with the
 * TAG, then delete the users themselves (cascading whatever DOES have a cascade FK).
 *
 * `run.mjs` imports `sweepOrphans` and runs it automatically before every run, on
 * Ctrl-C, and after the run — so leaks can no longer accumulate. It is still exported
 * as a standalone CLI for on-demand recovery:
 *
 *   node scripts/e2e/sweep-orphans.mjs            # dry run — reports counts only
 *   node scripts/e2e/sweep-orphans.mjs --apply    # actually deletes
 *   npm run test:e2e:sweep                        # === --apply
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const MARKER = 'test-e2e';   // case-insensitive; the literal every synthetic username carries

/** Load the service-role client from .env (no DATABASE_URL in this environment). */
export function serviceClient() {
  const REQ = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  let txt = '';
  try { txt = readFileSync(new URL('../../.env', import.meta.url), 'utf8'); }
  catch { throw new Error('Could not read .env at project root'); }
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQ.includes(m[1])) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQ) if (!env[k]) throw new Error(`Missing ${k} in .env`);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** Tables that reference a test user but are NOT guaranteed to cascade — clear first.
 *  Includes the full workflow chain (actor/requester FKs are RESTRICT and block the
 *  final app_users delete otherwise). */
const USER_KEYED = [
  ['hr_audit_log', 'actor_id'], ['hr_audit_log', 'employee_id'],
  ['app_events', 'actor_user_id'], ['app_events', 'source_entity_id'],
  ['hr_employee_status_history', 'employee_id'], ['hr_employee_assignments', 'employee_id'],
  ['hr_employee_documents', 'employee_id'], ['hr_employee_change_requests', 'employee_id'],
  ['hr_employee_change_requests', 'requested_by'], ['hr_leave_requests', 'employee_id'],
  ['hr_leave_balances', 'employee_id'], ['hr_leave_accruals', 'employee_id'],
  ['hr_attendance_records', 'employee_id'], ['hr_attendance_corrections', 'employee_id'],
  ['hr_attendance_exceptions', 'employee_id'], ['hr_timesheets', 'employee_id'],
  ['hr_overtime_entries', 'employee_id'], ['hr_employee_pay_items', 'employee_id'],
  ['hr_employee_statutory_profiles', 'employee_id'], ['hr_onboarding_cases', 'employee_id'],
  ['hr_offboarding_cases', 'employee_id'], ['hr_requests', 'employee_id'],
  ['hr_requests', 'requested_by'],
  ['finance_payroll_run_lines', 'employee_id'], ['finance_remittance_lines', 'employee_id'],
  ['hr_shift_assignments', 'employee_id'], ['notifications', 'recipient_id'],
  // workflow chain — decisions/audit/events/handoffs/tasks must clear before instances,
  // and every actor/requester FK here is RESTRICT (blocks the app_users delete).
  ['workflow_decisions', 'actor_id'], ['workflow_audit_log', 'actor_id'],
  ['workflow_events', 'actor_id'], ['workflow_handoffs', 'created_by'],
  ['workflow_tasks', 'assigned_user_id'], ['workflow_tasks', 'completed_by'],
  ['workflow_instances', 'requested_by'], ['module_mutation_runs', 'actor_user_id'],
  ['app_setting_audit_log', 'changed_by'],
];

/** Non-user-keyed text columns suites also stamp with the TAG. */
const TEXT_PATTERNS = [
  ['hr_positions', 'position_key'], ['departments', 'name'], ['finance_cost_centers', 'code'],
  ['notifications', 'title'], ['hse_inspections', 'title'], ['hse_inspection_findings', 'title'],
  ['hse_inspection_templates', 'name'], ['hse_training_courses', 'name'],
  ['hse_training_competencies', 'name'], ['hse_worker_certificates', 'course_name'],
  ['ui_widget_packages', 'name'], ['hr_org_change_requests', 'change_no'],
  ['project_sites', 'name'], ['module_mutation_runs', 'idempotency_key'],
  ['message_attachments', 'file_name'],
];

/**
 * Sweep orphaned E2E data.
 * @param {import('@supabase/supabase-js').SupabaseClient} sb  service-role client
 * @param {{ apply?: boolean, verbose?: boolean, log?: (s: string) => void }} [opts]
 *   apply — actually delete (default false = dry run). verbose — print section headers
 *   and empty-scan lines (CLI); off = log only rows actually found/deleted (run hook).
 * @returns {Promise<{ users: number, deleted: number }>}
 */
export async function sweepOrphans(sb, { apply = false, verbose = false, log = () => {} } = {}) {
  let deleted = 0;
  const vlog = (s) => { if (verbose) log(s); };

  const sweepByIds = async (table, column, ids) => {
    if (!ids.length) return;
    const { data, error } = await sb.from(table).select('id').in(column, ids);
    if (error) { vlog(`  ~ skip ${table}.${column}: ${error.message}`); return; }
    const n = data?.length ?? 0;
    if (!n) return;
    log(`  ${apply ? 'deleting' : 'found'} ${n} row(s) in ${table} (${column} in test-e2e ids)`);
    if (apply) {
      const { error: delErr } = await sb.from(table).delete().in(column, ids);
      if (delErr) log(`    ! delete failed: ${delErr.message}`); else deleted += n;
    }
  };
  const sweepPattern = async (table, column, pattern = `%${MARKER}%`) => {
    const { data, error } = await sb.from(table).select('id').ilike(column, pattern);
    if (error) { vlog(`  ~ skip ${table}.${column}: ${error.message}`); return; }
    const n = data?.length ?? 0;
    if (!n) return;
    log(`  ${apply ? 'deleting' : 'found'} ${n} row(s) in ${table} (${column} ~ ${MARKER})`);
    if (apply) {
      const { error: delErr } = await sb.from(table).delete().ilike(column, pattern);
      if (delErr) log(`    ! delete failed: ${delErr.message}`); else deleted += n;
    }
  };

  // 1 ── every synthetic app_user left behind (marker in username, OR "(E2E" full_name).
  const { data: users, error: uErr } = await sb.from('app_users')
    .select('id, username, full_name')
    .or(`username.ilike.%${MARKER}%,full_name.ilike.%(E2E%`);
  if (uErr) throw new Error(`sweep: query app_users: ${uErr.message}`);
  const userIds = (users ?? []).map(u => u.id);
  if (userIds.length || verbose) log(`app_users matching test markers: ${userIds.length}`);
  for (const u of (users ?? []).slice(0, 20)) vlog(`   - ${u.username}  (${u.full_name ?? '—'})`);

  // 2 ── user-referencing tables that don't cascade.
  vlog('User-referencing tables:');
  for (const [table, column] of USER_KEYED) await sweepByIds(table, column, userIds);

  // 2b ── two chains with an intermediate FK that must clear before its parent.
  if (userIds.length) {
    const { data: accts } = await sb.from('finance_employee_bank_accounts').select('id').in('employee_id', userIds);
    await sweepByIds('finance_disbursement_lines', 'bank_account_id', (accts ?? []).map(a => a.id));
    await sweepByIds('finance_employee_bank_accounts', 'employee_id', userIds);

    const { data: claims } = await sb.from('finance_expense_claims').select('id').in('claimant_id', userIds);
    await sweepByIds('finance_cost_entries', 'expense_claim_id', (claims ?? []).map(c => c.id));
    await sweepByIds('finance_expense_claims', 'claimant_id', userIds);
  }

  // 3 ── non-user-keyed TAG-stamped text columns.
  vlog('TAG-stamped text columns:');
  for (const [table, column] of TEXT_PATTERNS) await sweepPattern(table, column);

  // 4 ── finally the users themselves (cascades whatever DOES have a cascade FK).
  if (userIds.length) {
    log(`app_users: ${apply ? 'deleting' : 'would delete'} ${userIds.length} row(s)`);
    if (apply) {
      const failed = [];
      for (const u of users) {
        const { error: delErr } = await sb.from('app_users').delete().eq('id', u.id);
        if (delErr) failed.push(`${u.username}: ${delErr.message}`); else deleted += 1;
      }
      if (failed.length) { log('  ! still FK-blocked:'); failed.forEach(f => log(`    · ${f}`)); }
    }
  }
  return { users: userIds.length, deleted };
}

// ── CLI entry ────────────────────────────────────────────────────────────────
// pathToFileURL handles Windows drive letters + %20-encoded spaces ("MSI Laptop").
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  console.log(`SIOMAC E2E orphan sweep — ${apply ? 'APPLY (will delete)' : 'DRY RUN (no changes)'}\n`);
  const { users, deleted } = await sweepOrphans(serviceClient(), { apply, verbose: true, log: (s) => console.log(s) });
  console.log(`\n${apply ? `Done — ${deleted} row(s) deleted.` : `Dry run — ${users} test user(s) found. Re-run with --apply to delete.`}`);
}
