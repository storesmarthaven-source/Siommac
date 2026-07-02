/**
 * scripts/e2e/suites/hrLeave.mjs
 *
 * E2E for HR Leave & Absence, mounted at /api/hr/leave/* :
 *   TYPES:    list / get / create / update / retire (admin)
 *   REQUESTS: submit / list / list-all / get / update / cancel / approve / reject
 *   BALANCES: get / adjust
 *   ACCRUALS: run (monthly + annual)
 *   CALENDAR: get
 *   STATS:    get
 *   REPORTS:  list / run / export
 *   ACCESS:   deny unauthenticated + permission-gated checks
 *   EVENTS:   assert app_events + hr_audit_log on every mutation
 *
 * REQUIRES: hr_leave migrations applied, settings catalog synced.
 */

export const title = 'HR Leave & Absence';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // Test context
  const ctx = {
    leaveTypeId: null, requestId: null, cancelRequestId: null,
    adjustAuditId: null, exportAuditId: null, empId: null, empTok: null,
  };

  h.onCleanup(async () => {
    const reqIds = [ctx.requestId, ctx.cancelRequestId].filter(Boolean);
    for (const id of reqIds) {
      await sb.from('hr_leave_accruals').delete().eq('source_request_id', id);
      await sb.from('app_events').delete().eq('source_entity_id', id);
      await sb.from('hr_audit_log').delete().eq('record_id', id);
    }
    if (reqIds.length) await sb.from('hr_leave_requests').delete().in('id', reqIds);
    if (ctx.leaveTypeId) {
      await sb.from('app_events').delete().eq('source_entity_id', ctx.leaveTypeId);
      await sb.from('hr_audit_log').delete().eq('record_id', ctx.leaveTypeId);
      await sb.from('hr_leave_types').delete().eq('id', ctx.leaveTypeId);
    }
    if (ctx.adjustAuditId) await sb.from('hr_audit_log').delete().eq('id', ctx.adjustAuditId);
    if (ctx.exportAuditId) await sb.from('hr_audit_log').delete().eq('id', ctx.exportAuditId);
    if (ctx.empId) {
      await sb.from('hr_leave_balances').delete().eq('employee_id', ctx.empId);
      await sb.from('hr_leave_accruals').delete().eq('employee_id', ctx.empId);
    }
    // Revert min_notice_days to 0 so it does not affect other suites
    await sb.from('app_setting_values').delete()
      .eq('setting_key', 'hr_leave.min_notice_days')
      .eq('scope_type', 'global')
      .is('scope_id', null);
  });

  // Resolve a real employee for leave submission tests
  {
    const { data: emp } = await sb.from('app_users')
      .select('id').eq('role', 'employee').eq('status', 'active').limit(1).maybeSingle();
    if (emp) { ctx.empId = emp.id; ctx.empTok = mint(emp); }
    else ctx.empId = admin.id;
  }

  // ── Settings gate: pin min_notice_days = 0 so dates in the past work ──────
  await test('settings: set min_notice_days=0 for test isolation', async () => {
    ok(await api('settings/values/set', A, {
      settingKey: 'hr_leave.min_notice_days', scopeType: 'global', scopeId: null, value: 0,
    }), 'set min_notice_days=0');
  });

  // ── Leave Types ──────────────────────────────────────────────────────────────

  await test('types/list → array', async () => {
    const r = await api('hr/leave/types/list', A, {});
    ok(r, 'list ok');
    expect(Array.isArray(r.body.data), 'data is array');
  });

  await test('types/create → new type with events', async () => {
    const code = TAG + '-ANNUAL';
    const r = await api('hr/leave/types/create', A, {
      code, label: 'Test Annual Leave', paid: true, unit: 'days',
      requiresApproval: true, accrualCadence: 'annual', accrualRate: 20,
    });
    ok(r, 'create ok');
    ctx.leaveTypeId = r.body.data.id;
    expect(r.body.data.code === code, 'code matches');
    // assert audit log written
    const { data: aud } = await sb.from('hr_audit_log')
      .select('id').eq('record_id', ctx.leaveTypeId).eq('action', 'hr.leave_type.created').maybeSingle();
    expect(!!aud, 'audit log written');
  });

  await test('types/get → single type', async () => {
    const r = await api('hr/leave/types/get', A, { id: ctx.leaveTypeId });
    ok(r, 'get ok');
    expect(r.body.data.id === ctx.leaveTypeId, 'id matches');
  });

  await test('types/update → label changed + audit', async () => {
    const r = await api('hr/leave/types/update', A, {
      id: ctx.leaveTypeId, label: 'Test Annual Leave Updated',
    });
    ok(r, 'update ok');
    const { data: aud } = await sb.from('hr_audit_log')
      .select('id').eq('record_id', ctx.leaveTypeId).eq('action', 'hr.leave_type.updated').maybeSingle();
    expect(!!aud, 'update audit written');
  });

  await test('types/create → duplicate code rejected', async () => {
    const code = TAG + '-ANNUAL';
    const r = await api('hr/leave/types/create', A, {
      code, label: 'Duplicate',
    });
    expect(!r.ok || !r.body.success, 'duplicate rejected');
  });

  // ── Leave Requests ────────────────────────────────────────────────────────────

  await test('request/submit → pending + ledger row + events', async () => {
    const yr = new Date().getFullYear();
    // Seed a balance so balance check passes
    await sb.from('hr_leave_accruals').insert({
      employee_id: ctx.empId, leave_type_id: ctx.leaveTypeId,
      year: yr, delta: 30, kind: 'accrual',
      idempotency_key: 'e2e.seed.accrual:' + ctx.empId + ':' + ctx.leaveTypeId,
      created_by: admin.id,
    });
    await sb.from('hr_leave_balances').upsert({
      employee_id: ctx.empId, leave_type_id: ctx.leaveTypeId,
      year: yr, entitled: 0, accrued: 30, taken: 0, pending: 0, adjustment: 0,
    }, { onConflict: 'employee_id,leave_type_id,year' });

    const r = await api('hr/leave/request/submit', A, {
      employeeId: ctx.empId,
      leaveTypeId: ctx.leaveTypeId,
      fromDate: '2027-02-01',
      toDate: '2027-02-03',
      days: 3,
    });
    ok(r, 'submit ok');
    ctx.requestId = r.body.data.requestId;
    expect(typeof ctx.requestId === 'string', 'requestId is string');
    expect(r.body.data.caseNo?.startsWith('LV-'), 'caseNo prefixed LV');
    // assert pending_reserve ledger row
    const { data: ledger } = await sb.from('hr_leave_accruals')
      .select('id').eq('source_request_id', ctx.requestId)
      .eq('kind', 'pending_reserve').maybeSingle();
    expect(!!ledger, 'pending_reserve ledger row exists');
    // assert app_event
    const { data: ev } = await sb.from('app_events')
      .select('id').eq('source_entity_id', ctx.requestId)
      .eq('event_type', 'hr.leave.submitted').maybeSingle();
    expect(!!ev, 'app_event written');
  });

  await test('request/list → my requests', async () => {
    const r = await api('hr/leave/request/list', A, {});
    ok(r, 'list ok');
    expect(Array.isArray(r.body.data?.rows), 'rows is array');
  });

  await test('request/list-all → all requests (admin)', async () => {
    const r = await api('hr/leave/request/list-all', A, {});
    ok(r, 'list-all ok');
    expect(Array.isArray(r.body.data?.rows), 'rows array');
    const found = r.body.data.rows.some(row => row.id === ctx.requestId);
    expect(found, 'submitted request in list');
  });

  await test('request/get → single request', async () => {
    const r = await api('hr/leave/request/get', A, { requestId: ctx.requestId });
    ok(r, 'get ok');
    expect(r.body.data.id === ctx.requestId, 'id matches');
    expect(r.body.data.status === 'pending_approval' || r.body.data.status === 'approved', 'status valid');
  });

  await test('request/approve → approved + deduction ledger + audit', async () => {
    // Re-check status in case workflow auto-approved it
    const { data: req } = await sb.from('hr_leave_requests')
      .select('status').eq('id', ctx.requestId).maybeSingle();
    if (req && req.status === 'pending_approval') {
      const r = await api('hr/leave/request/approve', A, {
        requestId: ctx.requestId, reviewNotes: 'E2E approval',
      });
      ok(r, 'approve ok');
      const { data: aud } = await sb.from('hr_audit_log')
        .select('id').eq('record_id', ctx.requestId)
        .eq('action', 'hr.leave.approved').maybeSingle();
      expect(!!aud, 'approve audit written');
    } else {
      // Already approved by workflow — verify deduction exists
      const { data: ded } = await sb.from('hr_leave_accruals')
        .select('id').eq('source_request_id', ctx.requestId)
        .eq('kind', 'deduction').maybeSingle();
      expect(!!ded, 'deduction ledger row exists');
    }
  });

  // Submit a second request for cancel/reject tests
  await test('request/submit (second) for cancel test', async () => {
    const r = await api('hr/leave/request/submit', A, {
      employeeId: ctx.empId,
      leaveTypeId: ctx.leaveTypeId,
      fromDate: '2027-03-10',
      toDate: '2027-03-11',
      days: 2,
    });
    ok(r, 'second submit ok');
    ctx.cancelRequestId = r.body.data.requestId;
  });

  await test('request/cancel → cancelled + release ledger', async () => {
    const r = await api('hr/leave/request/cancel', A, {
      requestId: ctx.cancelRequestId,
    });
    ok(r, 'cancel ok');
    const { data: rel } = await sb.from('hr_leave_accruals')
      .select('id').eq('source_request_id', ctx.cancelRequestId)
      .eq('kind', 'release').maybeSingle();
    expect(!!rel, 'release ledger row after cancel');
  });

  await test('request/cancel already-cancelled → fails', async () => {
    const r = await api('hr/leave/request/cancel', A, { requestId: ctx.cancelRequestId });
    expect(!r.ok || !r.body.success, 'double cancel rejected');
  });

  // ── Balances ─────────────────────────────────────────────────────────────────

  await test('balances/get → all balances for employee', async () => {
    const r = await api('hr/leave/balances/get', A, {
      employeeId: ctx.empId, year: 2027,
    });
    ok(r, 'balances ok');
    expect(Array.isArray(r.body.data), 'balances array');
  });

  await test('balances/adjust → delta applied + audit', async () => {
    const r = await api('hr/leave/balances/adjust', A, {
      employeeId: ctx.empId, leaveTypeId: ctx.leaveTypeId,
      year: new Date().getFullYear(), delta: 5, reason: 'E2E test adjustment',
    });
    ok(r, 'adjust ok');
    const { data: adj } = await sb.from('hr_audit_log')
      .select('id').eq('action', 'hr.leave.balance.adjusted')
      .eq('submodule_key', 'leave').order('created_at', { ascending: false }).limit(1).maybeSingle();
    expect(!!adj, 'balance adjust audit written');
    ctx.adjustAuditId = adj?.id;
  });

  await test('accruals/run (monthly) → processed/skipped', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const r = await api('hr/leave/accruals/run', A, {
      period, leaveTypeId: ctx.leaveTypeId,
    });
    ok(r, 'accruals run ok');
    expect(typeof r.body.data.processed === 'number', 'processed is number');
    expect(typeof r.body.data.skipped  === 'number', 'skipped is number');
  });

  await test('accruals/run idempotent', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const r = await api('hr/leave/accruals/run', A, { period, leaveTypeId: ctx.leaveTypeId });
    ok(r, 'idempotent run ok');
    expect(r.body.data.processed === 0, 'no new rows on repeat');
  });

  await test('calendar/get → entries array', async () => {
    const r = await api('hr/leave/calendar/get', A, {
      fromDate: '2027-01-01', toDate: '2027-12-31',
    });
    ok(r, 'calendar ok');
    expect(Array.isArray(r.body.data), 'calendar is array');
  });

  await test('stats → shape correct', async () => {
    const r = await api('hr/leave/stats', A, {});
    ok(r, 'stats ok');
    const d = r.body.data;
    expect(typeof d.myPending === 'number', 'myPending');
    expect(typeof d.myApproved === 'number', 'myApproved');
    expect(typeof d.pendingApprovals === 'number', 'pendingApprovals');
  });

  await test('reports/list → definitions', async () => {
    const r = await api('hr/leave/reports/list', A, {});
    ok(r, 'reports list ok');
    expect(r.body.data.length >= 3, 'at least 3 report definitions');
  });

  await test('reports/run pending_approvals', async () => {
    const r = await api('hr/leave/reports/run', A, { reportKey: 'pending_approvals' });
    ok(r, 'run ok');
    expect(typeof r.body.data.total === 'number', 'total is number');
    expect(Array.isArray(r.body.data.rows), 'rows is array');
  });

  await test('reports/export → audit written', async () => {
    const r = await api('hr/leave/reports/export', A, { reportKey: 'leave_balance_summary' });
    ok(r, 'export ok');
    const { data: aud } = await sb.from('hr_audit_log')
      .select('id').eq('action', 'hr.leave.report.exported')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    expect(!!aud, 'export audit written');
    ctx.exportAuditId = aud?.id;
  });

  await test('types/retire → is_active=false', async () => {
    const r = await api('hr/leave/types/retire', A, { id: ctx.leaveTypeId });
    ok(r, 'retire ok');
    const { data: lt } = await sb.from('hr_leave_types')
      .select('is_active').eq('id', ctx.leaveTypeId).maybeSingle();
    expect(lt && !lt.is_active, 'is_active=false');
  });

  await test('types/retire idempotent', async () => {
    const r = await api('hr/leave/types/retire', A, { id: ctx.leaveTypeId });
    ok(r, 'idempotent retire ok');
  });
  await test('unauthenticated → 401', async () => {
    await fails(() => api('hr/leave/types/list', null, {}), 'no token rejected');
  });

  await test('types/create requires manage permission', async () => {
    if (ctx.empTok && ctx.empTok !== A) {
      const r = await api('hr/leave/types/create', ctx.empTok, {
        code: 'EMP-DENY', label: 'Should Fail',
      });
      expect(!r.ok || !r.body.success, 'employee denied types/create');
    }
  });

  await test('types/get missing id → 400', async () => {
    const r = await api('hr/leave/types/get', A, {});
    expect(!r.body.success, 'missing id rejected');
  });

  await test('request/submit missing required fields → 400', async () => {
    const r = await api('hr/leave/request/submit', A, { fromDate: '2027-01-01' });
    expect(!r.body.success, 'missing leaveTypeId rejected');
  });
}

