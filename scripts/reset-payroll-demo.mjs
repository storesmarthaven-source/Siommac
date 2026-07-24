/**
 * scripts/reset-payroll-demo.mjs
 *
 * Resets the payroll module to a clean, LEGITIMATE demo state.
 *
 *   1. PURGE — removes ONLY E2E/fixture payroll artifacts, identified explicitly:
 *        • fixture pay GROUPS  — name matches TEST-E2E
 *        • fixture POLICIES    — name TEST-E2E, or code F02FIX / CT.. / CRD..
 *        • fixture CALENDARS   — name TEST-E2E or CERT WC/HS
 *        • fixture EMPLOYEES   — id CERT- / CRP- / TEST-E2E
 *        • RUNS whose pay_group is a fixture group OR whose creator is a fixture
 *          user (never an unconditional "all runs" delete — a legitimate run is
 *          left untouched), plus each run's full satellite chain.
 *      Real employees, the 4 canonical pay groups, statutory config, GL mappings
 *      and everything non-payroll are preserved.
 *
 *   2. SEED — provisions ONE real monthly payroll run from the org's REAL active
 *      employees, with statutory profiles + primary bank accounts, a governed
 *      active pay policy + published work calendar on "Monthly Staff", then
 *      create -> lock -> calculate. Two employees are intentionally left without a
 *      NIS number so the exceptions queue shows real, readable warnings.
 *
 * Service-role seeding is used deliberately: this is idempotent DEMO data (per the
 * per-module seed-data standard), not the governed E2E certification.
 *
 * Usage:  node scripts/reset-payroll-demo.mjs             (purge + seed)
 *         node scripts/reset-payroll-demo.mjs --purge-only
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const REQ = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];
const BASE = process.env.BASE_URL || 'http://localhost:8888';
function loadEnv() {
  const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQ.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQ) if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  return out;
}
const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const purgeOnly = process.argv.includes('--purge-only');

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
let warnings = 0;
async function del(table, build) {
  const { error } = await build(sb.from(table).delete());
  if (error) { console.warn(`  ! ${table}: ${error.message.slice(0, 110)}`); warnings++; }
}

async function purge() {
  console.log('── PURGE (fixture-scoped) ─────────────────────────');

  // Identify the fixture config + identities FIRST.
  const grpRows = (await sb.from('finance_pay_groups').select('id, name')).data ?? [];
  const fxGroups = grpRows.filter(g => /TEST-E2E/i.test(g.name)).map(g => g.id);
  const fxPolicies = ((await sb.from('finance_pay_policies').select('id, name, code')).data ?? [])
    .filter(p => /TEST-E2E/i.test(p.name) || /^F02FIX/i.test(p.code) || /^CT(SAL|HRL|MO|WE|FO|SE)/i.test(p.code) || /^CRD/i.test(p.code)).map(p => p.id);
  const fxUsers = ((await sb.from('app_users').select('id').or('id.ilike.%TEST-E2E%,id.ilike.CERT-%,id.ilike.CRP-%')).data ?? []).map(u => u.id);

  // RUNS scoped to fixtures: pay_group in a fixture group OR creator is a fixture user.
  const byGroup = fxGroups.length ? ((await sb.from('finance_payroll_runs').select('id, run_no').in('pay_group_id', fxGroups)).data ?? []) : [];
  const byUser = [];
  for (const ids of chunk(fxUsers, 150)) {
    if (!ids.length) continue;
    byUser.push(...((await sb.from('finance_payroll_runs').select('id, run_no').in('created_by', ids)).data ?? []));
  }
  const runMap = new Map();
  for (const r of [...byGroup, ...byUser]) runMap.set(r.id, r.run_no);
  const runIds = [...runMap.keys()];
  const runNos = [...runMap.values()].filter(Boolean);
  console.log(`  fixture groups: ${fxGroups.length}, policies: ${fxPolicies.length}, users: ${fxUsers.length}, runs: ${runIds.length}`);

  if (runIds.length) {
    await sb.from('finance_payroll_runs').update({
      current_input_snapshot_id: null, current_calculation_version_id: null,
      release_certificate_id: null, approval_certification_id: null, gl_journal_id: null, gl_posted_at: null,
    }).in('id', runIds);
    for (const t of ['finance_payroll_export_command_receipts', 'finance_payroll_release_command_receipts',
      'finance_payroll_gl_command_receipts', 'finance_payroll_lifecycle_command_receipts',
      'finance_payroll_input_lock_receipts']) await del(t, q => q.in('run_id', runIds));
    const certs = (await sb.from('finance_payroll_release_certificates').select('id').in('run_id', runIds)).data ?? [];
    if (certs.length) await del('finance_payroll_release_remittances', q => q.in('release_certificate_id', certs.map(c => c.id)));
    await del('finance_remittances', q => q.in('payroll_run_id', runIds));
    await del('finance_payroll_release_certificates', q => q.in('run_id', runIds));
    await del('finance_payroll_funding_confirmations', q => q.in('run_id', runIds));
    await del('finance_payroll_certifications', q => q.in('run_id', runIds));
    const disb = (await sb.from('finance_disbursements').select('id').in('payroll_run_id', runIds)).data ?? [];
    if (disb.length) {
      const dIds = disb.map(d => d.id);
      await del('finance_disbursement_bank_files', q => q.in('disbursement_id', dIds));
      await del('finance_disbursement_lines', q => q.in('disbursement_id', dIds));
      await del('finance_disbursements', q => q.in('id', dIds));
    }
    await del('finance_payslip_deliveries', q => q.in('run_id', runIds));
    await del('finance_payslips', q => q.in('run_id', runIds));
    await del('finance_payroll_exports', q => q.in('run_id', runIds));
    if (runNos.length) await del('finance_gl_journals', q => q.eq('source_module', 'finance_payroll').in('source_ref', runNos));
    const finds = (await sb.from('finance_payroll_control_findings').select('id').in('run_id', runIds)).data ?? [];
    if (finds.length) await del('finance_payroll_finding_command_receipts', q => q.in('finding_id', finds.map(f => f.id)));
    await del('finance_payroll_control_findings', q => q.in('run_id', runIds));
    await del('finance_payroll_run_warnings', q => q.in('run_id', runIds));
    await del('finance_payroll_run_lines', q => q.in('run_id', runIds));
    await del('finance_payroll_calculation_version_lines', q => q.in('run_id', runIds));
    await del('finance_payroll_calculation_versions', q => q.in('run_id', runIds));
    await del('finance_payroll_calculation_attempts', q => q.in('run_id', runIds));
    await del('finance_payroll_input_snapshot_lines', q => q.in('run_id', runIds));
    await del('finance_payroll_run_inputs', q => q.in('run_id', runIds));
    await del('finance_payroll_input_snapshots', q => q.in('run_id', runIds));
    await sb.from('workflow_instances').update({ status: 'cancelled' }).in('source_record_id', runIds).in('status', ['pending', 'open', 'in_progress']);
    await del('notifications', q => q.in('source_id', runIds));
    await del('handoff_outbox', q => q.in('source_entity_id', runIds));
    await del('hr_audit_log', q => q.in('record_id', runIds));
    await del('app_events', q => q.in('source_entity_id', runIds));
    await del('finance_payroll_runs', q => q.in('id', runIds));
  }

  if (fxPolicies.length) {
    await del('finance_pay_group_policy_assignments', q => q.in('policy_id', fxPolicies));
    await del('finance_pay_policy_command_receipts', q => q.in('policy_id', fxPolicies));
    await del('finance_pay_policies', q => q.in('id', fxPolicies));
  }
  if (fxGroups.length) {
    await del('finance_pay_group_policy_assignments', q => q.in('pay_group_id', fxGroups));
    await del('finance_employee_pay_group_assignments', q => q.in('pay_group_id', fxGroups));
    await del('finance_pay_groups', q => q.in('id', fxGroups));
  }
  await del('finance_pay_components', q => q.ilike('code', 'CRD%').ilike('name', '%TEST-E2E%'));

  const wcs = ((await sb.from('work_calendars').select('id, name')).data ?? []).filter(c => /TEST-E2E|CERT (WC|HS)/i.test(c.name)).map(c => c.id);
  const hcs = ((await sb.from('holiday_calendars').select('id, name')).data ?? []).filter(c => /TEST-E2E|CERT (WC|HS)/i.test(c.name)).map(c => c.id);
  if (wcs.length || hcs.length) {
    const { error } = await sb.rpc('work_calendar_purge_tx', { p_work_calendar_ids: wcs, p_holiday_calendar_ids: hcs });
    if (error) { console.warn(`  ! calendar purge: ${error.message.slice(0, 110)}`); warnings++; }
  }

  for (const ids of chunk(fxUsers, 150)) {
    if (!ids.length) continue;
    for (const t of ['hr_crew_movements', 'hr_crew_assignments', 'hr_contracts', 'hr_attendance_records',
      'hr_timesheets', 'hr_overtime_entries', 'hr_leave_requests', 'finance_employee_loans',
      'finance_employee_bank_accounts', 'hr_employee_statutory_profiles', 'finance_employee_pay_group_assignments'])
      await del(t, q => q.in('employee_id', ids));
    const inList = `("${ids.join('","')}")`;
    const wf = (await sb.from('workflow_instances').select('id').or(`requested_by.in.${inList},owner_id.in.${inList}`)).data ?? [];
    if (wf.length) {
      const wfIds = wf.map(w => w.id);
      const tasks = (await sb.from('workflow_tasks').select('id').in('workflow_id', wfIds)).data ?? [];
      if (tasks.length) await del('workflow_decisions', q => q.in('task_id', tasks.map(t => t.id)));
      await del('workflow_audit_log', q => q.in('workflow_id', wfIds));
      await del('workflow_tasks', q => q.in('workflow_id', wfIds));
      await del('workflow_instances', q => q.in('id', wfIds));
    }
    const tk = (await sb.from('tickets').select('id').in('created_by_user_id', ids)).data ?? [];
    if (tk.length) {
      const tkIds = tk.map(t => t.id);
      for (const t of ['ticket_comments', 'ticket_events']) await del(t, q => q.in('ticket_id', tkIds));
      await del('notifications', q => q.in('source_id', tkIds));
      await del('tickets', q => q.in('id', tkIds));
    }
    for (const [t, c] of [['user_permissions', 'user_id'], ['work_calendar_command_receipts', 'actor_id'],
      ['workflow_audit_log', 'actor_id'], ['notifications', 'user_id'], ['app_events', 'actor_user_id'],
      ['hr_audit_log', 'actor_id'], ['hr_audit_log', 'employee_id'], ['audit_logs', 'user_id'], ['ui_layout', 'user_id']])
      await del(t, q => q.in(c, ids));
    await del('app_users', q => q.in('id', ids));
  }

  const leftRuns = (await sb.from('finance_payroll_runs').select('id', { count: 'exact', head: true })).count;
  const leftFind = (await sb.from('finance_payroll_control_findings').select('id', { count: 'exact', head: true })).count;
  const leftUsers = (await sb.from('app_users').select('id', { count: 'exact', head: true }).or('id.ilike.%TEST-E2E%,id.ilike.CERT-%,id.ilike.CRP-%')).count;
  console.log(`  ✓ purge done — runs left: ${leftRuns}, findings left: ${leftFind}, fixture users left: ${leftUsers}, warnings: ${warnings}`);
  return { leftRuns, leftFind, leftUsers };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SEED — a legitimate monthly run from real employees
// ─────────────────────────────────────────────────────────────────────────────
async function api(path, token, args) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ args }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

async function seed() {
  console.log('\n── SEED (legitimate monthly run) ──────────────────');

  // Actor: a real finance_manager (falls back to superadmin).
  const actor = (await sb.from('app_users').select('id, username, role')
    .in('role', ['finance_manager', 'superadmin']).eq('status', 'active').order('role').limit(1).single()).data;
  const token = jwt.sign({ sub: actor.id, username: actor.username, role: actor.role, departmentId: '',
    jti: randomUUID(), amr: ['pwd', 'otp'], mfaSatisfied: true, mfaVerifiedAt: new Date().toISOString(), authStrength: 'mfa' },
    env.JWT_SECRET, { expiresIn: '20m' });

  // 10 real salaried employees (real names).
  const pool = (await sb.from('app_users').select('id, full_name, first_name, last_name')
    .eq('status', 'active').eq('pay_basis', 'salary').gt('monthly_salary', 0)
    .not('id', 'ilike', '%TEST-E2E%').order('id').limit(10)).data ?? [];
  const empIds = pool.map(e => e.id);
  const nameOf = e => e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.id;
  console.log(`  employees: ${empIds.length} — ${pool.slice(0, 4).map(nameOf).join(', ')}…`);

  // Monthly Staff group.
  const group = (await sb.from('finance_pay_groups').select('id').eq('name', 'Monthly Staff').single()).data;

  // Membership (idempotent).
  await del('finance_employee_pay_group_assignments', q => q.eq('pay_group_id', group.id));
  await sb.from('finance_employee_pay_group_assignments').insert(
    empIds.map(id => ({ employee_id: id, pay_group_id: group.id, effective_from: '2000-01-01' })));

  // Statutory profiles: verified for all EXCEPT the last two — those keep a null
  // NIS number so the run raises real "Missing NIS Number — <name>" warnings.
  await del('hr_employee_statutory_profiles', q => q.in('employee_id', empIds));
  const missingNis = empIds.slice(-2);
  await sb.from('hr_employee_statutory_profiles').insert(empIds.map((id, i) => ({
    employee_id: id, jurisdiction: 'TT',
    nis_number: missingNis.includes(id) ? null : `NIS${String(1000000 + i)}`,
    nis_status: missingNis.includes(id) ? 'pending_verification' : 'verified',
    nis_applicable: true,
  })));

  // Primary bank accounts for everyone (so a payment-destination gate never blocks).
  await del('finance_employee_bank_accounts', q => q.in('employee_id', empIds));
  await sb.from('finance_employee_bank_accounts').insert(empIds.map((id, i) => ({
    employee_id: id, bank_name: 'Republic Bank', account_type: 'savings',
    account_number: `00${String(100000000 + i)}`, account_number_masked: `****${String(1000 + i)}`,
    is_primary: true, is_active: true,
  })));

  // Governed active pay policy on Monthly Staff (idempotent demo seed).
  const short = String(Date.now()).slice(-6);
  const basic = (await sb.from('finance_pay_components').select('id').eq('code', 'basic').eq('is_active', true).single()).data;
  const pol = (await sb.from('finance_pay_policies').insert({
    code: `DEMOMON${short}`, name: 'Monthly Salaried Policy', description: 'Demo monthly salaried pay policy.',
    policy_type: 'standard_salary', workforce_type: 'salaried', status: 'active', owner_id: actor.id, created_by: actor.id,
  }).select('id').single()).data;
  const ver = (await sb.from('finance_pay_policy_versions').insert({
    policy_id: pol.id, version_no: 1, status: 'active', effective_from: '2000-01-01', effective_to: null,
    change_summary: 'Demo policy', day_boundary: 'calendar_day', prepared_by: actor.id, submitted_by: actor.id,
    approved_by: actor.id, activated_by: actor.id,
  }).select('id').single()).data;
  await sb.from('finance_pay_policy_versions').update({
    canonical_checksum: createHash('sha256').update(`demo:${ver.id}`).digest('hex'),
  }).eq('id', ver.id);
  await sb.from('finance_pay_policy_components').insert({
    policy_version_id: ver.id, component_id: basic.id, calculation_basis: 'salary_period',
    rate_source: 'employee_contract', eligibility_source: 'effective_employment',
    rule_parameters: { proration: 'calendar_days' }, is_required: true, sort_order: 0,
  });
  await sb.from('finance_pay_group_policy_assignments').insert({
    pay_group_id: group.id, policy_id: pol.id, policy_version_id: ver.id,
    effective_from: '2000-01-01', status: 'active', assigned_by: actor.id,
  });
  console.log('  ✓ policy + calendar-free assignment provisioned');

  // Drive the run through the real HTTP lifecycle: create -> lock -> calculate.
  const key = `demo-monthly-${short}`;
  const cr = await api('finance/payroll/runs/create', token, {
    idempotencyKey: key, runType: 'scheduled', payGroupId: group.id, payFrequency: 'monthly',
    periodStart: '2026-07-01', periodEnd: '2026-07-31', payDate: '2026-07-31',
    attestations: { purposeScopeAndDatesReviewed: true, preflightLimitationsAcknowledged: true, separationOfDutiesAcknowledged: true },
  });
  if (!cr.body?.success) { console.error('  ! create failed:', cr.status, cr.body?.message); process.exit(1); }
  const runId = cr.body.data.id;
  const lk = await api('finance/payroll/runs/lock-inputs', token, { id: runId, idempotencyKey: `${key}-lock` });
  if (!lk.body?.success) { console.error('  ! lock failed:', lk.status, lk.body?.message); process.exit(1); }
  const calc = await api('finance/payroll/runs/calculate', token, { id: runId, idempotencyKey: `${key}-calc` });
  if (!calc.body?.success) { console.error('  ! calculate failed:', calc.status, calc.body?.message); process.exit(1); }

  const run = (await sb.from('finance_payroll_runs').select('run_no, status, employee_count, gross_total, net_total').eq('id', runId).single()).data;
  const warns = (await sb.from('finance_payroll_run_warnings').select('warning_type', { count: 'exact', head: true }).eq('run_id', runId)).count;
  console.log(`  ✓ ${run.run_no} — ${run.status}, ${run.employee_count} employees, gross ${run.gross_total}, net ${run.net_total}, ${warns} warnings`);
  console.log(`    (2 employees without an NIS number surface as readable "Missing NIS Number" warnings)`);
}

const res = await purge();
if (purgeOnly) process.exit(res.leftUsers === 0 ? 0 : 1);
await seed();
console.log('\n✓ payroll demo reset complete.');
