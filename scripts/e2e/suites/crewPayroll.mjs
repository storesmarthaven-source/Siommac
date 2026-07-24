// ═══════════════════════════════════════════════════════════════════════════
// Crew Payroll — live acceptance (CP4 assignments + CP5 movements), spec §14.6/§14.8/§14.9.
// ═══════════════════════════════════════════════════════════════════════════
// Real routes only (hr/crew/*), gated by finance.payroll.crew.* permissions. Opaque test
// fixtures (users, pay group, asset) seeded via the service-role client; the crew
// assignment/movement business rows are created THROUGH the real endpoints. Asserts §2
// side effects (app_events + audit_logs) via the service client. Rows tagged h.TAG.
// Covers CPE-01..07 (CP4/CP5) + CPE-15/16/17/18/22/27 (CP6 conditional run capability).
// Run: npm run test:e2e -- crewPayroll  (on the worktree dev server).

import { randomUUID as uuid } from 'node:crypto';
import { attachActivePolicy } from '../helpers/payPolicyFixture.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  h.section('Crew Payroll — assignments + movements (CP4/CP5)');

  const U = {
    mgr: `CRP-MGR-${TAG}`, plain: `CRP-EMP-${TAG}`,
    A: `CRP-EA-${TAG}`, B: `CRP-EB-${TAG}`, C: `CRP-EC-${TAG}`, D: `CRP-ED-${TAG}`,
    E: `CRP-EE-${TAG}`, F: `CRP-EF-${TAG}`,
  };
  let T = {};
  const ids = {
    pgId: null, pg2Id: null, pg3Id: null, assetA: null, assetB: null, asgIds: [], movIds: [],
    crewPolicy: null, stdPolicy: null, pg3Policy: null, dayCompId: null,
    runIds: [], mayMovementId: null,
  };

  h.onCleanup(async () => {
    // CP6 runs first (they pin the policy version with `on delete restrict`).
    if (ids.runIds.length) {
      await sb.from('finance_payroll_runs')
        .update({ current_input_snapshot_id: null, current_calculation_version_id: null })
        .in('id', ids.runIds);
      await h.mustDelete('finance_payroll_input_lock_receipts', q => q.in('run_id', ids.runIds));
      await h.mustDelete('finance_payroll_lifecycle_command_receipts', q => q.in('run_id', ids.runIds));
      await h.mustDelete('finance_payroll_run_warnings', q => q.in('run_id', ids.runIds));
      await h.mustDelete('finance_payroll_run_lines', q => q.in('run_id', ids.runIds));
      await h.mustDelete('finance_payroll_run_inputs', q => q.in('run_id', ids.runIds));
      // snapshots cascade the run policy/calendar evidence rows.
      await h.mustDelete('finance_payroll_input_snapshot_lines', q => q.in('run_id', ids.runIds));
      await h.mustDelete('finance_payroll_input_snapshots', q => q.in('run_id', ids.runIds));
      await h.mustDelete('notifications', q => q.in('source_id', ids.runIds));
      await h.mustDelete('handoff_outbox', q => q.in('source_entity_id', ids.runIds));
      await h.mustDelete('hr_audit_log', q => q.in('record_id', ids.runIds));
      await h.mustDelete('app_events', q => q.in('source_entity_id', ids.runIds));
      await h.mustDelete('finance_payroll_runs', q => q.in('id', ids.runIds));
    }
    const crewEmp = [U.A, U.B, U.C, U.E, U.F];
    try { await sb.from('hr_crew_movements').delete().in('employee_id', crewEmp); } catch {}
    try { await sb.from('hr_crew_assignments').delete().in('employee_id', crewEmp); } catch {}
    try { await sb.from('hr_contracts').delete().in('employee_id', crewEmp); } catch {}
    try { await sb.from('hr_overtime_entries').delete().in('employee_id', crewEmp); } catch {}
    try { await sb.from('hr_employee_statutory_profiles').delete().in('employee_id', crewEmp); } catch {}
    try { await sb.from('app_events').delete().in('actor_user_id', Object.values(U)); } catch {}
    try { await sb.from('audit_logs').delete().in('user_id', Object.values(U)); } catch {}
    for (const a of [ids.assetA, ids.assetB]) { if (a) { try { await sb.from('ops_assets').delete().eq('id', a); } catch {} } }
    // Policy fixtures AFTER runs/snapshots, BEFORE the pay groups (restrict FKs).
    if (ids.crewPolicy) { try { await ids.crewPolicy.cleanup(); } catch {} }
    if (ids.stdPolicy)  { try { await ids.stdPolicy.cleanup(); } catch {} }
    if (ids.pg3Policy)  { try { await ids.pg3Policy.cleanup(); } catch {} }
    // The day-rate pay component AFTER the policy cleanups (binding FK is restrict).
    if (ids.dayCompId)  { try { await sb.from('finance_pay_components').delete().eq('id', ids.dayCompId); } catch {} }
    for (const pg of [ids.pgId, ids.pg2Id, ids.pg3Id]) {
      if (!pg) continue;
      try { await sb.from('finance_employee_pay_group_assignments').delete().eq('pay_group_id', pg); } catch {}
      try { await sb.from('finance_pay_groups').delete().eq('id', pg); } catch {}
    }
    try { await sb.from('app_users').delete().in('id', Object.values(U)); } catch {}
  });

  const evCount = (entityId, type) =>
    sb.from('app_events').select('id', { count: 'exact', head: true }).eq('source_entity_id', entityId).eq('event_type', type);
  const auditCount = (entityId) =>
    sb.from('audit_logs').select('id', { count: 'exact', head: true }).eq('record_id', entityId);

  await test('CRP-setup — users, pay groups, two assets, memberships', async () => {
    const salaried = { pay_basis: 'salary', monthly_salary: 9000.00 };
    const { error } = await sb.from('app_users').insert([
      { id: U.mgr,   username: `${TAG}_crp_mgr`, full_name: 'Crew Manager', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: U.plain, username: `${TAG}_crp_emp`, full_name: 'Crew Plain',   role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: U.A, username: `${TAG}_crp_ea`, full_name: 'Crew Emp A', role: 'employee', status: 'active', employment_type: 'employee', ...salaried },
      { id: U.B, username: `${TAG}_crp_eb`, full_name: 'Crew Emp B', role: 'employee', status: 'active', employment_type: 'employee', ...salaried },
      { id: U.C, username: `${TAG}_crp_ec`, full_name: 'Crew Emp C', role: 'employee', status: 'active', employment_type: 'employee', ...salaried },
      { id: U.D, username: `${TAG}_crp_ed`, full_name: 'Std Emp D',  role: 'employee', status: 'active', employment_type: 'employee', ...salaried },
      { id: U.E, username: `${TAG}_crp_ee`, full_name: 'Crew Emp E', role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 6000.00 },
      { id: U.F, username: `${TAG}_crp_ef`, full_name: 'Crew Emp F', role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 6000.00 },
    ]);
    expect(!error, `seed users: ${error?.message}`);
    T = {
      mgr:   mint({ id: U.mgr,   username: `${TAG}_crp_mgr`, role: 'finance_manager', department_id: null }),
      plain: mint({ id: U.plain, username: `${TAG}_crp_emp`, role: 'employee',        department_id: null }),
    };
    const pg = await sb.from('finance_pay_groups').insert([
      { code: `CRP-${TAG.slice(-5)}`, name: `Crew ${TAG}`,     frequency: 'monthly', statutory_country: 'TT' },
      { code: `CRS-${TAG.slice(-5)}`, name: `Crew Std ${TAG}`, frequency: 'monthly', statutory_country: 'TT' },
      { code: `CRB-${TAG.slice(-5)}`, name: `Crew Blk ${TAG}`, frequency: 'monthly', statutory_country: 'TT' },
    ]).select('id');
    expect(!pg.error, `pay groups: ${pg.error?.message}`);
    ids.pgId = pg.data[0].id; ids.pg2Id = pg.data[1].id; ids.pg3Id = pg.data[2].id;
    const mem = await sb.from('finance_employee_pay_group_assignments').insert([
      { employee_id: U.A, pay_group_id: ids.pgId,  effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.B, pay_group_id: ids.pgId,  effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.C, pay_group_id: ids.pgId,  effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.D, pay_group_id: ids.pg2Id, effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.E, pay_group_id: ids.pgId,  effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.F, pay_group_id: ids.pg3Id, effective_from: '2026-01-01', created_by: U.mgr },
    ]);
    expect(!mem.error, `memberships: ${mem.error?.message}`);
    const a = await sb.from('ops_assets').insert([{ name: `Platform Alpha ${TAG}`, type: 'platform' }, { name: `Platform Bravo ${TAG}`, type: 'platform' }]).select('id');
    expect(!a.error, `assets: ${a.error?.message}`); ids.assetA = a.data[0].id; ids.assetB = a.data[1].id;
  });

  await test('CRP-03/07 access control — unauthorized 401, non-participant 403', async () => {
    const unauth = await api('hr/crew/assignments/create', null, { employeeId: U.A, payGroupId: ids.pgId, effectiveFrom: '2026-03-01' });
    expect(unauth.status === 401, `unauth create expected 401, got ${unauth.status}`);
    const denied = await api('hr/crew/assignments/create', T.plain, { employeeId: U.A, payGroupId: ids.pgId, effectiveFrom: '2026-03-01' });
    fails(denied); expect(denied.status === 403, `plain employee expected 403, got ${denied.status}`);
    const mDenied = await api('hr/crew/movements/record', T.plain, { employeeId: U.A, movementType: 'embark', occurredAt: '2026-03-02T06:00:00Z', sourceReference: `x-${uuid()}` });
    fails(mDenied); expect(mDenied.status === 403, `movement record plain expected 403, got ${mDenied.status}`);
  });

  await test('CPE-01 assignment create/update/end + exact app_events/audit', async () => {
    const cr = await api('hr/crew/assignments/create', T.mgr, {
      employeeId: U.A, payGroupId: ids.pgId, assetId: ids.assetA, role: 'Production Operator',
      effectiveFrom: '2026-03-01', effectiveTo: '2026-03-31', status: 'active',
    });
    ok(cr, `create: ${cr.body.message}`);
    const asg = cr.body.data; ids.asgIds.push(asg.id);
    expect(asg.assignmentNo && asg.status === 'active' && asg.assetId === ids.assetA, 'assignment shape correct');
    const ev1 = await evCount(asg.id, 'hr.crew.assignment.created');
    expect(ev1.count === 1, `exactly 1 created event (got ${ev1.count})`);
    const au1 = await auditCount(asg.id);
    expect((au1.count ?? 0) >= 1, `>=1 audit row (got ${au1.count})`);

    const up = await api('hr/crew/assignments/update', T.mgr, { id: asg.id, role: 'Lead Operator' });
    ok(up, `update: ${up.body.message}`);
    expect(up.body.data.role === 'Lead Operator', 'role updated');
    const ev2 = await evCount(asg.id, 'hr.crew.assignment.updated');
    expect(ev2.count === 1, `exactly 1 updated event (got ${ev2.count})`);

    const en = await api('hr/crew/assignments/end', T.mgr, { id: asg.id, effectiveTo: '2026-03-20', reason: 'demob' });
    ok(en, `end: ${en.body.message}`);
    expect(en.body.data.status === 'ended' && en.body.data.effectiveTo === '2026-03-20', 'assignment ended');
    const ev3 = await evCount(asg.id, 'hr.crew.assignment.ended');
    expect(ev3.count === 1, `exactly 1 ended event (got ${ev3.count})`);
  });

  await test('CPE-02 overlapping active crew assignment → 422 blocker; no row', async () => {
    // employee B active on asset A for the month...
    const first = await api('hr/crew/assignments/create', T.mgr, { employeeId: U.B, payGroupId: ids.pgId, assetId: ids.assetA, effectiveFrom: '2026-04-01', effectiveTo: '2026-04-30', status: 'active' });
    ok(first, `first B assignment: ${first.body.message}`); ids.asgIds.push(first.body.data.id);
    // ...a second active assignment overlapping (different asset) must be blocked.
    const overlap = await api('hr/crew/assignments/create', T.mgr, { employeeId: U.B, payGroupId: ids.pgId, assetId: ids.assetB, effectiveFrom: '2026-04-15', effectiveTo: '2026-05-15', status: 'active' });
    fails(overlap); expect(overlap.status === 422, `overlap expected 422, got ${overlap.status}`);
    expect(String(overlap.body.message || '').includes('assignment_overlap'), `overlap message (got ${overlap.body.message})`);
    // P0-5 typed error envelope: stable dotted domain code + correlationId.
    expect(overlap.body.error?.code === 'crew.assignment_overlap' && !!overlap.body.error?.correlationId,
      `typed error envelope (got ${JSON.stringify(overlap.body.error)})`);
    const rows = await sb.from('hr_crew_assignments').select('id').eq('employee_id', U.B).eq('asset_id', ids.assetB);
    expect((rows.data ?? []).length === 0, 'blocked overlap must persist NO row');
  });

  await test('CPE-04/05 movement record + idempotent replay (deduped, +0 events)', async () => {
    const srcRef = `SRC-${TAG}-001`;
    const rec = await api('hr/crew/movements/record', T.mgr, { employeeId: U.A, movementType: 'embark', occurredAt: '2026-03-02T06:00:00Z', assetId: ids.assetA, sourceSystem: 'marine_logistics', sourceReference: srcRef });
    ok(rec, `record: ${rec.body.message}`);
    expect(rec.body.data.deduped === false, 'first record not deduped');
    const mov = rec.body.data.movement; ids.movIds.push(mov.id);
    expect(mov.movementType === 'embark' && mov.sourceReference === srcRef, 'movement shape');
    const ev1 = await evCount(mov.id, 'hr.crew.movement.recorded');
    expect(ev1.count === 1, `exactly 1 recorded event (got ${ev1.count})`);

    // replay same business key → deduped, same id, no new row/event
    const replay = await api('hr/crew/movements/record', T.mgr, { employeeId: U.A, movementType: 'embark', occurredAt: '2026-03-02T06:00:00Z', assetId: ids.assetA, sourceSystem: 'marine_logistics', sourceReference: srcRef });
    ok(replay, `replay: ${replay.body.message}`);
    expect(replay.body.data.deduped === true && replay.body.data.movement.id === mov.id, 'replay deduped to same id');
    const rows = await sb.from('hr_crew_movements').select('id').eq('source_system', 'marine_logistics').eq('source_reference', srcRef);
    expect((rows.data ?? []).length === 1, `idempotent import: exactly 1 row (got ${rows.data?.length})`);
    const ev2 = await evCount(mov.id, 'hr.crew.movement.recorded');
    expect(ev2.count === 1, `replay adds NO event (still 1, got ${ev2.count})`);
  });

  await test('CPE-06 movement correct — new record links to original; original untouched', async () => {
    const origId = ids.movIds[0];
    const before = await sb.from('hr_crew_movements').select('movement_type, occurred_at, corrects_movement_id').eq('id', origId).single();
    const corr = await api('hr/crew/movements/correct', T.mgr, { correctsMovementId: origId, reason: 'wrong asset on import', assetId: ids.assetB, movementType: 'disembark' });
    ok(corr, `correct: ${corr.body.message}`);
    const c = corr.body.data;
    expect(c.id !== origId && c.correctsMovementId === origId && c.correctionReason === 'wrong asset on import', 'correction links to original');
    expect(c.movementType === 'disembark' && c.assetId === ids.assetB, 'corrected values applied on the NEW record');
    ids.movIds.push(c.id);
    const after = await sb.from('hr_crew_movements').select('movement_type, occurred_at, corrects_movement_id').eq('id', origId).single();
    expect(after.data.movement_type === before.data.movement_type && after.data.corrects_movement_id === null, 'ORIGINAL movement is unchanged');
    const ev = await evCount(c.id, 'hr.crew.movement.corrected');
    expect(ev.count === 1, `exactly 1 corrected event (got ${ev.count})`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Crew Payroll — CP6 conditional run capability (preflight/snapshot/read)');
  // ═══════════════════════════════════════════════════════════════════════════
  // Period 2026-05: A holds an active crew assignment but no movement (CPE-16);
  // B has a movement but no covering assignment (CPE-17); C holds two overlapping
  // active assignments on different assets, seeded via the service client because
  // the CP4 write path correctly refuses to create them (CPE-18). No employee has
  // a bank account (CPE-22). pg2 carries a standard_salary policy (CPE-27 negative).
  const MAY = { start: '2026-05-01', end: '2026-05-31' };

  // Run creation through the NORMAL HTTP route with the WP-3 creation
  // attestations (all three literally true, strict object) — no RPC shortcut.
  async function createRunFixture({ requestKey, payGroupId, period = MAY }) {
    const cr = await api('finance/payroll/runs/create', T.mgr, {
      idempotencyKey: requestKey, runType: 'scheduled', payGroupId,
      periodStart: period.start, periodEnd: period.end, payFrequency: 'monthly', payDate: period.end,
      attestations: {
        purposeScopeAndDatesReviewed: true,
        preflightLimitationsAcknowledged: true,
        separationOfDutiesAcknowledged: true,
      },
    });
    ok(cr, `runs/create: ${cr.body.message}`);
    const runId = cr.body.data.id;
    expect(!!runId, `run id from runs/create (got ${JSON.stringify(cr.body.data).slice(0, 120)})`);
    ids.runIds.push(runId);
    return runId;
  }

  await test('CP6-setup — crew policy on pg, standard policy on pg2, May fixtures', async () => {
    ids.crewPolicy = await attachActivePolicy({
      sb, payGroupId: ids.pgId, actorId: U.mgr, tag: TAG,
      policyType: 'offshore_rotation', dayBoundary: 'offshore_day',
    });
    expect(!ids.crewPolicy.reused, 'crew policy fixture must be freshly seeded');
    ids.stdPolicy = await attachActivePolicy({ sb, payGroupId: ids.pg2Id, actorId: U.mgr, tag: TAG });

    // A: active May assignment, no May movement (through the real endpoint).
    const aAsg = await api('hr/crew/assignments/create', T.mgr, {
      employeeId: U.A, payGroupId: ids.pgId, assetId: ids.assetA,
      effectiveFrom: MAY.start, effectiveTo: MAY.end, status: 'active',
    });
    ok(aAsg, `A May assignment: ${aAsg.body.message}`); ids.asgIds.push(aAsg.body.data.id);

    // C: first assignment via the endpoint; the overlapping second is service-seeded
    // (the CP4 path 422s it — preflight must still detect pre-existing/imported rows).
    const cAsg = await api('hr/crew/assignments/create', T.mgr, {
      employeeId: U.C, payGroupId: ids.pgId, assetId: ids.assetA,
      effectiveFrom: MAY.start, effectiveTo: MAY.end, status: 'active',
    });
    ok(cAsg, `C May assignment: ${cAsg.body.message}`); ids.asgIds.push(cAsg.body.data.id);
    const cOvl = await sb.from('hr_crew_assignments').insert({
      assignment_no: `CRW-${TAG}-OVL`, employee_id: U.C, pay_group_id: ids.pgId,
      asset_id: ids.assetB, effective_from: '2026-05-15', effective_to: '2026-06-15',
      status: 'active', created_by: U.mgr,
    }).select('id').single();
    expect(!cOvl.error, `C overlap seed: ${cOvl.error?.message}`); ids.asgIds.push(cOvl.data.id);

    // B: May movement with NO covering assignment (through the real endpoint).
    const bMov = await api('hr/crew/movements/record', T.mgr, {
      employeeId: U.B, movementType: 'embark', occurredAt: '2026-05-10T06:00:00Z',
      assetId: ids.assetA, sourceSystem: 'marine_logistics', sourceReference: `SRC-${TAG}-M2`,
    });
    ok(bMov, `B May movement: ${bMov.body.message}`);
    ids.mayMovementId = bMov.body.data.movement.id; ids.movIds.push(ids.mayMovementId);
  });

  await test('CPE-16/17/18/22 preflight — typed crew blockers on input-readiness', async () => {
    const r = await api('finance/payroll/runs/input-readiness', T.mgr,
      { payGroupId: ids.pgId, periodStart: MAY.start, periodEnd: MAY.end });
    ok(r, `input-readiness: ${r.body.message}`);
    const crew = r.body.data.crew;
    expect(!!crew, 'crew block present for a crew-capable pay group');
    expect(crew.policyType === 'offshore_rotation' && crew.dayBoundary === 'offshore_day',
      `capability fields (got ${crew.policyType}/${crew.dayBoundary})`);
    expect(crew.expectedCrew === 2, `expectedCrew 2 = A+C (got ${crew.expectedCrew})`);
    expect(crew.assignmentCount === 3 && crew.movementCount === 1,
      `3 assignments + 1 movement (got ${crew.assignmentCount}/${crew.movementCount})`);
    const b = crew.blockers;
    expect(b.rosterWithoutMovement.count === 2
      && JSON.stringify(b.rosterWithoutMovement.employeeIds) === JSON.stringify([U.A, U.C].sort()),
      `CPE-16 roster-without-movement = [A,C] (got ${JSON.stringify(b.rosterWithoutMovement)})`);
    expect(b.movementWithoutAssignment.count === 1
      && b.movementWithoutAssignment.movementIds[0] === ids.mayMovementId,
      `CPE-17 movement-without-assignment = B's movement (got ${JSON.stringify(b.movementWithoutAssignment)})`);
    expect(b.overlappingAssignments.count === 1 && b.overlappingAssignments.employeeIds[0] === U.C,
      `CPE-18 overlapping-assignments = [C] (got ${JSON.stringify(b.overlappingAssignments)})`);
    expect(b.missingPaymentDestination.count === 2
      && JSON.stringify(b.missingPaymentDestination.employeeIds) === JSON.stringify([U.A, U.C].sort()),
      `CPE-22 missing-payment-destination = [A,C] (got ${JSON.stringify(b.missingPaymentDestination)})`);
    expect(b.incompleteStatutoryProfile.count === 2
      && JSON.stringify(b.incompleteStatutoryProfile.employeeIds) === JSON.stringify([U.A, U.C].sort()),
      `CPE-21 incomplete-statutory-profile = [A,C] pre-verification (got ${JSON.stringify(b.incompleteStatutoryProfile)})`);
    expect(r.body.data.sources.length === 6, 'the six standard sources are untouched');
  });

  await test('CPE-27 negative — standard-policy pay group has NO crew block', async () => {
    const r = await api('finance/payroll/runs/input-readiness', T.mgr,
      { payGroupId: ids.pg2Id, periodStart: MAY.start, periodEnd: MAY.end });
    ok(r, `input-readiness pg2: ${r.body.message}`);
    expect(r.body.data.crew === null, `crew must be null for standard_salary (got ${JSON.stringify(r.body.data.crew)})`);
  });

  await test('CP6 lock — crew evidence frozen into the input snapshot', async () => {
    const runId = await createRunFixture({ requestKey: `crw-run-${TAG}`, payGroupId: ids.pgId });
    const got = await api('finance/payroll/runs/get', T.mgr, { id: runId });
    ok(got, `runs/get: ${got.body.message}`);
    expect(got.body.data.payPolicy?.versionId === ids.crewPolicy.versionId,
      `run pinned to the crew policy version (got ${got.body.data.payPolicy?.versionId})`);

    const lk = await api('finance/payroll/runs/lock-inputs', T.mgr,
      { id: runId, idempotencyKey: `crw-lock-${TAG}` });
    ok(lk, `lock inputs: ${lk.body.message}`);
    expect(lk.body.data.status === 'input_locked', `locked (got ${lk.body.data.status})`);

    const ev = await api('finance/payroll/runs/policy-evidence', T.mgr, { runId });
    ok(ev, `policy evidence: ${ev.body.message}`);
    const crew = ev.body.data.crew;
    expect(!!crew, 'frozen crew block present in policy evidence');
    expect(crew.expectedCrew === 2 && crew.assignmentCount === 3 && crew.movementCount === 1,
      `frozen totals match preflight (got ${crew.expectedCrew}/${crew.assignmentCount}/${crew.movementCount})`);
    expect(crew.assignmentIds.length === 3 && crew.movementIds.length === 1,
      'frozen source ids retained');
    expect(crew.blockers.movementWithoutAssignment.movementIds[0] === ids.mayMovementId,
      'frozen blocker evidence retained');
  });

  await test('CPE-27 — run-workspace read surfaces crew ONLY for crew runs', async () => {
    const w = await api('finance/payroll/runs/workspace', T.mgr, { id: ids.runIds[0] });
    ok(w, `workspace: ${w.body.message}`);
    expect(!!w.body.data.crew && w.body.data.crew.expectedCrew === 2,
      'crew block on the crew run workspace');
    // CP8: server-resolved display names for every id in the crew evidence.
    const wNames = w.body.data.crewEmployeeNames;
    expect(!!wNames && wNames[U.A] === 'Crew Emp A' && wNames[U.C] === 'Crew Emp C',
      `crewEmployeeNames resolved (got ${JSON.stringify(wNames)})`);

    const stdRunId = await createRunFixture({ requestKey: `std-run-${TAG}`, payGroupId: ids.pg2Id });
    const lk2 = await api('finance/payroll/runs/lock-inputs', T.mgr,
      { id: stdRunId, idempotencyKey: `std-lock-${TAG}` });
    ok(lk2, `std lock: ${lk2.body.message}`);
    const w2 = await api('finance/payroll/runs/workspace', T.mgr, { id: stdRunId });
    ok(w2, `std workspace: ${w2.body.message}`);
    expect(w2.body.data.crew === null,
      `crew must be null on a standard run workspace (got ${JSON.stringify(w2.body.data.crew)})`);
    expect(w2.body.data.crewEmployeeNames === null, 'crewEmployeeNames null on non-crew runs');
    const ev2 = await api('finance/payroll/runs/policy-evidence', T.mgr, { runId: stdRunId });
    ok(ev2, `std policy evidence: ${ev2.body.message}`);
    expect(ev2.body.data.crew === null, 'crew null in standard policy evidence');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Crew Payroll — CP7 calculation evidence (qualifying days / findings)');
  // ═══════════════════════════════════════════════════════════════════════════
  // June run on the crew group. A: verified statutory profile + June assignment on
  // assetA + movements mobilize Jun-10 08:00Z, embark Jun-10 23:00Z (same local
  // day — no double count), disembark Jun-13 02:00Z (cross-midnight; local POS
  // date Jun-12) ⇒ qualifying dates {10,11,12} = 3 (CPE-20). A also has a
  // SUBMITTED (unapproved) June OT entry ⇒ advisory finding, pay untouched
  // (CPE-19/24). C is crew via the May-15→Jun-15 assetB assignment but has NO
  // statutory profile ⇒ blocked, no line (CPE-21). B is a plain member ⇒ normal
  // line, no crew evidence.
  const JUN = { start: '2026-06-01', end: '2026-06-30' };

  await test('CP7-setup — profiles, contracts, day-rate component, assignments, movements, OT', async () => {
    const prof = await sb.from('hr_employee_statutory_profiles').insert([
      { employee_id: U.A, jurisdiction: 'TT', nis_number: `NISA${TAG.slice(-6)}`, nis_status: 'verified', nis_applicable: true },
      { employee_id: U.E, jurisdiction: 'TT', nis_number: `NISE${TAG.slice(-6)}`, nis_status: 'verified', nis_applicable: true },
      { employee_id: U.F, jurisdiction: 'TT', nis_number: `NISF${TAG.slice(-6)}`, nis_status: 'verified', nis_applicable: true },
    ]);
    expect(!prof.error, `statutory profiles: ${prof.error?.message}`);

    // CP7b: the day-rate pay component + its per_qualifying_day binding on BOTH
    // crew policy versions (pg run + pg3 blocker-run). Requires mig 20260921000000.
    const comp = await sb.from('finance_pay_components').insert({
      code: `CRD${TAG.slice(-6)}`, name: `Crew Day Rate [${TAG}]`, kind: 'earning',
      is_taxable: true, is_active: true,
    }).select('id').single();
    expect(!comp.error, `day component: ${comp.error?.message}`);
    ids.dayCompId = comp.data.id;
    ids.pg3Policy = await attachActivePolicy({
      sb, payGroupId: ids.pg3Id, actorId: U.mgr, tag: TAG,
      policyType: 'offshore_rotation', dayBoundary: 'offshore_day',
    });
    const binds = await sb.from('finance_pay_policy_components').insert([
      { policy_version_id: ids.crewPolicy.versionId, component_id: ids.dayCompId,
        calculation_basis: 'per_qualifying_day', rate_source: 'employee_contract',
        eligibility_source: 'crew_movement', rule_parameters: {}, is_required: true, sort_order: 10 },
      { policy_version_id: ids.pg3Policy.versionId, component_id: ids.dayCompId,
        calculation_basis: 'per_qualifying_day', rate_source: 'employee_contract',
        eligibility_source: 'crew_movement', rule_parameters: {}, is_required: true, sort_order: 10 },
    ]);
    expect(!binds.error, `component bindings (mig 20260921000000 applied?): ${binds.error?.message}`);

    // Daily TTD contracts: A = 1234.56 (rounding case), E = two sequential
    // contracts at different rates (1000 then 1200).
    const contracts = await sb.from('hr_contracts').insert([
      { contract_no: `CRW-${TAG}-A1`, employee_id: U.A, title: 'A offshore daily', status: 'active',
        start_date: JUN.start, compensation_amount: 1234.56, compensation_currency: 'TTD', compensation_period: 'daily' },
      { contract_no: `CRW-${TAG}-E1`, employee_id: U.E, title: 'E daily 1', status: 'active',
        start_date: '2026-06-01', end_date: '2026-06-15', compensation_amount: 1000.00, compensation_currency: 'TTD', compensation_period: 'daily' },
      { contract_no: `CRW-${TAG}-E2`, employee_id: U.E, title: 'E daily 2', status: 'active',
        start_date: '2026-06-16', compensation_amount: 1200.00, compensation_currency: 'TTD', compensation_period: 'daily' },
    ]).select('id, contract_no');
    expect(!contracts.error, `contracts: ${contracts.error?.message}`);
    const byNo = new Map(contracts.data.map(c => [c.contract_no, c.id]));
    ids.contractA  = byNo.get(`CRW-${TAG}-A1`);
    ids.contractE1 = byNo.get(`CRW-${TAG}-E1`);
    ids.contractE2 = byNo.get(`CRW-${TAG}-E2`);

    const aAsg = await api('hr/crew/assignments/create', T.mgr, {
      employeeId: U.A, payGroupId: ids.pgId, assetId: ids.assetA, contractId: ids.contractA,
      effectiveFrom: JUN.start, effectiveTo: JUN.end, status: 'active',
    });
    ok(aAsg, `A June assignment: ${aAsg.body.message}`); ids.asgIds.push(aAsg.body.data.id);

    // E: two sequential assignments, each with its own contract (CP7b case 2).
    const e1 = await api('hr/crew/assignments/create', T.mgr, {
      employeeId: U.E, payGroupId: ids.pgId, assetId: ids.assetA, contractId: ids.contractE1,
      effectiveFrom: '2026-06-01', effectiveTo: '2026-06-15', status: 'active',
    });
    ok(e1, `E assignment 1: ${e1.body.message}`); ids.asgE1 = e1.body.data.id; ids.asgIds.push(ids.asgE1);
    const e2 = await api('hr/crew/assignments/create', T.mgr, {
      employeeId: U.E, payGroupId: ids.pgId, assetId: ids.assetB, contractId: ids.contractE2,
      effectiveFrom: '2026-06-16', effectiveTo: '2026-06-30', status: 'active',
    });
    ok(e2, `E assignment 2: ${e2.body.message}`); ids.asgE2 = e2.body.data.id; ids.asgIds.push(ids.asgE2);
    const eMovs = [
      { movementType: 'embark',    occurredAt: '2026-06-14T06:00:00Z', ref: `SRC-${TAG}-E1` },
      { movementType: 'disembark', occurredAt: '2026-06-17T20:00:00Z', ref: `SRC-${TAG}-E2` },
    ];
    for (const m of eMovs) {
      const r = await api('hr/crew/movements/record', T.mgr, {
        employeeId: U.E, movementType: m.movementType, occurredAt: m.occurredAt,
        assetId: ids.assetA, sourceSystem: 'marine_logistics', sourceReference: m.ref,
      });
      ok(r, `E movement ${m.movementType}: ${r.body.message}`);
      ids.movIds.push(r.body.data.movement.id);
    }

    const movs = [
      { movementType: 'mobilize',  occurredAt: '2026-06-10T08:00:00Z', ref: `SRC-${TAG}-J1` },
      { movementType: 'embark',    occurredAt: '2026-06-10T23:00:00Z', ref: `SRC-${TAG}-J2` },
      { movementType: 'disembark', occurredAt: '2026-06-13T02:00:00Z', ref: `SRC-${TAG}-J3` },
    ];
    for (const m of movs) {
      const r = await api('hr/crew/movements/record', T.mgr, {
        employeeId: U.A, movementType: m.movementType, occurredAt: m.occurredAt,
        assetId: ids.assetA, sourceSystem: 'marine_logistics', sourceReference: m.ref,
      });
      ok(r, `A movement ${m.movementType}: ${r.body.message}`);
      ids.movIds.push(r.body.data.movement.id);
    }

    const ot = await sb.from('hr_overtime_entries').insert({
      employee_id: U.A, work_date: '2026-06-15', hours: 4, multiplier: 1.5,
      status: 'submitted',
    }).select('id').single();
    expect(!ot.error, `A submitted OT: ${ot.error?.message}`);
    ids.otId = ot.data.id;
  });

  await test('CP7 lock+calc — CPE-19/20/21/24/26 evidence, findings, day-rate earnings', async () => {
    const runId = await createRunFixture({ requestKey: `crw7-run-${TAG}`, payGroupId: ids.pgId, period: JUN });
    ids.cp7RunId = runId;
    const lk = await api('finance/payroll/runs/lock-inputs', T.mgr,
      { id: runId, idempotencyKey: `crw7-lock-${TAG}` });
    ok(lk, `lock: ${lk.body.message}`);

    // Idempotent replay: same key relock returns the SAME snapshot, adds nothing.
    const relk = await api('finance/payroll/runs/lock-inputs', T.mgr,
      { id: runId, idempotencyKey: `crw7-lock-${TAG}` });
    ok(relk, `relock replay: ${relk.body.message}`);
    const snaps = await sb.from('finance_payroll_input_snapshots')
      .select('id', { count: 'exact', head: true }).eq('run_id', runId);
    expect(snaps.count === 1, `replay keeps exactly 1 snapshot (got ${snaps.count})`);

    const calc = await api('finance/payroll/runs/calculate', T.mgr,
      { id: runId, idempotencyKey: `crw7-calc-${TAG}` });
    ok(calc, `calculate: ${calc.body.message}`);
    expect(calc.body.data.status === 'calculated', `calculated (got ${calc.body.data.status})`);

    const lines = await api('finance/payroll/run-lines/list', T.mgr, { runId });
    ok(lines, `run-lines: ${lines.body.message}`);
    const byEmp = new Map(lines.body.data.map(l => [l.employeeId, l]));
    // CPE-21: crew employee C without a verified profile gets NO line.
    expect(!byEmp.has(U.C), 'C (incomplete statutory profile) has NO line');
    expect(byEmp.has(U.A) && byEmp.has(U.B) && byEmp.has(U.E), 'A, B and E have lines');

    // CP7b: day-rate earnings from the frozen contract evidence.
    // A: 3 qualifying days × 1234.56 = 3703.68 (exact rounding) on top of 9000 salary.
    const aCrew = byEmp.get(U.A).breakdown.crew;
    expect(!!aCrew.dayRate, 'A line carries frozen dayRate evidence');
    expect(aCrew.dayRate.totalDays === 3 && aCrew.dayRate.totalAmount === 3703.68,
      `A day-rate 3d × 1234.56 = 3703.68 (got ${aCrew.dayRate.totalDays}d/${aCrew.dayRate.totalAmount})`);
    const aAlloc = aCrew.dayRate.allocations[0];
    expect(aCrew.dayRate.allocations.length === 1 && aAlloc.contractId === ids.contractA
      && aAlloc.compensationAmount === 1234.56 && aAlloc.currency === 'TTD' && aAlloc.period === 'daily'
      && aAlloc.earningAmount === 3703.68 && aAlloc.qualifyingDays === 3,
      `A allocation frozen contract shape (got ${JSON.stringify(aAlloc)})`);
    expect(Number(byEmp.get(U.A).gross) === 9000 + 3703.68,
      `A gross = salary + day-rate = 12703.68 (got ${byEmp.get(U.A).gross})`);

    // E: sequential assignments with DIFFERENT contracts/rates — dates 14,15 on
    // contract E1 @1000, dates 16,17 on contract E2 @1200 ⇒ 2000 + 2400 = 4400.
    const eCrew = byEmp.get(U.E).breakdown.crew;
    expect(eCrew.qualifyingDays === 4
      && JSON.stringify(eCrew.qualifyingDates) === JSON.stringify(['2026-06-14', '2026-06-15', '2026-06-16', '2026-06-17']),
      `E qualifying dates 14..17 (got ${JSON.stringify(eCrew.qualifyingDates)})`);
    const eAllocs = eCrew.dayRate.allocations;
    const e1 = eAllocs.find(a => a.contractId === ids.contractE1);
    const e2 = eAllocs.find(a => a.contractId === ids.contractE2);
    expect(eAllocs.length === 2
      && e1 && e1.qualifyingDays === 2 && e1.compensationAmount === 1000 && e1.earningAmount === 2000
      && e2 && e2.qualifyingDays === 2 && e2.compensationAmount === 1200 && e2.earningAmount === 2400
      && eCrew.dayRate.totalAmount === 4400,
      `E per-contract allocations 2×1000 + 2×1200 (got ${JSON.stringify(eAllocs)})`);
    expect(Number(byEmp.get(U.E).gross) === 6000 + 4400,
      `E gross = 10400 (got ${byEmp.get(U.E).gross})`);

    // Allocation-to-line reconciliation: allocation sums equal the frozen input
    // rows equal the per-line dayRate totals.
    const inputs = await api('finance/payroll/inputs/list', T.mgr, { runId });
    ok(inputs, `inputs: ${inputs.body.message}`);
    const drInputs = inputs.body.data.filter(i => i.sourceType === 'crew_day_rate');
    expect(drInputs.length === 3, `3 frozen crew_day_rate input rows (got ${drInputs.length})`);
    const drSum = Math.round(drInputs.reduce((s, i) => s + Number(i.amount), 0) * 100) / 100;
    expect(drSum === 3703.68 + 4400, `input-row sum reconciles (got ${drSum})`);

    // CPE-20/26: qualifying-day evidence on A's line — deduped + cross-midnight safe.
    const crew = byEmp.get(U.A).breakdown.crew;
    expect(!!crew, 'A line carries breakdown.crew');
    expect(crew.qualifyingDays === 3
      && JSON.stringify(crew.qualifyingDates) === JSON.stringify(['2026-06-10', '2026-06-11', '2026-06-12']),
      `CPE-20 qualifying dates {10,11,12} (got ${JSON.stringify(crew.qualifyingDates)})`);
    expect(crew.movementIds.length === 3 && crew.dayBoundary === 'offshore_day'
      && crew.policyType === 'offshore_rotation', 'CPE-26 evidence fields');
    // CPE-23 (allocation reconciliation): every qualifying day attributed to a
    // costing dimension row; totals reconcile to the line.
    const allocDays = crew.allocations.reduce((s, a) => s + a.days, 0);
    expect(allocDays === crew.qualifyingDays
      && crew.allocations.length === 1 && crew.allocations[0].assetId === ids.assetA,
      `CPE-23 allocation days reconcile (got ${JSON.stringify(crew.allocations)})`);
    // B is not crew: no crew evidence on their line.
    expect(byEmp.get(U.B).breakdown.crew === undefined, 'B line has NO crew evidence');

    // CPE-24: the advisory OT finding did NOT suppress earned pay — A's full
    // salary + full frozen day-rate earnings are both intact (asserted above).

    // CPE-19/21/28: exact finding rows from the atomic publish.
    const verId = calc.body.data.currentCalculationVersionId
      ?? (await sb.from('finance_payroll_runs').select('current_calculation_version_id').eq('id', runId).single()).data.current_calculation_version_id;
    const f = await sb.from('finance_payroll_control_findings')
      .select('finding_type, severity, domain, employee_id, state')
      .eq('run_id', runId).eq('calculation_version_id', verId)
      .like('finding_type', 'crew_%');
    expect(!f.error, `findings: ${f.error?.message}`);
    const ot = f.data.filter(x => x.finding_type === 'crew_unapproved_overtime_excluded');
    const st = f.data.filter(x => x.finding_type === 'crew_statutory_profile_incomplete');
    expect(ot.length === 1 && ot[0].employee_id === U.A && ot[0].severity === 'warning' && ot[0].domain === 'input',
      `CPE-19 exactly 1 advisory OT finding for A (got ${JSON.stringify(ot)})`);
    expect(st.length === 1 && st[0].employee_id === U.C && st[0].severity === 'blocker' && st[0].domain === 'statutory',
      `CPE-21 exactly 1 statutory blocker for C (got ${JSON.stringify(st)})`);
  });

  await test('CPE-25 — post-lock movement AND contract amendment cannot alter recalculation', async () => {
    const late = await api('hr/crew/movements/record', T.mgr, {
      employeeId: U.A, movementType: 'embark', occurredAt: '2026-06-20T06:00:00Z',
      assetId: ids.assetA, sourceSystem: 'marine_logistics', sourceReference: `SRC-${TAG}-J4`,
    });
    ok(late, `late movement: ${late.body.message}`); ids.movIds.push(late.body.data.movement.id);

    // Amend + supersede the live contract AFTER lock — recalculation must consume
    // only the FROZEN rate evidence, never re-read the contract.
    const amend = await sb.from('hr_contracts')
      .update({ compensation_amount: 9999.99, status: 'superseded' })
      .eq('id', ids.contractA);
    expect(!amend.error, `contract amend: ${amend.error?.message}`);

    const recalc = await api('finance/payroll/runs/calculate', T.mgr,
      { id: ids.cp7RunId, idempotencyKey: `crw7-recalc-${TAG}` });
    ok(recalc, `recalculate: ${recalc.body.message}`);
    const lines = await api('finance/payroll/run-lines/list', T.mgr, { runId: ids.cp7RunId });
    ok(lines, `run-lines: ${lines.body.message}`);
    const line = lines.body.data.find(l => l.employeeId === U.A);
    const crew = line.breakdown.crew;
    expect(crew.qualifyingDays === 3 && crew.movementIds.length === 3,
      `frozen snapshot unchanged: still 3 qualifying days / 3 movements (got ${crew.qualifyingDays}/${crew.movementIds.length})`);
    expect(crew.dayRate.totalAmount === 3703.68
      && crew.dayRate.allocations[0].compensationAmount === 1234.56
      && Number(line.gross) === 9000 + 3703.68,
      `frozen day-rate unchanged by amendment (got ${JSON.stringify(crew.dayRate)})`);

    // Duplicate-calc replay: the SAME calc key adds no version/findings/events.
    const before = await sb.from('finance_payroll_calculation_versions')
      .select('id', { count: 'exact', head: true }).eq('run_id', ids.cp7RunId);
    const evBefore = await sb.from('app_events')
      .select('id', { count: 'exact', head: true }).eq('source_entity_id', ids.cp7RunId);
    const replay = await api('finance/payroll/runs/calculate', T.mgr,
      { id: ids.cp7RunId, idempotencyKey: `crw7-recalc-${TAG}` });
    ok(replay, `calc replay: ${replay.body.message}`);
    const after = await sb.from('finance_payroll_calculation_versions')
      .select('id', { count: 'exact', head: true }).eq('run_id', ids.cp7RunId);
    const evAfter = await sb.from('app_events')
      .select('id', { count: 'exact', head: true }).eq('source_entity_id', ids.cp7RunId);
    expect(before.count === after.count && evBefore.count === evAfter.count,
      `same-key replay adds no versions/events (${before.count}->${after.count}, ${evBefore.count}->${evAfter.count})`);
  });

  await test('CP7b blockers — every typed contract/rate gate fails the lock atomically', async () => {
    // F (pg3, verified profile): assignment WITHOUT a contract + 3 qualifying days.
    const fAsg = await api('hr/crew/assignments/create', T.mgr, {
      employeeId: U.F, payGroupId: ids.pg3Id, assetId: ids.assetA,
      effectiveFrom: JUN.start, effectiveTo: JUN.end, status: 'active',
    });
    ok(fAsg, `F assignment: ${fAsg.body.message}`);
    const fAsgId = fAsg.body.data.id; ids.asgIds.push(fAsgId);
    for (const m of [
      { movementType: 'embark',    occurredAt: '2026-06-05T06:00:00Z', ref: `SRC-${TAG}-F1` },
      { movementType: 'disembark', occurredAt: '2026-06-07T20:00:00Z', ref: `SRC-${TAG}-F2` },
    ]) {
      const r = await api('hr/crew/movements/record', T.mgr, {
        employeeId: U.F, movementType: m.movementType, occurredAt: m.occurredAt,
        assetId: ids.assetA, sourceSystem: 'marine_logistics', sourceReference: m.ref,
      });
      ok(r, `F movement: ${r.body.message}`); ids.movIds.push(r.body.data.movement.id);
    }
    const runId = await createRunFixture({ requestKey: `crw7b-run-${TAG}`, payGroupId: ids.pg3Id, period: JUN });

    let attempt = 0;
    const expectBlock = async (code, label) => {
      attempt += 1;
      const r = await api('finance/payroll/runs/lock-inputs', T.mgr,
        { id: runId, idempotencyKey: `crw7b-lock-${TAG}-${attempt}` });
      fails(r);
      expect(r.status === 422 && r.body.error?.code === code,
        `${label}: expected 422 ${code} (got ${r.status} ${r.body.error?.code}: ${r.body.message})`);
      expect(Array.isArray(r.body.error?.details?.blockers) && r.body.error.details.blockers[0].code === code,
        `${label}: typed blocker details present`);
      const snaps = await sb.from('finance_payroll_input_snapshots')
        .select('id', { count: 'exact', head: true }).eq('run_id', runId);
      expect(snaps.count === 0, `${label}: NO snapshot on blocking failure (got ${snaps.count})`);
    };

    // 1. assignment has no contract at all.
    await expectBlock('crew.day_rate.contract_missing', 'missing contract');
    // 2. contract belongs to a different employee (A's contract on F's assignment).
    const up1 = await api('hr/crew/assignments/update', T.mgr, { id: fAsgId, contractId: ids.contractA });
    ok(up1, `attach mismatched contract: ${up1.body.message}`);
    await expectBlock('crew.day_rate.contract_employee_mismatch', 'employee mismatch');
    // 3. F's own contract, but not active.
    const fc = await sb.from('hr_contracts').insert({
      contract_no: `CRW-${TAG}-F1`, employee_id: U.F, title: 'F daily', status: 'draft',
      start_date: JUN.start, compensation_amount: 500.00,
      compensation_currency: 'TTD', compensation_period: 'daily',
    }).select('id').single();
    expect(!fc.error, `F contract: ${fc.error?.message}`);
    ids.contractF = fc.data.id;
    const up2 = await api('hr/crew/assignments/update', T.mgr, { id: fAsgId, contractId: ids.contractF });
    ok(up2, `attach F contract: ${up2.body.message}`);
    await expectBlock('crew.day_rate.contract_not_active', 'inactive contract');
    // 4. active but not effective for every attributed date (starts Jun-06; day Jun-05 uncovered).
    await sb.from('hr_contracts').update({ status: 'active', start_date: '2026-06-06' }).eq('id', ids.contractF);
    await expectBlock('crew.day_rate.contract_not_effective', 'uncovered qualifying date');
    // 5. covered, but not a daily rate.
    await sb.from('hr_contracts').update({ start_date: JUN.start, compensation_period: 'monthly' }).eq('id', ids.contractF);
    await expectBlock('crew.day_rate.rate_period_invalid', 'non-daily period');
    // 6. daily, but not TTD.
    await sb.from('hr_contracts').update({ compensation_period: 'daily', compensation_currency: 'USD' }).eq('id', ids.contractF);
    await expectBlock('crew.day_rate.currency_invalid', 'non-TTD currency');
    // 7. TTD, but no positive amount.
    await sb.from('hr_contracts').update({ compensation_currency: 'TTD', compensation_amount: 0 }).eq('id', ids.contractF);
    await expectBlock('crew.day_rate.rate_amount_invalid', 'non-positive amount');

    // Fully valid → lock + calculate succeed: 3 days × 500 = 1500 on top of salary.
    await sb.from('hr_contracts').update({ compensation_amount: 500.00 }).eq('id', ids.contractF);
    const lk = await api('finance/payroll/runs/lock-inputs', T.mgr,
      { id: runId, idempotencyKey: `crw7b-lock-${TAG}-ok` });
    ok(lk, `valid lock: ${lk.body.message}`);
    const calc = await api('finance/payroll/runs/calculate', T.mgr,
      { id: runId, idempotencyKey: `crw7b-calc-${TAG}` });
    ok(calc, `calculate: ${calc.body.message}`);
    const lines = await api('finance/payroll/run-lines/list', T.mgr, { runId });
    ok(lines, `run-lines: ${lines.body.message}`);
    const f = lines.body.data.find(l => l.employeeId === U.F);
    expect(f.breakdown.crew.dayRate.totalAmount === 1500 && Number(f.gross) === 6000 + 1500,
      `F day-rate 3×500=1500, gross 7500 (got ${JSON.stringify(f.breakdown.crew.dayRate)} gross ${f.gross})`);
  });

  await test('CPE-15 — locked run keeps its pinned checksum after a later version activates', async () => {
    const runId = ids.runIds[0];
    const before = await api('finance/payroll/runs/get', T.mgr, { id: runId });
    ok(before, `runs/get: ${before.body.message}`);
    const pinnedChecksum = before.body.data.payPolicy?.checksum;
    expect(!!pinnedChecksum, 'run carries a pinned checksum');

    // Activate a later version of the same policy (service-seeded supersede).
    const v2 = await sb.from('finance_pay_policy_versions').insert({
      policy_id: ids.crewPolicy.policyId, version_no: 2, status: 'active',
      effective_from: '2026-01-01', change_summary: `CP6 supersede fixture [${TAG}]`,
      day_boundary: 'offshore_day', prepared_by: U.mgr, submitted_by: U.mgr,
      approved_by: U.mgr, activated_by: U.mgr,
      canonical_checksum: 'b'.repeat(64),
    }).select('id').single();
    expect(!v2.error, `v2 seed: ${v2.error?.message}`);
    const sup = await sb.from('finance_pay_policy_versions')
      .update({ status: 'superseded' }).eq('id', ids.crewPolicy.versionId);
    expect(!sup.error, `v1 supersede: ${sup.error?.message}`);

    const after = await api('finance/payroll/runs/get', T.mgr, { id: runId });
    ok(after, `runs/get after supersede: ${after.body.message}`);
    expect(after.body.data.payPolicy?.checksum === pinnedChecksum,
      `pinned checksum unchanged (got ${after.body.data.payPolicy?.checksum})`);
    const ev = await api('finance/payroll/runs/policy-evidence', T.mgr, { runId });
    ok(ev, `evidence after supersede: ${ev.body.message}`);
    expect(ev.body.data.checksum === pinnedChecksum, 'snapshot evidence checksum unchanged');
  });
}
