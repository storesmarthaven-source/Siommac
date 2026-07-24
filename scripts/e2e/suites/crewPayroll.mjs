// ═══════════════════════════════════════════════════════════════════════════
// Crew Payroll — live acceptance (CP4 assignments + CP5 movements), spec §14.6/§14.8/§14.9.
// ═══════════════════════════════════════════════════════════════════════════
// Real routes only (hr/crew/*), gated by finance.payroll.crew.* permissions. Opaque test
// fixtures (users, pay group, asset) seeded via the service-role client; the crew
// assignment/movement business rows are created THROUGH the real endpoints. Asserts §2
// side effects (app_events + audit_logs) via the service client. Rows tagged h.TAG.
// Covers CPE-01..07. Run: npm run test:e2e -- crewPayroll  (on the worktree dev server).

import { randomUUID as uuid } from 'node:crypto';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  h.section('Crew Payroll — assignments + movements (CP4/CP5)');

  const U = { mgr: `CRP-MGR-${TAG}`, plain: `CRP-EMP-${TAG}`, A: `CRP-EA-${TAG}`, B: `CRP-EB-${TAG}` };
  let T = {};
  const ids = { pgId: null, assetA: null, assetB: null, asgIds: [], movIds: [] };

  h.onCleanup(async () => {
    try { await sb.from('hr_crew_movements').delete().in('employee_id', [U.A, U.B]); } catch {}
    try { await sb.from('hr_crew_assignments').delete().in('employee_id', [U.A, U.B]); } catch {}
    try { await sb.from('app_events').delete().in('actor_user_id', Object.values(U)); } catch {}
    try { await sb.from('audit_logs').delete().in('user_id', Object.values(U)); } catch {}
    for (const a of [ids.assetA, ids.assetB]) { if (a) { try { await sb.from('ops_assets').delete().eq('id', a); } catch {} } }
    if (ids.pgId) { try { await sb.from('finance_pay_groups').delete().eq('id', ids.pgId); } catch {} }
    try { await sb.from('app_users').delete().in('id', Object.values(U)); } catch {}
  });

  const evCount = (entityId, type) =>
    sb.from('app_events').select('id', { count: 'exact', head: true }).eq('source_entity_id', entityId).eq('event_type', type);
  const auditCount = (entityId) =>
    sb.from('audit_logs').select('id', { count: 'exact', head: true }).eq('record_id', entityId);

  await test('CRP-setup — users, pay group, two assets', async () => {
    const { error } = await sb.from('app_users').insert([
      { id: U.mgr,   username: `${TAG}_crp_mgr`, full_name: 'Crew Manager', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: U.plain, username: `${TAG}_crp_emp`, full_name: 'Crew Plain',   role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: U.A, username: `${TAG}_crp_ea`, full_name: 'Crew Emp A', role: 'employee', status: 'active', employment_type: 'employee' },
      { id: U.B, username: `${TAG}_crp_eb`, full_name: 'Crew Emp B', role: 'employee', status: 'active', employment_type: 'employee' },
    ]);
    expect(!error, `seed users: ${error?.message}`);
    T = {
      mgr:   mint({ id: U.mgr,   username: `${TAG}_crp_mgr`, role: 'finance_manager', department_id: null }),
      plain: mint({ id: U.plain, username: `${TAG}_crp_emp`, role: 'employee',        department_id: null }),
    };
    const pg = await sb.from('finance_pay_groups').insert({ code: `CRP-${TAG.slice(-5)}`, name: `Crew ${TAG}`, frequency: 'fortnightly', statutory_country: 'TT' }).select('id').single();
    expect(!pg.error, `pay group: ${pg.error?.message}`); ids.pgId = pg.data.id;
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
}
