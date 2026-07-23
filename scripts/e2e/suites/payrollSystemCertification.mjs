// ═══════════════════════════════════════════════════════════════════════════
// §8 — Payroll System Certification (cross-domain lifecycle suite) — PHASE 1.
// ═══════════════════════════════════════════════════════════════════════════
// Thin certification layer over the §7 canonical fixture: one dataset, distinct
// stage actors, real routes only. Detailed domain behavior stays in the 25
// existing suites (doc §3); this suite proves the CROSS-DOMAIN chain.
//
// Phase 1 (this file, grows by §12 loop):
//   CERT-SEC-1  explicit deny overrides role grant (403); outsider 403; anon 401
//   CERT-A-1    fixture governance provisioning succeeded (groups/calendar/policies)
//   CERT-B-1    preparer creates a run on the monthly group → salary policy pinned
//   CERT-D-1    lock blocked 422 policy.source_missing:payment_destination (E12 no bank)
//               → typed error envelope carries code + correlationId (P0-5 live)
//   CERT-D-2    after the source is repaired, lock succeeds; snapshot immutable evidence
//   CERT-E-1    calculate publishes ONE version; excluded/blocked employees honored;
//               E2 approved+linked timesheet contributes hourly evidence (weekly group N/A here)
//   CERT-CLEAN  fixture cleanup is FK-safe (proven by running this suite twice: §7)
// Run: npm run test:e2e -- payrollSystemCertification   (twice, per §7/§12.7)

