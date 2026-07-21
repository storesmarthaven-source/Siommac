/**
 * scripts/e2e/suites/payrollRunsRegister.mjs
 *
 * E2E for the Payroll Runs Register slice (§15.2):
 *   POST /api/finance/payroll/runs/list          — keyset register + tab counts + readiness
 *   POST /api/finance/payroll/run-views/list     — saved views
 *   POST /api/finance/payroll/run-views/create   — create view (personal + team)
 *   POST /api/finance/payroll/run-views/update   — update view (ownership guard)
 *   POST /api/finance/payroll/run-views/delete   — delete view (ownership guard)
 *   POST /api/finance/payroll/runs/calendar      — schedule-derived calendar instances
 *
 * Approach: direct-seed deterministic run rows and a pay group rather than
 * going through the full API lifecycle, so the register tests are fast and stable.
 * The calendar test creates a real pay group via the API to verify schedule derivation.
 *
 * Assertion conventions (this harness — NOT Jest/Vitest):
 *   api(path, token, args)         — POST; returns { status, body }
 *   ok(response, msg)              — asserts response.body.success === true
 *   fails(response, msg)           — asserts response.body.success === false
 *   expect(condition, msg)         — plain boolean assertion (no matcher chain)
 */
import {
  payrollRunSeed,
  payrollPeriod,
} from '../helpers/payrollRun.mjs';

