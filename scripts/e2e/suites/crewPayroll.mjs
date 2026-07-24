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
  };
  let T = {};
  const ids = {
    pgId: null, pg2Id: null, assetA: null, assetB: null, asgIds: [], movIds: [],
    crewPolicy: null, stdPolicy: null, runIds: [], mayMovementId: null,
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
    try { await sb.from('hr_crew_movements').delete().in('employee_id', [U.A, U.B, U.C]); } catch {}
    try { await sb.from('hr_crew_assignments').delete().in('employee_id', [U.A, U.B, U.C]); } catch {}
    try { await sb.from('app_events').delete().in('actor_user_id', Object.values(U)); } catch {}
    try { await sb.from('audit_logs').delete().in('user_id', Object.values(U)); } catch {}
    for (const a of [ids.assetA, ids.assetB]) { if (a) { try { await sb.from('ops_assets').delete().eq('id', a); } catch {} } }
    // Policy fixtures AFTER runs/snapshots, BEFORE the pay groups (restrict FKs).
    if (ids.crewPolicy) { try { await ids.crewPolicy.cleanup(); } catch {} }
    if (ids.stdPolicy)  { try { await ids.stdPolicy.cleanup(); } catch {} }
    for (const pg of [ids.pgId, ids.pg2Id]) {
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
    ]);
    expect(!error, `seed users: ${error?.message}`);
    T = {
      mgr:   mint({ id: U.mgr,   username: `${TAG}_crp_mgr`, role: 'finance_manager', department_id: null }),
      plain: mint({ id: U.plain, username: `${TAG}_crp_emp`, role: 'employee',        department_id: null }),
    };
    const pg = await sb.from('finance_pay_groups').insert([
      { code: `CRP-${TAG.slice(-5)}`, name: `Crew ${TAG}`,     frequency: 'monthly', statutory_country: 'TT' },
      { code: `CRS-${TAG.slice(-5)}`, name: `Crew Std ${TAG}`, frequency: 'monthly', statutory_country: 'TT' },
    ]).select('id');
    expect(!pg.error, `pay groups: ${pg.error?.message}`);
    ids.pgId = pg.data[0].id; ids.pg2Id = pg.data[1].id;
    const mem = await sb.from('finance_employee_pay_group_assignments').insert([
      { employee_id: U.A, pay_group_id: ids.pgId,  effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.B, pay_group_id: ids.pgId,  effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.C, pay_group_id: ids.pgId,  effective_from: '2026-01-01', created_by: U.mgr },
      { employee_id: U.D, pay_group_id: ids.pg2Id, effective_from: '2026-01-01', created_by: U.mgr },
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
  async function createRunFixture({ requestKey, payGroupId }) {
    const cr = await api('finance/payroll/runs/create', T.mgr, {
      idempotencyKey: requestKey, runType: 'scheduled', payGroupId,
      periodStart: MAY.start, periodEnd: MAY.end, payFrequency: 'monthly', payDate: MAY.end,
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

    const stdRunId = await createRunFixture({ requestKey: `std-run-${TAG}`, payGroupId: ids.pg2Id });
    const lk2 = await api('finance/payroll/runs/lock-inputs', T.mgr,
      { id: stdRunId, idempotencyKey: `std-lock-${TAG}` });
    ok(lk2, `std lock: ${lk2.body.message}`);
    const w2 = await api('finance/payroll/runs/workspace', T.mgr, { id: stdRunId });
    ok(w2, `std workspace: ${w2.body.message}`);
    expect(w2.body.data.crew === null,
      `crew must be null on a standard run workspace (got ${JSON.stringify(w2.body.data.crew)})`);
    const ev2 = await api('finance/payroll/runs/policy-evidence', T.mgr, { runId: stdRunId });
    ok(ev2, `std policy evidence: ${ev2.body.message}`);
    expect(ev2.body.data.crew === null, 'crew null in standard policy evidence');
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
