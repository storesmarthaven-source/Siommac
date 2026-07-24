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
 * BUSINESS rows are swept too: suites stamp every record they create with the run
 * TAG in a text column (title/label/subject). A suite's own onCleanup can miss them —
 * interrupted run, or an FK-blocked delete whose error the closure swallowed (this is
 * how 312 TEST-E2E rows accumulated in hse_hazards and broke riskjsa's list test).
 * For each such record we clear its no-ON-DELETE satellites, the workflow chain it
 * started (handoffs → instances; tasks/decisions/transitions cascade), then the row.
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
  ['hr_shift_assignments', 'employee_id'],
  // Crew payroll (CP4/CP5): leaked crew rows FK-block their test employees.
  ['hr_crew_movements', 'employee_id'], ['hr_crew_assignments', 'employee_id'],
  // Pay-group membership: a leftover assignment for a reused/synthetic employee id
  // trips the one-active-group exclusion constraint ("employee already has a pay-group
  // assignment covering part of that period") on a later run. Sweep by employee_id.
  ['finance_employee_pay_group_assignments', 'employee_id'],
  // Payroll finding activity: actor_id is ON DELETE SET NULL (no update trigger), so it never
  // blocks the user delete — but sweep a test author's rows explicitly so they don't linger
  // with a null actor on any finding the run-cascade didn't reach (defense-in-depth, §15.3).
  ['finance_payroll_finding_activity', 'actor_id'],
  // notifications.user_id and workflow_events.actor_user_id are NOT listed:
  // both FKs are ON DELETE CASCADE / SET NULL, so they never block the user delete
  // (TAG-titled notifications are swept via TEXT_PATTERNS below). workflow_handoffs
  // carries no user FK at all.
  // workflow chain — decisions/audit/tasks must clear before instances, and every
  // actor/assignee/requester FK here has no ON DELETE (blocks the app_users delete).
  // NOTE: the live schema post-cutover (20260704000003) has assigned_to, not the
  // dropped assigned_user_id.
  ['workflow_decisions', 'actor_id'], ['workflow_audit_log', 'actor_id'],
  ['workflow_tasks', 'assigned_to'], ['workflow_tasks', 'completed_by'],
  ['workflow_instances', 'requested_by'], ['workflow_instances', 'owner_id'],
  ['module_mutation_runs', 'actor_user_id'],
  ['app_setting_audit_log', 'changed_by'],
  // Both FKs are plain `references app_users(id)` (no ON DELETE) — a test manager
  // who created/approved a pay-component change request is FK-blocked until these
  // envelope rows (test artifacts themselves) are removed.
  ['finance_pay_component_change_requests', 'created_by'],
  ['finance_pay_component_change_requests', 'approved_by'],
];

/**
 * TAG-stamped BUSINESS rows: suites stamp every record they create with the run TAG
 * in these text columns. `satellites` lists child tables cleared first — the ones
 * marked (blocks) have a no-ON-DELETE FK that otherwise refuses the parent delete;
 * the source_id ones are FK-less polymorphic children that would linger as orphans.
 * Children with `on delete cascade` (incident people/investigations/evidence/root
 * causes, JSA steps/crew acks, NIS classes, thread participants/messages/grants)
 * are intentionally NOT listed.
 *
 * Known non-sweepable blockers (surfaced by the failure log, on purpose):
 *  · Payroll runs whose ownership is PROVEN (created_by ∈ the discovered test users)
 *    are cleaned by the strict, fail-closed payroll phase below (`sweepPayrollRunsOwnedBy`),
 *    which walks the full evidence/downstream chain in FK order. A payroll run merely
 *    pinned to a test statutory_version_id but NOT owned by a test user is still left
 *    for its suite's own cleanup — deleting that here would be too destructive.
 *  · wf_internal.workflow_request_receipts is NOT exposed via PostgREST (private
 *    schema) so it can't be swept — its workflow_id FK is ON DELETE SET NULL
 *    (migration 20260919000213), so it never blocks the instance delete.
 */
