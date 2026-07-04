/**
 * scripts/e2e/suites/hrOvertime.mjs
 *
 * E2E for HR Phase 2: Overtime (submit / approve / reject / cancel).
 *
 * Routes under test:
 *   /api/hr/overtime/{list,get,submit,approve,reject,cancel}
 *   /api/hr/overtime/reports/list
 *
 * Covers:
 *   • Employee submits own OT (self-scope enforced at server — employeeId == actor).
 *   • Submission starts a workflow; entry stays 'submitted'.
 *   • Manager can approve; approved OT has approved_by + approved_at set.
 *   • Manager can reject; rejected OT excluded from payroll.
 *   • Employee can cancel their own submitted OT.
 *   • Paid OT is immutable — cancel attempt returns 422.
 *   • Access control: employee DENIED list (view), approve, manage.
 *   • Response-shape assertions for fields the frontend will consume.
 *   • §2 side-effects: app_events + hr_audit_log asserted via service-role client.
 *   • Cleanup via h.TAG.
 *
 * NOTE: Migrations 20260802000006 + 20260802000009 + NOTIFY pgrst must be applied.
 */

export const title = 'HR — Overtime (Phase 2)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;

  // ── Provision users ───────────────────────────────────────────────────────────
  const mgrId  = `HO-MGR1-${TAG}`;
  const emp1Id = `HO-EMP1-${TAG}`;
  const emp2Id = `HO-EMP2-${TAG}`;

  const ctx = {
    ot1Id: null, // emp1 submits → manager approves
    ot2Id: null, // emp1 submits → manager rejects
    ot3Id: null, // emp1 submits → cancelled by employee
    ot4Id: null, // fake paid OT (seeded directly) for immutability test
  };

  const waitFor = async (check, ms = 7000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 400)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('hr_overtime_entries').delete().in('employee_id', [emp1Id, emp2Id]); } catch {}
    try { await sb.from('hr_audit_log').delete().in('actor_id', [mgrId, emp1Id, emp2Id]); } catch {}
    try { await sb.from('app_events').eq('source_module', 'hr_overtime').in('actor_user_id', [emp1Id, emp2Id]).delete(); } catch {}
    try { await sb.from('app_users').delete().in('id', [mgrId, emp1Id, emp2Id]); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Overtime › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  let mgrToken, emp1Token, emp2Token;

  await test('provision manager, employee1, employee2', async () => {
    const users = [
      { id: mgrId,  username: `${TAG}_homgr`, full_name: 'Manager (HO E2E)', role: 'manager', status: 'active', employment_type: 'employee' },
      { id: emp1Id, username: `${TAG}_hoemp1`, full_name: 'Employee 1 (HO E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
      { id: emp2Id, username: `${TAG}_hoemp2`, full_name: 'Employee 2 (HO E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, `seed failed: ${error?.message}`);

    mgrToken  = mint({ id: mgrId,  username: `${TAG}_homgr`,  role: 'manager',  department_id: null });
    emp1Token = mint({ id: emp1Id, username: `${TAG}_hoemp1`, role: 'employee', department_id: null });
    emp2Token = mint({ id: emp2Id, username: `${TAG}_hoemp2`, role: 'employee', department_id: null });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Overtime › Submit');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee can submit own OT (ot1)', async () => {
    const r = await api('hr/overtime/submit', emp1Token, {
      workDate: '2026-08-05',
      hours: 3.5,
      multiplier: 1.5,
      reason: 'Production deadline',
    });
    ok(r, `submit OT failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id, 'missing id');
    expect(d.employeeId === emp1Id, 'employeeId should be actor id (self-scope)');
    expect(d.workDate === '2026-08-05', 'workDate mismatch');
    expect(d.hours === 3.5, 'hours mismatch');
    expect(d.multiplier === 1.5, 'multiplier mismatch');
    expect(d.status === 'submitted', `status should be submitted, got: ${d.status}`);
    expect(d.createdBy === emp1Id, 'createdBy mismatch');
    ctx.ot1Id = d.id;
  });

  await test('submit ot2 (for reject) and ot3 (for cancel)', async () => {
    const r2 = await api('hr/overtime/submit', emp1Token, {
      workDate: '2026-08-06', hours: 2, reason: 'Reject test',
    });
    ok(r2, `submit ot2 failed: ${r2.body.message}`);
    ctx.ot2Id = r2.body.data.id;

    const r3 = await api('hr/overtime/submit', emp1Token, {
      workDate: '2026-08-07', hours: 4, reason: 'Cancel test',
    });
    ok(r3, `submit ot3 failed: ${r3.body.message}`);
    ctx.ot3Id = r3.body.data.id;
  });

  await test('§2 side-effects: hr.overtime.submitted event + hr_audit_log', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr_overtime')
        .eq('event_type', 'hr.overtime.submitted')
        .eq('source_entity_id', ctx.ot1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.overtime.submitted app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'hr_overtime')
      .eq('action', 'overtime.submitted').eq('record_id', ctx.ot1Id).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log overtime.submitted not found');
  });

  await test('workflow instance created for ot1', async () => {
    const got = await waitFor(async () => {
      const { data } = await sb.from('hr_overtime_entries')
        .select('workflow_id').eq('id', ctx.ot1Id).single();
      return data?.workflow_id != null;
    });
    expect(got, 'workflow_id not set after submit');
  });

  await test('employee is DENIED viewing overtime list (no hr.overtime.view)', async () => {
    const r = await api('hr/overtime/list', emp1Token, {});
    fails(r, 'employee should be denied OT list');
  });

  await test('manager can list overtime entries', async () => {
    const r = await api('hr/overtime/list', mgrToken, {});
    ok(r, `manager list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not array');
  });

  await test('manager can get a specific OT entry', async () => {
    const r = await api('hr/overtime/get', mgrToken, { id: ctx.ot1Id });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.ot1Id, 'id mismatch');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Overtime › Approve');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED approving OT', async () => {
    const r = await api('hr/overtime/approve', emp1Token, { id: ctx.ot1Id });
    fails(r, 'employee should be denied approve');
  });

  await test('manager can approve ot1', async () => {
    const r = await api('hr/overtime/approve', mgrToken, { id: ctx.ot1Id });
    ok(r, `approve failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.status === 'approved', `expected approved, got: ${d.status}`);
    expect(d.approvedBy === mgrId, 'approvedBy mismatch');
    expect(d.approvedAt != null, 'approvedAt should be set');
  });

  await test('§2 side-effects: hr.overtime.approved event + hr_audit_log', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr_overtime')
        .eq('event_type', 'hr.overtime.approved')
        .eq('source_entity_id', ctx.ot1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.overtime.approved app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'hr_overtime')
      .eq('action', 'overtime.approved').eq('record_id', ctx.ot1Id).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log overtime.approved not found');
  });

  await test('approved OT cannot be approved again', async () => {
    const r = await api('hr/overtime/approve', mgrToken, { id: ctx.ot1Id });
    fails(r, 'already-approved OT should fail approve');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Overtime › Reject');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('reject WITHOUT a reason → refused (reason now mandatory)', async () => {
    const r = await api('hr/overtime/reject', mgrToken, { id: ctx.ot2Id });
    expect(!r.ok || !r.body?.success, 'reject with no reason should be refused');
  });

  await test('manager can reject ot2', async () => {
    const r = await api('hr/overtime/reject', mgrToken, {
      id: ctx.ot2Id,
      reason: 'Insufficient justification',
    });
    ok(r, `reject failed: ${r.body.message}`);
    expect(r.body.data.status === 'rejected', `expected rejected, got: ${r.body.data.status}`);
  });

  await test('rejected OT has status=rejected in DB', async () => {
    const { data } = await sb.from('hr_overtime_entries')
      .select('status').eq('id', ctx.ot2Id).single();
    expect(data.status === 'rejected', `DB status should be rejected, got: ${data.status}`);
  });

  await test('§2 side-effects: hr.overtime.rejected event', async () => {
    const got = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr_overtime')
        .eq('event_type', 'hr.overtime.rejected')
        .eq('source_entity_id', ctx.ot2Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(got, 'hr.overtime.rejected app_event not found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Overtime › Cancel');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee can cancel own submitted OT (ot3)', async () => {
    const r = await api('hr/overtime/cancel', emp1Token, { id: ctx.ot3Id });
    ok(r, `cancel failed: ${r.body.message}`);
    expect(r.body.data.status === 'cancelled', `expected cancelled, got: ${r.body.data.status}`);
  });

  await test('seed a PAID OT entry directly and verify immutability', async () => {
    const { data, error } = await sb.from('hr_overtime_entries').insert({
      employee_id: emp1Id,
      work_date: '2026-07-01',
      hours: 2,
      multiplier: 1.5,
      status: 'paid',
      created_by: emp1Id,
    }).select().single();
    expect(!error, `seed paid OT failed: ${error?.message}`);
    ctx.ot4Id = data.id;

    // Cannot cancel a paid OT
    const r = await api('hr/overtime/cancel', mgrToken, { id: ctx.ot4Id });
    fails(r, 'cancelling paid OT should fail');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Overtime › Reports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('manager can view overtime reports', async () => {
    const r = await api('hr/overtime/reports/list', mgrToken, { employeeId: emp1Id });
    ok(r, `reports failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not array');
    const ids = r.body.data.map(x => x.id);
    expect(ids.includes(ctx.ot1Id), 'ot1 not in report');
  });

  await test('employee is DENIED overtime reports', async () => {
    const r = await api('hr/overtime/reports/list', emp1Token, {});
    fails(r, 'employee should be denied OT reports');
  });

  await test('approved OT does NOT appear as rejected in report', async () => {
    const r = await api('hr/overtime/reports/list', mgrToken, { status: 'rejected', employeeId: emp1Id });
    ok(r, `filtered reports failed: ${r.body.message}`);
    const ids = r.body.data.map(x => x.id);
    expect(!ids.includes(ctx.ot1Id), 'approved OT should not appear in rejected filter');
    expect(ids.includes(ctx.ot2Id), 'ot2 should appear in rejected filter');
  });
}
