/**
 * scripts/e2e/suites/payslipBatches.mjs
 *
 * E2E for the Payslip Batches register (§15.5, F-10) — read model over
 * finance/payroll/payslip-batches/list. A batch = a locked run's payslip set.
 *
 * Covers:
 *   1. Access control — employee (no finance.payroll.view_all) is denied 403.
 *   2. Response shape — items[] + tabCounts (5 tabs) + aggregates + total/asOf.
 *   3. Count aggregation — generated / rendered (file_path) / delivered ('sent') /
 *      failed ('failed', latest delivery per payslip) computed correctly per batch.
 *   4. Lifecycle derivation — a batch with a failed delivery is 'attention'.
 *   5. Tab filter — tab=attention includes our seeded batch; tab=completed excludes it.
 *
 * Seeds directly via the service-role client (a locked run + 3 run lines + 3 payslips +
 * 2 deliveries); tagged with h.TAG and cleaned up in FK order.
 */

import { payrollRunSeed } from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  // ── Actors ──────────────────────────────────────────────────────────────────
  const mgrR = await acquireActors('finance_manager', 1, { pay_basis: 'salary', monthly_salary: 10000 });
  const empR = await acquireActors('employee', 3, {}, {}, { forceSynthetic: true });
  const [fmgr] = mgrR.actors;
  const emps = empR.actors;
  const createdUserIds = [...mgrR.createdIds, ...empR.createdIds];

  const T = {
    mgr: mint({ id: fmgr.id, username: fmgr.username, role: 'finance_manager', department_id: fmgr.department_id ?? null }),
    emp: mint({ id: emps[0].id, username: emps[0].username, role: 'employee', department_id: emps[0].department_id ?? null }),
  };

  const ctx = { payGroupId: null, runId: null, lineIds: [], payslipIds: [], deliveryIds: [] };

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  h.onCleanup(async () => {
    if (ctx.deliveryIds.length) await h.mustDelete('finance_payslip_deliveries', q => q.in('id', ctx.deliveryIds));
    if (ctx.payslipIds.length)  await h.mustDelete('finance_payslips', q => q.in('id', ctx.payslipIds));
    if (ctx.lineIds.length)     await h.mustDelete('finance_payroll_run_lines', q => q.in('id', ctx.lineIds));
    if (ctx.runId) {
      await h.mustDelete('app_events',  q => q.eq('source_entity_id', ctx.runId));
      await h.mustDelete('hr_audit_log', q => q.eq('record_id', ctx.runId));
      await h.mustDelete('finance_payroll_runs', q => q.eq('id', ctx.runId));
    }
    if (ctx.payGroupId) await h.mustDelete('finance_pay_groups', q => q.eq('id', ctx.payGroupId));
    if (createdUserIds.length) await h.mustDelete('app_users', q => q.in('id', createdUserIds));
  });

  // ── Lookups ──────────────────────────────────────────────────────────────────
  const { data: vsn } = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).limit(1).single();
  expect(vsn?.id, 'an active statutory version must exist for seeding');

  // ── Seed a unique pay group + a locked run ─────────────────────────────────────
  const { data: pg, error: pgErr } = await sb.from('finance_pay_groups')
    .insert({ code: `${TAG}-PSB`, name: `${TAG} Payslip Batch Group`, frequency: 'monthly', active: true })
    .select('id').single();
  expect(!pgErr, `seed pay group: ${pgErr?.message}`);
  ctx.payGroupId = pg.id;

  const runRow = payrollRunSeed({
    run_no: `${TAG}-PSB-RUN`,
    periodStart: '2099-05-01',
    runType: 'scheduled',
    statutory_version_id: vsn.id,
    status: 'locked',
    pay_group_id: pg.id,
    pay_group: `${TAG} Payslip Batch Group`,
    gross_total: 30000, net_total: 24000, deduction_total: 6000, employee_count: 3,
    created_by: fmgr.id,
  });
  const { data: runData, error: runErr } = await sb.from('finance_payroll_runs').insert(runRow).select('id').single();
  expect(!runErr, `seed run: ${runErr?.message}`);
  ctx.runId = runData.id;

  // Run lines (one per employee) — payslips FK to these.
  for (const e of emps) {
    const { data: line, error: lErr } = await sb.from('finance_payroll_run_lines')
      .insert({ run_id: ctx.runId, employee_id: e.id, base: 8000, gross: 10000, net: 8000 })
      .select('id').single();
    expect(!lErr, `seed run line: ${lErr?.message}`);
    ctx.lineIds.push(line.id);
  }

  // Payslips: p0 rendered (file_path) + delivered, p1 rendered + delivery failed, p2 generated-only.
  const payslipSpecs = [
    { file_path: 'payslips/p0.pdf', delivery: 'sent' },
    { file_path: 'payslips/p1.pdf', delivery: 'failed' },
    { file_path: null,              delivery: null },
  ];
  for (let i = 0; i < emps.length; i++) {
    const spec = payslipSpecs[i];
    const { data: ps, error: psErr } = await sb.from('finance_payslips')
      .insert({ payslip_no: `${TAG}-PS-${i}`, run_id: ctx.runId, run_line_id: ctx.lineIds[i], employee_id: emps[i].id, file_path: spec.file_path })
      .select('id').single();
    expect(!psErr, `seed payslip ${i}: ${psErr?.message}`);
    ctx.payslipIds.push(ps.id);
    if (spec.delivery) {
      const { data: del, error: dErr } = await sb.from('finance_payslip_deliveries')
        .insert({ payslip_id: ps.id, run_id: ctx.runId, employee_id: emps[i].id, channel: 'email', status: spec.delivery, recipient: 'x@e2e.test' })
        .select('id').single();
      expect(!dErr, `seed delivery ${i}: ${dErr?.message}`);
      ctx.deliveryIds.push(del.id);
    }
  }

  // Helper: call the register + find our batch.
  const listBatches = (args, token = T.mgr) => api('finance/payroll/payslip-batches/list', token, args);
  const findBatch = items => items.find(it => it.reference === `${TAG}-PSB-RUN`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Access control — employee denied.
  // ─────────────────────────────────────────────────────────────────────────────
  await test('payslip-batches/list — 403 for employee role', async () => {
    const r = await listBatches({}, T.emp);
    fails(r, 'employee should be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Response shape.
  // ─────────────────────────────────────────────────────────────────────────────
  await test('payslip-batches/list — response shape (items + tabCounts + aggregates)', async () => {
    const r = await listBatches({});
    ok(r, 'list should succeed');
    const d = r.body.data;
    expect(Array.isArray(d.items), 'items must be an array');
    expect(typeof d.total === 'number', 'total must be a number');
    expect(typeof d.asOf === 'string', 'asOf must be a string');
    expect(['all', 'active', 'attention', 'scheduled', 'completed'].every(k => typeof d.tabCounts[k] === 'number'), 'tabCounts must have all 5 tabs');
    for (const k of ['activeBatches', 'rendered', 'delivered', 'failed']) {
      expect(typeof d.aggregates[k] === 'number', `aggregates.${k} must be a number`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Count aggregation + 4. lifecycle.
  // ─────────────────────────────────────────────────────────────────────────────
  await test('payslip-batches/list — batch shows correct counts + lifecycle', async () => {
    const r = await listBatches({ search: TAG });
    ok(r, 'scoped list should succeed');
    const b = findBatch(r.body.data.items);
    expect(b, 'our seeded batch must be in the result');
    expect(b.counts.generated === 3, `generated should be 3, got ${b.counts.generated}`);
    expect(b.counts.rendered === 2, `rendered should be 2 (file_path set), got ${b.counts.rendered}`);
    expect(b.counts.delivered === 1, `delivered should be 1 (sent), got ${b.counts.delivered}`);
    expect(b.counts.failed === 1, `failed should be 1, got ${b.counts.failed}`);
    // failed > 0 → attention
    expect(b.lifecycle === 'attention', `lifecycle should be attention, got ${b.lifecycle}`);
    // owner + template resolved, run state carried
    expect(b.owner.id === fmgr.id, `owner.id should be the creator, got ${b.owner.id}`);
    expect(b.runState === 'locked', `runState should be locked, got ${b.runState}`);
    expect(b.payGroup.name === `${TAG} Payslip Batch Group`, `payGroup name resolved, got ${b.payGroup.name}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Tab filter.
  // ─────────────────────────────────────────────────────────────────────────────
  await test('payslip-batches/list — tab=attention includes the batch, tab=completed excludes it', async () => {
    const rA = await listBatches({ search: TAG, tab: 'attention' });
    ok(rA, 'attention list should succeed');
    expect(findBatch(rA.body.data.items), 'attention tab should include our batch');

    const rC = await listBatches({ search: TAG, tab: 'completed' });
    ok(rC, 'completed list should succeed');
    expect(!findBatch(rC.body.data.items), 'completed tab should NOT include our attention batch');
  });
}