const BUSINESS_TAGGED = [
  { table: 'hse_hazards', column: 'title', satellites: [
    ['hse_controls', 'hazard_id'],                    // (blocks)
    ['hse_risk_assessment_hazards', 'hazard_id'],     // (blocks)
  ] },
  { table: 'hse_risk_assessments', column: 'title', satellites: [
    ['hse_controls', 'source_id'], ['hse_ppe_requirements', 'source_id'], ['hse_training_links', 'source_id'],
  ] },
  { table: 'hse_jsa', column: 'title', satellites: [
    ['hse_controls', 'source_id'], ['hse_ppe_requirements', 'source_id'],
    ['hse_training_links', 'source_id'], ['hse_risk_jsa_links', 'source_id'],
  ] },
  { table: 'hse_hazard_library', column: 'title', satellites: [] },
  { table: 'hse_incidents', column: 'title', satellites: [] },
  { table: 'hse_capa_actions', column: 'title', satellites: [
    ['hse_controls', 'source_id'],
  ] },
  { table: 'finance_statutory_versions', column: 'label', satellites: [] },
  { table: 'message_threads', column: 'subject', satellites: [] },
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
  // Payroll Reports Center (F-12): jobs are tagged via their idempotency_key; the
  // artifact + upload-attempt ledger rows CASCADE on job delete (migs 741/742).
  ['payroll_report_jobs', 'idempotency_key'],
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

  // .in() lists ride in the URL — chunk so a big backlog (312 hazards happened)
  // can't blow the request-line limit and silently sweep nothing.
  const CHUNK = 100;
  const chunk = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
    return out;
  };

  const sweepByIds = async (table, column, ids) => {
    if (!ids.length) return;
    let found = 0, failedMsg = null;
    for (const part of chunk(ids)) {
      const { data, error } = await sb.from(table).select('id').in(column, part);
      if (error) { vlog(`  ~ skip ${table}.${column}: ${error.message}`); return; }
      const n = data?.length ?? 0;
      if (!n) continue;
      found += n;
      if (apply) {
        const { error: delErr } = await sb.from(table).delete().in(column, part);
        if (delErr) failedMsg = delErr.message; else deleted += n;
      }
    }
    if (!found) return;
    log(`  ${apply ? 'deleting' : 'found'} ${found} row(s) in ${table} (${column} in test-e2e ids)`);
    if (failedMsg) log(`    ! delete failed: ${failedMsg}`);
  };

  /** Select ids from `table` where `column` is in `ids` (chunked). */
  const collectIds = async (table, column, ids) => {
    const out = [];
    for (const part of chunk(ids)) {
      const { data, error } = await sb.from(table).select('id').in(column, part);
      if (error) { vlog(`  ~ skip lookup ${table}.${column}: ${error.message}`); return out; }
      for (const r of data ?? []) out.push(r.id);
    }
    return out;
  };

  /** Delete the platform chains hanging off `recordIds`:
   *  · handoff_outbox rows keyed by source/target entity id — a PENDING outbox row
   *    for a deleted test record keeps retrying and RE-CREATES derived records
   *    (a killed riskjsa run's hazard→assessment handoff resurrected an assessment
   *    minutes after the sweep — kill the re-creators before the records).
   *  · workflow instances (cascade tasks/decisions/events/transitions), with
   *    workflow_handoffs.workflow_id (no ON DELETE) cleared first.
   *  (source_record_id is the only record column on live workflow_instances —
   *  the legacy source_entity_id was dropped in the cutover.) */
  const sweepPlatformChains = async (recordIds) => {
    if (!recordIds.length) return;
    const ids = recordIds.map(String);
    await sweepByIds('handoff_outbox', 'source_entity_id', ids);
    await sweepByIds('handoff_outbox', 'target_entity_id', ids);
    const wfIds = await collectIds('workflow_instances', 'source_record_id', ids);
    if (!wfIds.length) return;
    await sweepByIds('workflow_handoffs', 'workflow_id', wfIds);
    await sweepByIds('workflow_instances', 'id', wfIds);
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

  /**
   * STRICT, fail-closed payroll-run cleanup. The sweeper historically skipped payroll
   * runs (a blind delete is too destructive). We now clean ONLY runs whose ownership is
   * PROVEN — created_by ∈ the discovered synthetic test users — walking the full
   * FK-ordered evidence/downstream chain from payrollControlCenter.mjs onCleanup.
   *
   * Unlike the permissive helpers above, every step THROWS on any lookup / unlink /
   * delete / verify failure, so the sweep aborts (the users are NOT then deleted)
   * instead of silently leaking or over-deleting. Candidate discovery NEVER matches on
   * run_no text. Auto-cleanup is safe precisely because ownership is strictly proven.
   * Returns the distinct owner user ids for the post-delete verification.
   */
  const sweepPayrollRunsOwnedBy = async (uids) => {
    const countWhere = async (table, build) => {
      const { count, error } = await build(sb.from(table).select('*', { count: 'exact', head: true }));
      if (error) throw new Error(`[payroll-sweep] COUNT ${table}: ${error.message}`);
      return count ?? 0;
    };
    const delWhere = async (table, build) => {
      const found = await countWhere(table, build);
      if (found && apply) {
        const { error } = await build(sb.from(table).delete());
        if (error) throw new Error(`[payroll-sweep] DELETE ${table}: ${error.message}`);
        deleted += found;
      }
      return found;
    };
    const delIn = async (table, column, ids) => {
      let found = 0;
      for (const part of chunk(ids)) found += await delWhere(table, q => q.in(column, part));
      return found;
    };
    const selIn = async (table, sel, column, ids) => {
      const out = [];
      for (const part of chunk(ids)) {
        const { data, error } = await sb.from(table).select(sel).in(column, part);
        if (error) throw new Error(`[payroll-sweep] SELECT ${table}: ${error.message}`);
        out.push(...(data ?? []));
      }
      return out;
    };

    // Discover candidates STRICTLY by created_by (never run_no).
    const runRows = await selIn('finance_payroll_runs',
      'id, run_no, status, created_by, workflow_id, source_run_id', 'created_by', uids);
    if (!runRows.length) return [];
    const runIds  = runRows.map(r => r.id);
    const runNos  = runRows.map(r => r.run_no);
    const ownerIds = [...new Set(runRows.map(r => r.created_by))];

    log(`payroll runs owned by test users: ${runRows.length}`);
    for (const r of runRows) log(`   - ${r.run_no}  [${r.status}]  ${r.id}`);

    // Preflight (fail-closed): a correction run OUTSIDE the candidate set that
    // references a candidate via source_run_id (self-ref, ON DELETE RESTRICT). Abort —
    // deleting the candidate would either be blocked or strand an external run.
    const referrers = await selIn('finance_payroll_runs', 'id, run_no, source_run_id', 'source_run_id', runIds);
    const external = referrers.filter(r => !runIds.includes(r.id));
    if (external.length)
      throw new Error(`[payroll-sweep] ABORT: external correction run(s) reference candidates — ` +
        external.map(r => `${r.run_no}(${r.id})`).join(', '));

    // Child-row visibility — every non-zero count prints (this IS the dry-run report).
    const CHAIN = [
      ['finance_payroll_export_command_receipts', 'run_id'], ['finance_payroll_exports', 'run_id'],
      ['finance_payroll_release_command_receipts', 'run_id'], ['finance_payroll_gl_command_receipts', 'run_id'],
      ['finance_payroll_lifecycle_command_receipts', 'run_id'], ['finance_payroll_input_lock_receipts', 'run_id'],
      ['finance_payroll_release_certificates', 'run_id'], ['finance_remittances', 'payroll_run_id'],
      ['finance_disbursements', 'payroll_run_id'], ['finance_payroll_funding_confirmations', 'run_id'],
      ['finance_payroll_certifications', 'run_id'], ['finance_payslip_deliveries', 'run_id'],
      ['finance_payslips', 'run_id'], ['finance_payroll_control_findings', 'run_id'],
      ['finance_payroll_run_warnings', 'run_id'], ['finance_payroll_run_lines', 'run_id'],
      ['finance_payroll_run_inputs', 'run_id'], ['finance_payroll_calculation_version_lines', 'run_id'],
      ['finance_payroll_calculation_versions', 'run_id'], ['finance_payroll_calculation_attempts', 'run_id'],
      ['finance_payroll_input_snapshot_lines', 'run_id'], ['finance_payroll_input_snapshots', 'run_id'],
    ];
    for (const [t, c] of CHAIN) {
      let n = 0;
      for (const part of chunk(runIds)) n += await countWhere(t, q => q.in(c, part));
      if (n) log(`     ${t}.${c}: ${n}`);
    }
    const glN = await countWhere('finance_gl_journals', q => q.eq('source_module', 'finance_payroll').in('source_ref', runNos));
    if (glN) log(`     finance_gl_journals(source_ref): ${glN}`);
    const wfIds = runRows.map(r => r.workflow_id).filter(Boolean);

    if (!apply) return ownerIds;   // dry-run: report only, never unlink or delete

    // 1. Unlink run self-pointers first — a SET NULL onto an immutable evidence FK
    //    (published_by, current_*_id) raises PR409, so break the pointer here instead.
    for (const part of chunk(runIds)) {
      const { error } = await sb.from('finance_payroll_runs').update({
        release_certificate_id: null, approval_certification_id: null, gl_journal_id: null,
        current_calculation_version_id: null, current_input_snapshot_id: null,
      }).in('id', part);
      if (error) throw new Error(`[payroll-sweep] UNLINK runs: ${error.message}`);
    }
    // 2. Command receipts + exports.
    for (const t of ['finance_payroll_export_command_receipts', 'finance_payroll_exports',
      'finance_payroll_release_command_receipts', 'finance_payroll_gl_command_receipts',
      'finance_payroll_lifecycle_command_receipts', 'finance_payroll_input_lock_receipts'])
      await delIn(t, 'run_id', runIds);
    // 3. Release satellites + remittances.
    const certIds = (await selIn('finance_payroll_release_certificates', 'id', 'run_id', runIds)).map(r => r.id);
    await delIn('finance_payroll_release_remittances', 'release_certificate_id', certIds);
    await delIn('finance_payroll_release_certificates', 'run_id', runIds);
    await delIn('finance_remittances', 'payroll_run_id', runIds);
    // 4. Disbursements (bank files → lines → disbursement).
    const disbIds = (await selIn('finance_disbursements', 'id', 'payroll_run_id', runIds)).map(r => r.id);
    await delIn('finance_disbursement_bank_files', 'disbursement_id', disbIds);
    await delIn('finance_disbursement_lines', 'disbursement_id', disbIds);
    await delIn('finance_disbursements', 'id', disbIds);
    // 5. Funding, certifications, GL journals.
    await delIn('finance_payroll_funding_confirmations', 'run_id', runIds);
    await delIn('finance_payroll_certifications', 'run_id', runIds);
    await delWhere('finance_gl_journals', q => q.eq('source_module', 'finance_payroll').in('source_ref', runNos));
    // 6. Payslips.
    await delIn('finance_payslip_deliveries', 'run_id', runIds);
    await delIn('finance_payslips', 'run_id', runIds);
    // 7. Evidence (DELETE is allowed; only UPDATE is PR409-locked).
    for (const t of ['finance_payroll_control_findings', 'finance_payroll_run_warnings',
      'finance_payroll_run_lines', 'finance_payroll_run_inputs',
      'finance_payroll_calculation_version_lines', 'finance_payroll_calculation_versions',
      'finance_payroll_calculation_attempts', 'finance_payroll_input_snapshot_lines',
      'finance_payroll_input_snapshots'])
      await delIn(t, 'run_id', runIds);
    // 8. Workflow chain the run started (decisions/audit/tasks → instance).
    if (wfIds.length) {
      await delIn('workflow_decisions', 'workflow_id', wfIds);
      await delIn('workflow_audit_log', 'workflow_id', wfIds);
      await delIn('workflow_tasks', 'workflow_id', wfIds);
      await delIn('workflow_instances', 'id', wfIds);
    }
    // 9. Platform side-effects + the runs themselves.
    await delIn('notifications', 'source_id', runIds);
    await delIn('handoff_outbox', 'source_entity_id', runIds);
    await delIn('hr_audit_log', 'record_id', runIds);
    await delIn('app_events', 'source_entity_id', runIds);
    await delIn('finance_payroll_runs', 'id', runIds);

    // Verify (fail-closed): candidate runs MUST be gone before any user is deleted.
    let survivors = 0;
    for (const part of chunk(runIds)) survivors += await countWhere('finance_payroll_runs', q => q.in('id', part));
    if (survivors) throw new Error(`[payroll-sweep] ABORT: ${survivors} candidate run(s) survived deletion`);
    log(`  payroll: cleared ${runRows.length} run(s) + evidence owned by ${ownerIds.length} test user(s)`);
    return ownerIds;
  };

  // 1 ── every synthetic app_user left behind (marker in username, OR "(E2E" full_name).
  const { data: users, error: uErr } = await sb.from('app_users')
    .select('id, username, full_name')
    .or(`username.ilike.%${MARKER}%,full_name.ilike.%(E2E%`);
  if (uErr) throw new Error(`sweep: query app_users: ${uErr.message}`);
  const userIds = (users ?? []).map(u => u.id);
  if (userIds.length || verbose) log(`app_users matching test markers: ${userIds.length}`);
  for (const u of (users ?? []).slice(0, 20)) vlog(`   - ${u.username}  (${u.full_name ?? '—'})`);

  // 2 ── TAG-stamped BUSINESS rows + the workflow chains they started.
  // Chain first: instances are only findable via the record ids, so if the chain
  // delete fails (or the sweep is interrupted) the still-present TAG-stamped record
  // lets the NEXT sweep retry it — deleting the record first would strand its
  // instances forever. Then blocking/orphan satellites, then the record itself.
  vlog('TAG-stamped business rows:');
  for (const { table, column, satellites } of BUSINESS_TAGGED) {
    const { data, error } = await sb.from(table).select('id').ilike(column, `%${MARKER}%`);
    if (error) { vlog(`  ~ skip ${table}.${column}: ${error.message}`); continue; }
    const ids = (data ?? []).map(r => r.id);
    if (!ids.length) continue;
    await sweepPlatformChains(ids);
    for (const [child, fk] of satellites) await sweepByIds(child, fk, ids.map(String));
    await sweepByIds(table, 'id', ids);
  }

  // 3 ── user-referencing tables that don't cascade.
  vlog('User-referencing tables:');
  if (userIds.length) {
    // FK unblockers first — these all reference the user-keyed rows below with a
    // no-ON-DELETE FK and would otherwise silently refuse the deletes:
    //  · workflow_instances requested_by OR owner_id a test user (both FKs have no
    //    ON DELETE) → clear its handoffs, then delete the instance (cascades its
    //    tasks/decisions/events/transitions).
    //  · remaining workflow_tasks assigned to a test user (on a real user's
    //    workflow) → clear workflow_decisions.task_id / workflow_transitions.task_id.
    const wfIds = new Set();
    for (const col of ['requested_by', 'owner_id']) {
      for (const id of await collectIds('workflow_instances', col, userIds)) wfIds.add(id);
    }
    await sweepByIds('workflow_handoffs', 'workflow_id', [...wfIds]);
    await sweepByIds('workflow_instances', 'id', [...wfIds]);
    const taskIds = new Set();
    for (const col of ['assigned_to', 'completed_by']) {
      for (const id of await collectIds('workflow_tasks', col, userIds)) taskIds.add(id);
    }
    await sweepByIds('workflow_decisions', 'task_id', [...taskIds]);
    await sweepByIds('workflow_transitions', 'task_id', [...taskIds]);
  }
  for (const [table, column] of USER_KEYED) await sweepByIds(table, column, userIds);

  // 3b ── two chains with an intermediate FK that must clear before its parent.
  if (userIds.length) {
    const { data: accts } = await sb.from('finance_employee_bank_accounts').select('id').in('employee_id', userIds);
    await sweepByIds('finance_disbursement_lines', 'bank_account_id', (accts ?? []).map(a => a.id));
    await sweepByIds('finance_employee_bank_accounts', 'employee_id', userIds);

    const { data: claims } = await sb.from('finance_expense_claims').select('id').in('claimant_id', userIds);
    await sweepByIds('finance_cost_entries', 'expense_claim_id', (claims ?? []).map(c => c.id));
    await sweepByIds('finance_expense_claims', 'claimant_id', userIds);
  }

  // 4 ── non-user-keyed TAG-stamped text columns.
  vlog('TAG-stamped text columns:');
  for (const [table, column] of TEXT_PATTERNS) await sweepPattern(table, column);

  // 4c ── payroll runs owned by the discovered test users (strict, fail-closed chain).
  //  Must precede the user delete: run evidence FK-references the users (published_by
  //  SET NULL → PR409, snapshot/line employee_id RESTRICT) and would otherwise block it.
  let payrollOwnerIds = [];
  if (userIds.length) payrollOwnerIds = await sweepPayrollRunsOwnedBy(userIds);

  // 5 ── finally the users themselves (cascades whatever DOES have a cascade FK).
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

  // Fail-closed verification: the test users that OWNED payroll runs must now be gone.
  // A survivor means an evidence/downstream row was missed and silently FK-blocked the
  // delete — throw so the sweep aborts loudly instead of reporting a false-clean.
  if (apply && payrollOwnerIds.length) {
    let survivors = 0;
    for (const part of chunk(payrollOwnerIds)) {
      const { count, error } = await sb.from('app_users').select('*', { count: 'exact', head: true }).in('id', part);
      if (error) throw new Error(`[payroll-sweep] user re-verify: ${error.message}`);
      survivors += count ?? 0;
    }
    if (survivors) throw new Error(`[payroll-sweep] ABORT: ${survivors} payroll-owning test user(s) survived — an evidence row was missed`);
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
