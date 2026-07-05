/**
 * scripts/e2e/sweep-orphans.mjs
 *
 * Removes leftover E2E test data from ANY prior run, not just the current process.
 *
 * Why this exists: each suite's own `h.onCleanup()` only knows the row IDs it created
 * IN MEMORY during that run. If a run is interrupted (Ctrl+C, a Bash timeout, a crash),
 * those IDs are lost and nothing else ever revisits them — `h.TAG` is a fresh
 * `TEST-E2E-<timestamp>` per run, so a later run's cleanup never matches an earlier
 * run's rows. Over many interrupted runs this leaves permanent orphan rows.
 *
 * Every synthetic user created by every suite has a `username` containing the literal
 * marker "test-e2e" (case-insensitive) — either as the `TEST-E2E-<ts>_suffix` prefix
 * form, or embedded lowercase as `e2e-test-e2e-<ts>-suffix` (hrEmployeeMaster). That
 * marker is the anchor: find those app_users rows, delete everything that references
 * them (tables without an ON DELETE CASCADE FK), then delete the users themselves
 * (which cascades whatever DOES have a cascade FK). A second pass sweeps non-user-keyed
 * text columns (position keys, department names, cost-center codes, etc.) that suites
 * also stamp with the same TAG.
 *
 * Usage:
 *   node scripts/e2e/sweep-orphans.mjs            # dry run — reports counts only
 *   node scripts/e2e/sweep-orphans.mjs --apply     # actually deletes
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function loadEnv() {
  let txt = '';
  try { txt = readFileSync(new URL('../../.env', import.meta.url), 'utf8'); }
  catch { console.error('Could not read .env at project root'); process.exit(2); }
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQUIRED_ENV.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQUIRED_ENV) if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  return out;
}

const APPLY = process.argv.includes('--apply');
const MARKER = 'test-e2e';
const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let deletedTotal = 0;

/** Delete rows matching an ilike pattern on `column` in `table`. Never throws — missing
 *  tables/columns (schema drift) are reported, not fatal to the rest of the sweep. */
async function sweepPattern(table, column, pattern = `%${MARKER}%`) {
  const { data, error } = await sb.from(table).select('id', { count: 'exact' }).ilike(column, pattern);
  if (error) { console.log(`  ~ skip ${table}.${column}: ${error.message}`); return; }
  const n = data?.length ?? 0;
  if (!n) return;
  console.log(`  ${APPLY ? 'deleting' : 'found'} ${n} row(s) in ${table} (${column} ~ ${MARKER})`);
  if (APPLY) {
    const { error: delErr } = await sb.from(table).delete().ilike(column, pattern);
    if (delErr) console.warn(`    ! delete failed: ${delErr.message}`);
    else deletedTotal += n;
  }
}

/** Delete rows in `table` whose `column` is one of `ids`. */
async function sweepByIds(table, column, ids) {
  if (!ids.length) return;
  const { data, error } = await sb.from(table).select('id').in(column, ids);
  if (error) { console.log(`  ~ skip ${table}.${column}: ${error.message}`); return; }
  const n = data?.length ?? 0;
  if (!n) return;
  console.log(`  ${APPLY ? 'deleting' : 'found'} ${n} row(s) in ${table} (${column} in test-e2e user ids)`);
  if (APPLY) {
    const { error: delErr } = await sb.from(table).delete().in(column, ids);
    if (delErr) console.warn(`    ! delete failed: ${delErr.message}`);
    else deletedTotal += n;
  }
}

console.log(`SIOMAC E2E orphan sweep — ${APPLY ? 'APPLY (will delete)' : 'DRY RUN (no changes)'}\n`);

// ── 1. find every synthetic app_user left behind by any suite ────────────────────────
const { data: users, error: uErr } = await sb.from('app_users').select('id, username, full_name').ilike('username', `%${MARKER}%`);
if (uErr) { console.error('Could not query app_users:', uErr.message); process.exit(1); }
const userIds = (users ?? []).map(u => u.id);
console.log(`app_users matching "*${MARKER}*": ${userIds.length}`);
if (userIds.length) {
  for (const u of users.slice(0, 20)) console.log(`   - ${u.username}  (${u.full_name ?? '—'})`);
  if (users.length > 20) console.log(`   … and ${users.length - 20} more`);
}
console.log('');