export const title = 'Finance — Payroll Runs Register (runs/list + run-views + runs/calendar)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  // ── Actors ──────────────────────────────────────────────────────────────────
  const mgrR  = await acquireActors('finance_manager', 2, { pay_basis: 'salary', monthly_salary: 10000 });
  const stfR  = await acquireActors('finance_staff',  1, { pay_basis: 'salary', monthly_salary: 8000 });
  const empR  = await acquireActors('employee',       1, {}, {}, { forceSynthetic: true });
  const [fmgr1, fmgr2] = mgrR.actors, [fstaff] = stfR.actors, [emp] = empR.actors;
  const createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

  const T = {
    mgr:   mint({ id: fmgr1.id,  username: fmgr1.username,  role: 'finance_manager', department_id: fmgr1.department_id ?? null }),
    mgr2:  mint({ id: fmgr2.id,  username: fmgr2.username,  role: 'finance_manager', department_id: fmgr2.department_id ?? null }),
    staff: mint({ id: fstaff.id, username: fstaff.username, role: 'finance_staff',   department_id: fstaff.department_id ?? null }),
    emp:   mint({ id: emp.id,    username: emp.username,     role: 'employee',        department_id: emp.department_id ?? null }),
  };

  // ── Context ─────────────────────────────────────────────────────────────────
  const ctx = {
    versionId: null,
    runIds: [],
    cvIds: [],
    snapIds: [],
    findingIds: [],
    fundingConfIds: [],
    payGroupId: null,
    viewIds: [],
    runNos: [],
  };

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  h.onCleanup(async () => {
    if (ctx.viewIds.length) {
      await h.mustDelete('finance_payroll_run_views', q => q.in('id', ctx.viewIds));
    }
    const runIds = ctx.runIds;
    if (runIds.length) {
      await sb.from('finance_payroll_runs').update({
        current_calculation_version_id: null, current_input_snapshot_id: null,
      }).in('id', runIds);
      for (const t of ['finance_payroll_input_lock_receipts','finance_payroll_lifecycle_command_receipts',
        'finance_payroll_calculation_attempts'])
        await h.mustDelete(t, q => q.in('run_id', runIds));
      if (ctx.fundingConfIds.length) await h.mustDelete('finance_payroll_funding_confirmations', q => q.in('id', ctx.fundingConfIds));
      if (ctx.findingIds.length) await h.mustDelete('finance_payroll_control_findings', q => q.in('id', ctx.findingIds));
      if (ctx.cvIds.length)      await h.mustDelete('finance_payroll_calculation_versions', q => q.in('id', ctx.cvIds));
      if (ctx.snapIds.length)    await h.mustDelete('finance_payroll_input_snapshots',      q => q.in('id', ctx.snapIds));
      await h.mustDelete('finance_payroll_run_warnings', q => q.in('run_id', runIds));
      await h.mustDelete('notifications',  q => q.in('source_id', runIds));
      await h.mustDelete('handoff_outbox', q => q.in('source_entity_id', runIds));
      await h.mustDelete('hr_audit_log',   q => q.in('record_id', runIds));
      await h.mustDelete('app_events',     q => q.in('source_entity_id', runIds));
      await h.mustDelete('finance_payroll_runs', q => q.in('id', runIds));
    }
    if (ctx.payGroupId) {
      await h.mustDelete('finance_employee_pay_group_assignments', q => q.eq('pay_group_id', ctx.payGroupId));
      await h.mustDelete('finance_pay_groups', q => q.eq('id', ctx.payGroupId));
    }
    if (createdUserIds.length) await h.mustDelete('app_users', q => q.in('id', createdUserIds));
  });

  // ── Lookup statutory version ───────────────────────────────────────────────
  const { data: vsnRow } = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).limit(1).single();
  ctx.versionId = vsnRow?.id;
  if (!ctx.versionId) {
    // Fall back to any version
    const { data: anyVsn } = await sb.from('finance_statutory_versions').select('id').order('created_at', { ascending: false }).limit(1).single();
    ctx.versionId = anyVsn?.id;
  }
  expect(ctx.versionId, 'statutory version must exist for seeding');

  // ── Seed helper ─────────────────────────────────────────────────────────────
  async function seedRun({ key, status, runType = 'scheduled', extraPayGroupId = null }) {
    const periodStart = payrollPeriod('payrollRunsRegister', key, TAG);
    const row = payrollRunSeed({
      run_no: `${TAG}-REG-${key}`,
      periodStart,
      runType,
      statutory_version_id: ctx.versionId,
      status,
      pay_group_id: extraPayGroupId,
      pay_group: extraPayGroupId ? 'REG E2E Group' : null,
      gross_total: 5000,
      net_total: 4000,
      deduction_total: 1000,
      employee_count: 1,
      created_by: fstaff.id,
    });
    const { data, error } = await sb.from('finance_payroll_runs').insert(row).select('id').single();
    expect(!error, `seed run ${key}: ${error?.message}`);
    ctx.runIds.push(data.id);
    ctx.runNos.push(`${TAG}-REG-${key}`);
    return data.id;
  }

  async function seedCalcChain(runId, { gross, net, emp }) {
    const { data: snap, error: se } = await sb.from('finance_payroll_input_snapshots').insert({
      run_id: runId, snapshot_no: 1, checksum: `reg-snap-${runId}`,
      employee_count: emp, input_count: emp,
    }).select('id').single();
    expect(!se, `snap: ${se?.message}`); ctx.snapIds.push(snap.id);
    const { data: cv, error: ce } = await sb.from('finance_payroll_calculation_versions').insert({
      run_id: runId, input_snapshot_id: snap.id, version_no: 1,
      checksum: `reg-cv-${runId}`, employee_count: emp,
      gross_total: gross, deduction_total: Math.max(0, gross - net), net_total: net,
      nis_employer_total: 0, statutory_version_id: ctx.versionId, published_by: fstaff.id,
    }).select('id').single();
    expect(!ce, `cv: ${ce?.message}`); ctx.cvIds.push(cv.id);
    await sb.from('finance_payroll_runs').update({
      current_calculation_version_id: cv.id, current_input_snapshot_id: snap.id,
    }).eq('id', runId);
    return cv.id;
  }

  async function seedFinding(runId, cvId, severity) {
    const { data, error } = await sb.from('finance_payroll_control_findings').insert({
      run_id: runId, calculation_version_id: cvId,
      source_type: 'e2e_reg', source_id: `${TAG}:reg-finding-${runId}`,
      finding_type: 'e2e_control', domain: 'variance', severity, state: 'open',
      title: `REG test ${severity}`, detail: 'e2e register test',
    }).select('id').single();
    expect(!error, `finding: ${error?.message}`); ctx.findingIds.push(data.id);
    return data.id;
  }

  // Seed ONE funding confirmation (latest) against a run's current calc version.
  async function seedFunding(runId, cvId, amount) {
    const { data, error } = await sb.from('finance_payroll_funding_confirmations').insert({
      run_id: runId, calculation_version_id: cvId, confirmation_no: 1,
      confirmed_amount: amount, currency: 'TTD',
      confirmation_reference: `${TAG}-FUND-${runId}`, checksum: `reg-fund-${runId}`,
      confirmed_by: fstaff.id,
    }).select('id').single();
    expect(!error, `funding: ${error?.message}`); ctx.fundingConfIds.push(data.id);
    return data.id;
  }

  // ── Seed test runs ──────────────────────────────────────────────────────────
  // runA: draft          → in_progress tab
  // runB: pending_approval → approval tab
  // runC: calculation_failed → attention tab (by status)
  // runD: released       → released tab
  // runE: calculated with open blocker → attention tab (by blocker)
  const runAId = await seedRun({ key: 'runA', status: 'draft' });
  const runBId = await seedRun({ key: 'runB', status: 'pending_approval' });
  const runCId = await seedRun({ key: 'runC', status: 'calculation_failed' });
  const runDId = await seedRun({ key: 'runD', status: 'released' });
  const runEId = await seedRun({ key: 'runE', status: 'calculated' });

  // runE needs a calc version and a blocker finding
  const runECvId = await seedCalcChain(runEId, { gross: 6000, net: 5000, emp: 1 });
  await seedFinding(runEId, runECvId, 'blocker');
  // Partial funding confirmation on runE (eff_net 5000, confirmed 3000 → gap 2000).
  await seedFunding(runEId, runECvId, 3000);

  // ── Helper: call runs/list ─────────────────────────────────────────────────
  async function listRuns(args, token = T.mgr) {
    return api('finance/payroll/runs/list', token, args);
  }

  // Helper: find our seeded run by reference in a result
  function findByRef(items, ref) {
    return items.find(it => it.reference === `${TAG}-REG-${ref}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Unauthorized — employee cannot call runs/list
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — 403 for employee role', async () => {
    const r = await listRuns({}, T.emp);
    fails(r, 'employee should be denied access');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Basic list returns items
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — returns items for finance_manager', async () => {
    const r = await listRuns({});
    ok(r, 'list should succeed');
    const { items, nextCursor, total, tabCounts } = r.body.data;
    expect(Array.isArray(items), 'items must be array');
    expect(typeof total === 'number', 'total must be number');
    expect(typeof tabCounts === 'object' && tabCounts !== null, 'tabCounts must be object');
    expect(['all','in_progress','approval','attention','released'].every(k => typeof tabCounts[k] === 'number'),
      'tabCounts must have all tab keys');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Tab counts match our seeded data
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — tabCounts include our seeded runs', async () => {
    const r = await listRuns({});
    ok(r, 'list should succeed');
    const { tabCounts } = r.body.data;
    // Our seeded set: A(draft)→in_progress, B(pending_approval)→approval, C(calc_failed)→attention,
    //   D(released)→released, E(calculated+blocker)→attention.
    // all includes A+B+C+D+E (not cancelled); system may have others — just check lower bounds.
    expect(tabCounts.all >= 5, `tabCounts.all >= 5, got ${tabCounts.all}`);
    expect(tabCounts.in_progress >= 1, `tabCounts.in_progress >= 1, got ${tabCounts.in_progress}`);  // at least A
    expect(tabCounts.approval >= 1, `tabCounts.approval >= 1, got ${tabCounts.approval}`);            // at least B
    expect(tabCounts.attention >= 2, `tabCounts.attention >= 2, got ${tabCounts.attention}`);         // C (status) + E (blocker)
    expect(tabCounts.released >= 1, `tabCounts.released >= 1, got ${tabCounts.released}`);             // D
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Tab filter: in_progress
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — tab=in_progress includes draft run (A), excludes approval/attention/released', async () => {
    const r = await listRuns({ tab: 'in_progress', runTypes: ['scheduled'] });
    ok(r, 'should succeed');
    const { items } = r.body.data;
    const itemRefs = items.map(i => i.reference);
    expect(itemRefs.includes(`${TAG}-REG-runA`), 'runA (draft) should be in in_progress');
    expect(!itemRefs.includes(`${TAG}-REG-runB`), 'runB (pending_approval) should NOT be in in_progress');
    expect(!itemRefs.includes(`${TAG}-REG-runC`), 'runC (calculation_failed) should NOT be in in_progress');
    expect(!itemRefs.includes(`${TAG}-REG-runD`), 'runD (released) should NOT be in in_progress');
    // runE is calculated but has blocker → attention, NOT in_progress? Let's check:
    // in_progress = status in (draft, input_locked, calculated)
    // runE is calculated → IN in_progress (tab is independent of blocker for in_progress)
    expect(itemRefs.includes(`${TAG}-REG-runE`), 'runE (calculated) should be in in_progress');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Tab filter: approval
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — tab=approval returns pending_approval run (B)', async () => {
    const r = await listRuns({ tab: 'approval', runTypes: ['scheduled'] });
    ok(r, 'should succeed');
    const { items } = r.body.data;
    const itemRefs = items.map(i => i.reference);
    expect(itemRefs.includes(`${TAG}-REG-runB`), 'runB should be in approval tab');
    expect(!itemRefs.includes(`${TAG}-REG-runA`), 'runA should NOT be in approval tab');
    expect(!itemRefs.includes(`${TAG}-REG-runD`), 'runD should NOT be in approval tab');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Tab filter: attention — C by status, E by blocker
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — tab=attention includes calc_failed (C) and blocker run (E)', async () => {
    const r = await listRuns({ tab: 'attention', runTypes: ['scheduled'] });
    ok(r, 'should succeed');
    const { items } = r.body.data;
    const itemRefs = items.map(i => i.reference);
    expect(itemRefs.includes(`${TAG}-REG-runC`), 'runC (calc_failed) should be in attention');
    expect(itemRefs.includes(`${TAG}-REG-runE`), 'runE (calculated + blocker) should be in attention');
    expect(!itemRefs.includes(`${TAG}-REG-runD`), 'runD (released) should NOT be in attention');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Tab filter: released
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — tab=released returns released run (D)', async () => {
    const r = await listRuns({ tab: 'released', runTypes: ['scheduled'] });
    ok(r, 'should succeed');
    const { items } = r.body.data;
    const itemRefs = items.map(i => i.reference);
    expect(itemRefs.includes(`${TAG}-REG-runD`), 'runD should be in released tab');
    expect(!itemRefs.includes(`${TAG}-REG-runA`), 'runA should NOT be in released tab');
    expect(!itemRefs.includes(`${TAG}-REG-runB`), 'runB should NOT be in released tab');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Item shape — verify PayrollRunListItem contract
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — item shape matches contract (PayrollRunListItem)', async () => {
    // Find runE (has a calc version, so effective totals should come from cv)
    const r = await listRuns({ states: ['calculated'] });
    ok(r, 'should succeed');
    const item = findByRef(r.body.data.items, 'runE');
    expect(item, 'runE must be in the result');

    // Required top-level fields
    expect(typeof item.id === 'string', 'id must be string');
    expect(typeof item.reference === 'string', 'reference must be string');
    expect(['scheduled','off_cycle','correction','final_pay'].includes(item.runType), `runType invalid: ${item.runType}`);
    expect(typeof item.state === 'string', 'state must be string');

    // payGroup shape
    expect(typeof item.payGroup === 'object' && item.payGroup !== null, 'payGroup must be object');

    // period shape
    expect(typeof item.period.startsOn === 'string', 'period.startsOn must be string');
    expect(typeof item.period.endsOn === 'string', 'period.endsOn must be string');

    // population shape
    expect(typeof item.population.included === 'number', 'population.included must be number');
    expect(typeof item.population.excluded === 'number', 'population.excluded must be number');

    // totals shape
    expect(item.totals.currency === 'TTD', `totals.currency must be TTD, got ${item.totals.currency}`);
    expect(typeof item.totals.gross === 'number', 'totals.gross must be number');
    expect(typeof item.totals.net === 'number', 'totals.net must be number');

    // readiness shape
    expect(typeof item.readiness.state === 'string', 'readiness.state must be string');
    expect(['not_started','in_progress','blocked','ready','released'].includes(item.readiness.state),
      `readiness.state invalid: ${item.readiness.state}`);
    expect(item.readiness.percent === null, 'register rows: readiness.percent always null');
    expect(typeof item.readiness.blockers === 'number', 'readiness.blockers must be number');
    expect(typeof item.readiness.warnings === 'number', 'readiness.warnings must be number');
    expect(typeof item.readiness.label === 'string', 'readiness.label must be string');

    // runE has 1 blocker → readiness should be 'blocked'
    expect(item.readiness.blockers === 1, `runE should have 1 blocker, got ${item.readiness.blockers}`);
    expect(item.readiness.state === 'blocked', `runE readiness.state should be blocked, got ${item.readiness.state}`);

    // owner shape (created_by resolved to a display name — never a raw id)
    expect(typeof item.owner === 'object' && item.owner !== null, 'owner must be object');
    expect(item.owner.id === fstaff.id, `owner.id must be the creator ${fstaff.id}, got ${item.owner.id}`);
    expect(typeof item.owner.name === 'string' && item.owner.name.length > 0, 'owner.name must be a non-empty string');
    expect(item.owner.name !== item.owner.id, 'owner.name must be resolved, not the raw id');

    expect(typeof item.updatedAt === 'string', 'updatedAt must be string');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8b. Money aggregates (Funding Gap / Closed Net KPIs) — scoped to our TAG.
  //   Fundable (cv + eff_net>0 + not closed): runE (eff_net 5000, confirmed 3000).
  //   Closed (released/exported): runD (net 4000, no cv → run.net_total).
  //   A/B/C have no calc version → NOT fundable, NOT closed.
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — aggregates: funding gap + closed net over the filtered scope', async () => {
    const r = await listRuns({ search: TAG });
    ok(r, 'scoped list should succeed');
    const { aggregates: a } = r.body.data;
    expect(typeof a === 'object' && a !== null, 'aggregates must be present');
    for (const k of ['fundingRequired', 'fundingConfirmed', 'fundingGap', 'closedNet']) {
      expect(a[k] && typeof a[k].amount === 'number' && a[k].currency === 'TTD',
        `aggregates.${k} must be a TTD MoneyValue, got ${JSON.stringify(a[k])}`);
    }
    // Exact math for our isolated seed set (runE fundable, runD closed).
    expect(a.fundingRequired.amount === 5000, `fundingRequired should be 5000, got ${a.fundingRequired.amount}`);
    expect(a.fundingConfirmed.amount === 3000, `fundingConfirmed should be 3000, got ${a.fundingConfirmed.amount}`);
    expect(a.fundingGap.amount === 2000, `fundingGap should be max(0,5000-3000)=2000, got ${a.fundingGap.amount}`);
    expect(a.closedNet.amount === 4000, `closedNet should be runD net 4000, got ${a.closedNet.amount}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. Readiness matches registerReadinessState classification
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — readiness.state matches controlCenter classification', async () => {
    // draft + no blockers → not_started
    const rA = await listRuns({ states: ['draft'] });
    ok(rA, 'should succeed');
    const itemA = findByRef(rA.body.data.items, 'runA');
    expect(itemA, 'runA must be present');
    expect(itemA.readiness.state === 'not_started', `runA readiness should be not_started, got ${itemA.readiness.state}`);

    // released → released
    const rD = await listRuns({ states: ['released'] });
    ok(rD, 'should succeed');
    const itemD = findByRef(rD.body.data.items, 'runD');
    expect(itemD, 'runD must be present');
    expect(itemD.readiness.state === 'released', `runD readiness should be released, got ${itemD.readiness.state}`);

    // calculated + blockers > 0 → blocked
    const rE = await listRuns({ states: ['calculated'] });
    ok(rE, 'should succeed');
    const itemE = findByRef(rE.body.data.items, 'runE');
    expect(itemE, 'runE must be present');
    expect(itemE.readiness.state === 'blocked', `runE readiness should be blocked, got ${itemE.readiness.state}`);
    expect(itemE.readiness.blockers === 1, `runE should have 1 blocker, got ${itemE.readiness.blockers}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Keyset pagination — no duplicates or missing items across pages
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — keyset pagination: no duplicates or missing items', async () => {
    // Page through with limit=2 to force multiple pages
    const allIds = [];
    let cursor = undefined;
    let pages = 0;
    do {
      const r = await listRuns({ limit: 2, cursor, sort: 'updated_desc' });
      ok(r, `page ${pages + 1} should succeed`);
      const { items, nextCursor } = r.body.data;
      for (const item of items) {
        expect(!allIds.includes(item.id), `duplicate id across pages: ${item.id}`); // no duplicates
        allIds.push(item.id);
      }
      cursor = nextCursor;
      pages++;
      if (pages > 200) break; // safety guard — should never hit
    } while (cursor);

    // Verify all our seeded run IDs appear exactly once
    for (const runId of ctx.runIds) {
      const count = allIds.filter(id => id === runId).length;
      expect(count === 1, `seeded run ${runId} should appear exactly once, got ${count}`); // each seeded run appears exactly once
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. Malformed cursor → 422
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — malformed cursor → 422', async () => {
    const r = await listRuns({ cursor: 'not-a-valid-cursor-at-all-!!!' });
    fails(r, 'malformed cursor should fail');
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. Cursor mismatch (filters changed) → 422
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — cursor from different sort → 422', async () => {
    // Get a cursor with sort=pay_date_desc
    const r1 = await listRuns({ limit: 1, sort: 'pay_date_desc' });
    ok(r1, 'first page should succeed');
    const { nextCursor } = r1.body.data;
    if (!nextCursor) return; // only 0 or 1 items — can't test cursor mismatch
    // Replay with a different sort
    const r2 = await listRuns({ cursor: nextCursor, sort: 'updated_desc' });
    fails(r2, 'cursor mismatch should fail');
    expect(r2.status === 422, `expected 422, got ${r2.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. State filter
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — states filter restricts to requested statuses', async () => {
    const r = await listRuns({ states: ['draft', 'released'] });
    ok(r, 'should succeed');
    for (const item of r.body.data.items) {
      expect(['draft', 'released'].includes(item.state), `state ${item.state} not in requested filter`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. Run type filter
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — runTypes filter restricts to scheduled', async () => {
    const r = await listRuns({ runTypes: ['scheduled'] });
    ok(r, 'should succeed');
    for (const item of r.body.data.items) {
      expect(item.runType === 'scheduled', `runType ${item.runType} not scheduled`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 15. Period filter
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — period filter: future range excludes our seeded runs', async () => {
    const r = await listRuns({ periodFrom: '2099-01-01', periodTo: '2099-12-31' });
    ok(r, 'should succeed');
    // None of our seeded runs fall in year 2099
    const itemRefs = r.body.data.items.map(i => i.reference);
    for (const ref of ctx.runNos) {
      expect(!itemRefs.includes(ref), `${ref} should not be in 2099 range`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 16. Finance_staff can also list (has view_all permission)
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — finance_staff can list runs', async () => {
    const r = await listRuns({}, T.staff);
    ok(r, 'finance_staff should be able to list runs');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 17. Read-only: runs/list emits NO app_events / audit_logs
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/list — read-only: no app_events written', async () => {
    const beforeCount = await sb.from('app_events').select('id', { count: 'exact', head: true });
    await listRuns({});
    const afterCount = await sb.from('app_events').select('id', { count: 'exact', head: true });
    expect(afterCount.count === beforeCount.count,
      `read-only: app_events count changed ${beforeCount.count} -> ${afterCount.count}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Run-Views CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  let personalViewId = null;
  let teamViewId = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // 18. Unauthorized list (employee)
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/list — 403 for employee', async () => {
    const r = await api('finance/payroll/run-views/list', T.emp, {});
    fails(r, 'employee should be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 19. Create personal view
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/create — create personal view', async () => {
    const r = await api('finance/payroll/run-views/create', T.staff, {
      name: `${TAG} My Register View`,
      scope: 'personal',
      filters: { states: ['draft', 'calculated'], sort: 'updated_desc' },
    });
    ok(r, 'create personal view');
    const view = r.body.data;
    expect(view.name === `${TAG} My Register View`, `name mismatch: ${view.name}`);
    expect(view.scope === 'personal', `scope should be personal, got ${view.scope}`);
    expect(view.isOwn === true, 'isOwn should be true for creator');
    expect(view.ownerId === fstaff.id, `ownerId should be ${fstaff.id}, got ${view.ownerId}`);
    expect(view.filters.sort === 'updated_desc', `filters.sort should persist, got ${view.filters.sort}`);
    personalViewId = view.id;
    ctx.viewIds.push(view.id);

    // Verify audit_log written
    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('action', 'payroll_run_view.created').eq('record_id', view.id).limit(1);
    expect(audit?.length === 1, 'audit_log payroll_run_view.created must be written');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 20. Create team view — staff lacks manage_team → 403
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/create — team scope rejected for finance_staff (no manage_team perm)', async () => {
    const r = await api('finance/payroll/run-views/create', T.staff, {
      name: `${TAG} Staff Team View`,
      scope: 'team',
      filters: {},
    });
    fails(r, 'finance_staff should not be able to create team views');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 21. Create team view — manager has manage_team → succeeds + app_event emitted
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/create — team scope allowed for finance_manager + app_event written', async () => {
    const r = await api('finance/payroll/run-views/create', T.mgr, {
      name: `${TAG} Shared Register View`,
      scope: 'team',
      filters: { states: ['calculation_failed', 'calculated'], runTypes: ['scheduled'] },
    });
    ok(r, 'create team view');
    const view = r.body.data;
    expect(view.scope === 'team', `scope should be team, got ${view.scope}`);
    expect(view.ownerId === fmgr1.id, `ownerId should be ${fmgr1.id}, got ${view.ownerId}`);
    teamViewId = view.id;
    ctx.viewIds.push(view.id);

    // app_event for team publish
    const { data: ev } = await sb.from('app_events')
      .select('id').eq('event_type', 'finance.payroll.run_view.team_created').eq('source_entity_id', view.id).limit(1);
    expect(ev?.length === 1, 'app_event finance.payroll.run_view.team_created must be written');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 22. List views — personal + team returned; non-owner's personal NOT included
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/list — returns own personal + all team views; excludes other personal', async () => {
    // Staff's view list: their personal view + the team view; NOT the manager's personal (if any)
    const r = await api('finance/payroll/run-views/list', T.staff, {});
    ok(r, 'list should succeed');
    const viewIds = r.body.data.map(v => v.id);
    expect(viewIds.includes(personalViewId), 'own personal view must be listed');  // own personal
    expect(viewIds.includes(teamViewId), 'team view must be listed');              // team view from manager
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 23. Update personal view — owner can update
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/update — owner can update their personal view', async () => {
    const r = await api('finance/payroll/run-views/update', T.staff, {
      id: personalViewId,
      name: `${TAG} My Register View Updated`,
      filters: { states: ['released'] },
    });
    ok(r, 'update should succeed');
    expect(r.body.data.name === `${TAG} My Register View Updated`, `name should update, got ${r.body.data.name}`);
    expect(JSON.stringify(r.body.data.filters.states) === JSON.stringify(['released']),
      `filters.states should update, got ${JSON.stringify(r.body.data.filters.states)}`);

    // audit_log written
    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('action', 'payroll_run_view.updated').eq('record_id', personalViewId).limit(1);
    expect(audit?.length === 1, 'audit_log payroll_run_view.updated must be written');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 24. Update personal view — non-owner blocked → 403
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/update — non-owner cannot update personal view → 403', async () => {
    const r = await api('finance/payroll/run-views/update', T.mgr2, {
      id: personalViewId,
      name: 'Stolen',
    }); // different manager, not the owner (staff owns this)
    fails(r, 'non-owner update should be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 25. Update team view — non-owner WITH manage_team allowed
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/update — non-owner manager WITH manage_team can update team view', async () => {
    const r = await api('finance/payroll/run-views/update', T.mgr2, {
      id: teamViewId,
      name: `${TAG} Shared Register View v2`,
    }); // different manager but has manage_team
    ok(r, 'team view update by non-owner manager should succeed');
    expect(r.body.data.name === `${TAG} Shared Register View v2`, `name should update, got ${r.body.data.name}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 26. Update team view — staff WITHOUT manage_team → 403
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/update — staff without manage_team cannot update team view → 403', async () => {
    const r = await api('finance/payroll/run-views/update', T.staff, {
      id: teamViewId,
      name: 'Stolen Team View',
    });
    fails(r, 'staff should not be able to update team view');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 27. Delete view — non-owner blocked → 403 (personal view)
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/delete — non-owner cannot delete personal view → 403', async () => {
    const r = await api('finance/payroll/run-views/delete', T.mgr, { id: personalViewId });
    fails(r, 'non-owner delete should be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 28. Delete view — owner can delete
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/delete — owner can delete personal view', async () => {
    const r = await api('finance/payroll/run-views/delete', T.staff, { id: personalViewId });
    ok(r, 'delete should succeed');
    ctx.viewIds = ctx.viewIds.filter(id => id !== personalViewId);

    // Verify it's gone
    const { data: gone } = await sb.from('finance_payroll_run_views').select('id').eq('id', personalViewId);
    expect((gone?.length ?? 0) === 0, 'personal view should be deleted');

    // Audit log written
    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('action', 'payroll_run_view.deleted').eq('record_id', personalViewId).limit(1);
    expect(audit?.length === 1, 'audit_log payroll_run_view.deleted must be written');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 29. Delete team view — app_event emitted
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/delete — deleting team view emits app_event', async () => {
    const r = await api('finance/payroll/run-views/delete', T.mgr, { id: teamViewId });
    ok(r, 'team view delete should succeed');
    ctx.viewIds = ctx.viewIds.filter(id => id !== teamViewId);

    // app_event for team delete
    const { data: ev } = await sb.from('app_events')
      .select('id').eq('event_type', 'finance.payroll.run_view.team_deleted').eq('source_entity_id', teamViewId).limit(1);
    expect(ev?.length === 1, 'app_event finance.payroll.run_view.team_deleted must be written');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 30. Delete non-existent view → 404
  // ─────────────────────────────────────────────────────────────────────────────
  await test('run-views/delete — non-existent id → 404', async () => {
    const r = await api('finance/payroll/run-views/delete', T.mgr, { id: '00000000-0000-4000-8000-000000000000' });
    fails(r, 'unknown id should return 404');
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Calendar
  // ═══════════════════════════════════════════════════════════════════════════

  // Create a pay group for calendar testing
  const pgCode = `${TAG}-CAL-GRP`.slice(0, 20).replace(/[^a-z0-9-]/gi, '_');
  const pgR = await api('finance/payroll/pay-groups/create', T.mgr, {
    code:     pgCode,
    name:     `${TAG} Calendar Test Group`,
    frequency: 'monthly',
    default_pay_day: 25,
    default_cutoff_offset_days: 5,
  });
  ok(pgR, 'create pay group');
  ctx.payGroupId = pgR.body.data.id;

  // Window: the current calendar month + 1 ahead (always <= 186 days)
  const now = new Date();
  const calFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const calToDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
  const calTo = calToDate.toISOString().slice(0, 10);

  // ─────────────────────────────────────────────────────────────────────────────
  // 31. Calendar — 403 for employee
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/calendar — 403 for employee', async () => {
    const r = await api('finance/payroll/runs/calendar', T.emp, { from: calFrom, to: calTo });
    fails(r, 'employee should be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 32. Calendar — window too wide → 400
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/calendar — window > 186 days → 400', async () => {
    const r = await api('finance/payroll/runs/calendar', T.mgr, {
      from: '2026-01-01',
      to:   '2026-08-07', // 218 days — too wide
    });
    fails(r, 'too-wide window should fail');
    expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 33. Calendar — from > to → 400
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/calendar — from after to → 400', async () => {
    const r = await api('finance/payroll/runs/calendar', T.mgr, {
      from: '2026-03-01',
      to:   '2026-02-01',
    });
    fails(r, 'from > to should fail');
    expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 34. Calendar — schedule-derived instances appear
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/calendar — monthly group produces schedule-derived instances', async () => {
    const r = await api('finance/payroll/runs/calendar', T.mgr, {
      from:        calFrom,
      to:          calTo,
      payGroupIds: [ctx.payGroupId],
    });
    ok(r, 'calendar should succeed');
    const { window: w, instances, asOf } = r.body.data;
    expect(w.from === calFrom, `window.from should be ${calFrom}, got ${w.from}`);
    expect(w.to === calTo, `window.to should be ${calTo}, got ${w.to}`);
    expect(typeof asOf === 'string', 'asOf must be string');
    expect(Array.isArray(instances), 'instances must be array');
    // A 2-month monthly window should yield at least 1 instance
    expect(instances.length >= 1, `expected >= 1 instance, got ${instances.length}`);

    // All instances belong to our pay group
    for (const inst of instances) {
      expect(inst.payGroup.id === ctx.payGroupId, `instance payGroup.id mismatch: ${inst.payGroup.id}`);
      expect(inst.payGroup.frequency === 'monthly', `instance frequency should be monthly, got ${inst.payGroup.frequency}`);
    }

    // Key is deterministic: payGroupId:periodStart:periodEnd
    for (const inst of instances) {
      expect(inst.key === `${inst.payGroup.id}:${inst.period.startsOn}:${inst.period.endsOn}`,
        `instance key not deterministic: ${inst.key}`);
    }

    // Since no run has been created for this group yet, all instances have run=null
    for (const inst of instances) {
      expect(inst.run === null, `unlinked instance should have run=null, got ${JSON.stringify(inst.run)}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 35. Calendar — instance with a linked run (run=null and run=object)
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/calendar — instance with linked scheduled run has run != null', async () => {
    // Get the calendar to find one instance
    const r1 = await api('finance/payroll/runs/calendar', T.mgr, {
      from:        calFrom,
      to:          calTo,
      payGroupIds: [ctx.payGroupId],
    });
    ok(r1, 'calendar should succeed');
    const { instances } = r1.body.data;
    if (instances.length === 0) return; // no instances in window — skip

    const inst = instances[0];
    // Create a scheduled run matching this instance's period
    const { data: newRun, error: nr } = await sb.from('finance_payroll_runs').insert(
      payrollRunSeed({
        run_no: `${TAG}-REG-CALRUN`,
        periodStart: inst.period.startsOn,
        periodEnd:   inst.period.endsOn,
        runType: 'scheduled',
        statutory_version_id: ctx.versionId,
        status: 'draft',
        pay_group_id: ctx.payGroupId,
        pay_group: `${TAG} Calendar Test Group`,
        gross_total: 0, net_total: 0, deduction_total: 0, employee_count: 0,
        created_by: fstaff.id,
      }),
    ).select('id').single();
    expect(!nr, `seed cal run: ${nr?.message}`);
    ctx.runIds.push(newRun.id);
    ctx.runNos.push(`${TAG}-REG-CALRUN`);

    // Now the calendar should show run != null for that instance
    const r2 = await api('finance/payroll/runs/calendar', T.mgr, {
      from:        calFrom,
      to:          calTo,
      payGroupIds: [ctx.payGroupId],
    });
    ok(r2, 'calendar second fetch should succeed');
    const linked = r2.body.data.instances.find(i => i.key === inst.key);
    expect(linked, 'linked instance must be present');
    expect(linked.run !== null, 'run field must not be null for linked instance');
    expect(linked.run.id === newRun.id, `linked run id should be ${newRun.id}, got ${linked.run.id}`);
    expect(linked.run.state === 'draft', `linked run state should be draft, got ${linked.run.state}`);

    // Other instances should still have run=null
    const unlinked = r2.body.data.instances.filter(i => i.key !== inst.key);
    for (const u of unlinked) {
      expect(u.run === null, `other instances should still have run=null, got ${JSON.stringify(u.run)}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 36. Calendar — payGroupIds filter restricts to that group only
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/calendar — payGroupIds filter restricts output', async () => {
    const r = await api('finance/payroll/runs/calendar', T.mgr, {
      from:        '2026-01-01',
      to:          '2026-03-31',
      payGroupIds: ['00000000-0000-4000-8000-000000000000'], // valid v4 UUID, non-existent group
    });
    ok(r, 'should succeed with empty instances for unknown group');
    expect(r.body.data.instances.length === 0, `unknown group should yield 0 instances, got ${r.body.data.instances.length}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 37. Calendar — result shape validation
  // ─────────────────────────────────────────────────────────────────────────────
  await test('runs/calendar — instance shape matches PayrollRunCalendarInstance contract', async () => {
    const r = await api('finance/payroll/runs/calendar', T.mgr, {
      from:        calFrom,
      to:          calTo,
      payGroupIds: [ctx.payGroupId],
    });
    ok(r, 'should succeed');
    const { instances } = r.body.data;
    for (const inst of instances) {
      expect(typeof inst.key === 'string', 'inst.key must be string');
      expect(typeof inst.payGroup.id === 'string', 'inst.payGroup.id must be string');
      expect(typeof inst.payGroup.name === 'string', 'inst.payGroup.name must be string');
      expect(typeof inst.payGroup.frequency === 'string', 'inst.payGroup.frequency must be string');
      expect(typeof inst.period.startsOn === 'string', 'inst.period.startsOn must be string');
      expect(typeof inst.period.endsOn === 'string', 'inst.period.endsOn must be string');
      expect(typeof inst.payDate === 'string', 'inst.payDate must be string');
      // cutoffAt: string or null (offset=5 → should not be null for our group)
      // inst.run: null or { id, reference, state }
      if (inst.run !== null) {
        expect(typeof inst.run.id === 'string', 'inst.run.id must be string');
        expect(typeof inst.run.reference === 'string', 'inst.run.reference must be string');
        expect(typeof inst.run.state === 'string', 'inst.run.state must be string');
      }
    }
  });
}