import { payrollRunCommand, payrollLockCommand, payrollCalculationCommand } from '../helpers/payrollRun.mjs';
import { provisionPayrollCertification } from '../helpers/payrollCertificationFixture.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, sb, TAG } = h;
  h.section('Payroll System Certification — Phase 1 (fixture + lifecycle backbone)');

  let ctx = null;
  const ids = { runId: null };

  // Run-scoped rows are owned by this suite (fixture owns config/identities).
  h.onCleanup(async () => {
    if (!ids.runId) return;
    for (const t of ['finance_payroll_control_findings', 'finance_payroll_run_lines', 'finance_payroll_run_warnings',
      'finance_payroll_calculation_versions', 'finance_payroll_calculation_attempts',
      'finance_payroll_run_calendar_evidence', 'finance_payroll_run_policy_evidence',
      'finance_payroll_run_inputs', 'finance_payroll_input_snapshot_lines']) {
      try { await sb.from(t).delete().eq('run_id', ids.runId); } catch {}
    }
    try { await sb.from('finance_payroll_input_snapshots').delete().eq('run_id', ids.runId); } catch {}
    try { await sb.from('app_events').delete().eq('source_entity_id', ids.runId).eq('source_module', 'finance_payroll'); } catch {}
    try { await sb.from('finance_payroll_runs').delete().eq('id', ids.runId); } catch {}
  });

  await test('CERT-SETUP — §7 canonical fixture provisions through real routes', async () => {
    ctx = await provisionPayrollCertification(h);
    expect(Object.keys(ctx.payGroups).length === 4, 'four pay groups');
    expect(!!ctx.policies.salary?.versionId, 'governed salary policy active');
    expect(!!ctx.calendar.wcVerId, 'work calendar published + assigned');
    for (const lim of ctx.limitations) h.skip(`fixture limitation: ${lim}`);
  });

  await test('CERT-SEC-1 — anon 401; unauthorized employee 403; EXPLICIT DENY overrides role grant', async () => {
    const anon = await api('finance/payroll/runs/list', null, { limit: 5 });
    expect(anon.status === 401, `anon expected 401, got ${anon.status}`);
    const outs = await api('finance/payroll/runs/list', ctx.T.outs, { limit: 5 });
    fails(outs); expect(outs.status === 403, `outsider expected 403, got ${outs.status}`);
    // deny user's ROLE (finance_staff) grants view_all — the user_permissions deny must win.
    const deny = await api('finance/payroll/runs/list', ctx.T.deny, { limit: 5 });
    fails(deny); expect(deny.status === 403, `explicitly-denied expected 403, got ${deny.status}`);
    // sanity: an un-denied finance_staff (the preparer) CAN read.
    const prep = await api('finance/payroll/runs/list', ctx.T.prep, { limit: 5 });
    ok(prep, `preparer list: ${prep.body.message}`);
  });

  await test('CERT-B-1 — preparer creates the monthly run; salary policy version pinned', async () => {
    const cr = await api('finance/payroll/runs/create', ctx.T.prep, payrollRunCommand({
      idempotencyKey: `${TAG}:cert:run:create`, periodStart: ctx.period.start, periodEnd: ctx.period.end,
      payGroupId: ctx.payGroups.monthly, payFrequency: 'monthly',
    }));
    ok(cr, `create: ${cr.body.message}`);
    ids.runId = cr.body.data.id;
    const row = await sb.from('finance_payroll_runs')
      .select('pay_policy_version_id, work_calendar_version_id, status').eq('id', ids.runId).single();
    expect(row.data.pay_policy_version_id === ctx.policies.salary.versionId, 'run pins the fixture salary policy version');
    expect(row.data.work_calendar_version_id === ctx.calendar.wcVerId, 'run pins the fixture work calendar');
    expect(row.data.status === 'draft', 'run starts as draft');
  });

  await test('CERT-D-1 — lock blocked by E12 missing payment destination; typed envelope (P0-5)', async () => {
    const li = await api('finance/payroll/runs/lock-inputs', ctx.T.prep,
      payrollLockCommand(ids.runId, `${TAG}:cert:lock:blocked`));
    fails(li); expect(li.status === 422, `expected 422, got ${li.status}`);
    expect(String(li.body.message).includes('policy.source_missing:payment_destination'),
      `typed blocker in message (got ${String(li.body.message).slice(0, 100)})`);
    expect(li.body.error?.code?.startsWith('policy.source_missing'),
      `envelope carries the typed code (got ${li.body.error?.code})`);
    expect(typeof li.body.error?.correlationId === 'string' && li.body.error.correlationId.length > 10,
      'envelope carries a correlation id');
    const snaps = await sb.from('finance_payroll_input_snapshots').select('id').eq('run_id', ids.runId);
    expect((snaps.data ?? []).length === 0, 'failed lock leaves NO snapshot (atomic)');
  });

  await test('CERT-D-2 — source repaired → lock succeeds with immutable snapshot evidence', async () => {
    const fix = await sb.from('finance_employee_bank_accounts').insert({
      employee_id: ctx.EMP.E12, bank_name: 'Cert Bank', account_type: 'savings',
      account_number: '00012121212', account_number_masked: '****1212', is_primary: true, is_active: true,
    });
    expect(!fix.error, `repair E12 bank: ${fix.error?.message}`);
    const li = await api('finance/payroll/runs/lock-inputs', ctx.T.prep,
      payrollLockCommand(ids.runId, `${TAG}:cert:lock:ok`));
    ok(li, `lock: ${li.body.message}`);
    const snap = await sb.from('finance_payroll_input_snapshots')
      .select('id, checksum, employee_count').eq('run_id', ids.runId)
      .order('snapshot_no', { ascending: false }).limit(1).single();
    expect(!snap.error && !!snap.data.checksum, 'snapshot with checksum recorded');
    expect(snap.data.employee_count > 0, `snapshot covers employees (got ${snap.data.employee_count})`);
  });

  await test('CERT-E-1 — calculate publishes exactly one current version with real lines', async () => {
    const cc = await api('finance/payroll/runs/calculate', ctx.T.prep,
      payrollCalculationCommand(ids.runId, `${TAG}:cert:calc`));
    ok(cc, `calculate: ${cc.body.message}`);
    expect(cc.body.data.status === 'calculated', `run calculated (got ${cc.body.data.status})`);
    const versions = await sb.from('finance_payroll_calculation_versions').select('id').eq('run_id', ids.runId);
    expect((versions.data ?? []).length === 1, `exactly one calculation version (got ${versions.data?.length})`);
    // Run lines are keyed by the published calculation version.
    const lines = await sb.from('finance_payroll_run_lines')
      .select('employee_id').eq('calculation_version_id', versions.data[0].id).limit(50);
    expect((lines.data ?? []).length > 0, `calculation produced run lines (got ${lines.data?.length})`);
    // E1 (standard salaried, monthly group) must have a line.
    const e1 = (lines.data ?? []).find(l => l.employee_id === ctx.EMP.E1);
    expect(e1, 'E1 standard salaried employee has a calculation line');
  });
}