// ── 2. tables that reference those users but are NOT guaranteed to cascade ───────────
console.log('User-referencing tables:');
const userKeyedTables = [
  ['hr_audit_log', 'actor_id'],
  ['hr_audit_log', 'employee_id'],
  ['app_events', 'actor_user_id'],
  ['app_events', 'source_entity_id'],
  ['hr_employee_status_history', 'employee_id'],
  ['hr_employee_assignments', 'employee_id'],
  ['hr_employee_documents', 'employee_id'],
  ['hr_employee_change_requests', 'employee_id'],
  ['hr_employee_change_requests', 'requested_by'],
  ['hr_leave_requests', 'employee_id'],
  ['hr_leave_balances', 'employee_id'],
  ['hr_leave_accruals', 'employee_id'],
  ['hr_attendance_records', 'employee_id'],
  ['hr_attendance_corrections', 'employee_id'],
  ['hr_attendance_exceptions', 'employee_id'],
  ['hr_timesheets', 'employee_id'],
  ['hr_overtime_entries', 'employee_id'],
  ['hr_employee_pay_items', 'employee_id'],
  ['hr_employee_statutory_profiles', 'employee_id'],
  ['hr_onboarding_cases', 'employee_id'],
  ['hr_offboarding_cases', 'employee_id'],
  ['hr_requests', 'employee_id'],
  ['finance_payroll_run_lines', 'employee_id'],
  ['finance_remittance_lines', 'employee_id'],
  ['hr_shift_assignments', 'employee_id'],
  ['notifications', 'recipient_id'],
  ['workflow_instances', 'requested_by'],
  ['workflow_audit_log', 'actor_id'],
  ['module_mutation_runs', 'actor_user_id'],
];
for (const [table, column] of userKeyedTables) await sweepByIds(table, column, userIds);

// finance_disbursement_lines FKs to finance_employee_bank_accounts — must clear first.
{
  const { data: accts } = await sb.from('finance_employee_bank_accounts').select('id').in('employee_id', userIds);
  const acctIds = (accts ?? []).map(a => a.id);
  await sweepByIds('finance_disbursement_lines', 'bank_account_id', acctIds);
  await sweepByIds('finance_employee_bank_accounts', 'employee_id', userIds);
}

// finance_cost_entries FKs to finance_expense_claims — must clear first.
{
  const { data: claims } = await sb.from('finance_expense_claims').select('id').in('claimant_id', userIds);
  const claimIds = (claims ?? []).map(c => c.id);
  await sweepByIds('finance_cost_entries', 'expense_claim_id', claimIds);
  await sweepByIds('finance_expense_claims', 'claimant_id', userIds);
}
console.log('');

// ── 3. non-user-keyed text columns suites also stamp with the TAG ────────────────────
console.log('TAG-stamped text columns:');
const textPatterns = [
  ['hr_positions', 'position_key'],
  ['departments', 'name'],
  ['finance_cost_centers', 'code'],
  ['notifications', 'title'],
  ['hse_inspections', 'title'],
  ['hse_inspection_findings', 'title'],
  ['hse_inspection_templates', 'name'],
  ['hse_training_courses', 'name'],
  ['hse_training_competencies', 'name'],
  ['hse_worker_certificates', 'course_name'],
  ['ui_widget_packages', 'name'],
  ['hr_org_change_requests', 'change_no'],
  ['project_sites', 'name'],
  ['module_mutation_runs', 'idempotency_key'],
  ['message_attachments', 'file_name'],
];
for (const [table, column] of textPatterns) await sweepPattern(table, column);
console.log('');

// ── 4. finally, the users themselves (cascades whatever DOES have a cascade FK) ──────
if (userIds.length) {
  console.log(`app_users: ${APPLY ? 'deleting' : 'would delete'} ${userIds.length} row(s)`);
  if (APPLY) {
    const { error: delErr } = await sb.from('app_users').delete().in('id', userIds);
    if (delErr) console.warn(`  ! delete failed: ${delErr.message}`);
    else deletedTotal += userIds.length;
  }
}

console.log(`\n${APPLY ? `Done — ${deletedTotal} row(s) deleted.` : 'Dry run complete — re-run with --apply to delete the rows listed above.'}`);
