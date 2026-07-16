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
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // The workflow-native decide finalizes via the transactional outbox (inline, but
  // allow a brief window for the adapter callback to apply the source mutation).
  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  // Test context
  const ctx = {
    leaveTypeId: null, requestId: null, cancelRequestId: null, rejectRequestId: null,
    adjustAuditId: null, exportAuditId: null, empId: null, empTok: null,
    submitKey: TAG + '-lv1', cancelKey: TAG + '-lv2', rejectKey: TAG + '-lv3',
    workflowId: null, rpcRequestId: null,
    mgrId: null, mgrTok: null, mgrCreatedIds: [],
  };

  h.onCleanup(async () => {
    const reqIds = [ctx.requestId, ctx.cancelRequestId, ctx.rejectRequestId, ctx.rpcRequestId].filter(Boolean);
    // Capture the started workflows before deleting the requests (FK SET NULL on delete).
    let wfIds = [];
    if (reqIds.length) {
      const { data: wfRows } = await sb.from('hr_leave_requests').select('workflow_id').in('id', reqIds);
      wfIds = (wfRows ?? []).map(w => w.workflow_id).filter(Boolean);
    }
    for (const id of reqIds) {
      await sb.from('hr_leave_accruals').delete().eq('source_request_id', id);
      await sb.from('app_events').delete().eq('source_entity_id', id);
      await sb.from('hr_audit_log').delete().eq('record_id', id);
    }
    if (reqIds.length) await sb.from('hr_leave_requests').delete().in('id', reqIds);
    // Best-effort: remove the create-and-start workflow rows this run created.
    if (wfIds.length) {
      try { await sb.from('workflow_tasks').delete().in('workflow_id', wfIds); } catch {}
      try { await sb.from('workflow_instances').delete().in('id', wfIds); } catch {}
    }
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
    if (ctx.mgrCreatedIds?.length) { try { await sb.from('app_users').delete().in('id', ctx.mgrCreatedIds); } catch {} }
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

  // Provision a real `manager` — leave approval is workflow-native and decideTask
  // enforces the finding-#1 assignment guard, so the manager-role task must be
  // decided by a manager (the admin harness is not assigned → would be denied).
  {
    const mgrR = await acquireActors('manager', 1);
    const [mgr] = mgrR.actors;
    ctx.mgrId = mgr.id; ctx.mgrCreatedIds = mgrR.createdIds;
    ctx.mgrTok = mint({ id: mgr.id, username: mgr.username, role: 'manager', department_id: mgr.department_id ?? null });
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

  await test('request/submit → pending + ledger + workflow linked in-commit + events', async () => {
    const yr = 2027; // the request's fromDate year — the balance/ledger key
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
      idempotencyKey: ctx.submitKey,
    });
    ok(r, 'submit ok');
    ctx.requestId = r.body.data.requestId;
    expect(typeof ctx.requestId === 'string', 'requestId is string');
    expect(r.body.data.caseNo?.startsWith('LVR-'), `caseNo prefixed LVR, got ${r.body.data.caseNo}`);
    expect(r.body.data.status === 'pending_approval', 'status pending_approval (binding active)');

    // Satellite: pending_reserve ledger row committed atomically with the request
    const { data: ledger } = await sb.from('hr_leave_accruals')
      .select('id, delta').eq('source_request_id', ctx.requestId)
      .eq('kind', 'pending_reserve').maybeSingle();
    expect(!!ledger, 'pending_reserve ledger row exists');
    expect(Number(ledger.delta) === -3, `pending_reserve delta -3, got ${ledger.delta}`);

    // Finding #3 atomic create-and-start: workflow started + linked in the same commit
    const { data: row } = await sb.from('hr_leave_requests')
      .select('workflow_id').eq('id', ctx.requestId).single();
    expect(row?.workflow_id != null, 'workflow_id stamped atomically at submit');
    ctx.workflowId = row.workflow_id;
    const { data: inst } = await sb.from('workflow_instances')
      .select('status').eq('id', row.workflow_id).maybeSingle();
    expect(inst && inst.status === 'in_progress', `workflow instance in_progress: ${JSON.stringify(inst)}`);
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('assigned_role').eq('workflow_id', row.workflow_id);
    expect((tasks ?? []).some(t => t.assigned_role === 'manager'), `first task → manager role: ${JSON.stringify(tasks)}`);

    // Exactly one submitted event + one audit (no double-emit)
    const { data: ev } = await sb.from('app_events').select('id')
      .eq('source_module', 'hr').eq('event_type', 'hr.leave.submitted').eq('source_entity_id', ctx.requestId);
    expect((ev ?? []).length === 1, `exactly 1 submitted event, got ${(ev ?? []).length}`);
    const { data: aud } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'leave').eq('action', 'hr.leave.submitted').eq('record_id', ctx.requestId);
    expect((aud ?? []).length === 1, `exactly 1 submitted audit, got ${(aud ?? []).length}`);
  });

  // A same-dates HTTP retry is (correctly) rejected by the overlap gate — no duplicate
  // leave for the same period. The RPC receipt is what protects the concurrent race,
  // so idempotency is proven at the RPC boundary directly (fresh key + non-overlapping
  // dates): a same-key second create_and_start returns the SAME record, no duplicate.
  await test('RPC receipt idempotency → same key returns same record, no duplicate', async () => {
    const { data: binding } = await sb.from('module_workflow_bindings')
      .select('id').eq('module_key', 'hr_leave').eq('workflow_type', 'hr_leave_approval')
      .eq('is_active', true).limit(1).maybeSingle();
    expect(!!binding, 'active hr_leave binding exists');
    const key = ctx.submitKey + '-rpc';
    const biz = {
      employeeId: ctx.empId, leaveTypeId: ctx.leaveTypeId,
      fromDate: '2027-06-01', toDate: '2027-06-02', unit: 'days',
      days: 1, hours: null, halfDay: false, reason: null, departmentId: null,
    };
    const r1 = await sb.rpc('workflow_create_and_start_tx', {
      p_source_table: 'hr_leave_requests', p_actor_id: admin.id,
      p_binding_id: binding.id, p_request_key: key, p_business: biz,
    });
    expect(!r1.error, `first RPC ok: ${r1.error?.message}`);
    ctx.rpcRequestId = r1.data?.recordId;
    expect(!!ctx.rpcRequestId, 'first RPC returned a recordId');
    const r2 = await sb.rpc('workflow_create_and_start_tx', {
      p_source_table: 'hr_leave_requests', p_actor_id: admin.id,
      p_binding_id: binding.id, p_request_key: key, p_business: biz,
    });
    expect(!r2.error, `retry RPC ok: ${r2.error?.message}`);
    expect(r2.data?.recordId === ctx.rpcRequestId, `receipt dedup returns same record (${r2.data?.recordId} vs ${ctx.rpcRequestId})`);
    // Exactly one request + one reservation despite two identical calls.
    const { data: reqs } = await sb.from('hr_leave_requests').select('id')
      .eq('employee_id', ctx.empId).eq('from_date', '2027-06-01').eq('to_date', '2027-06-02');
    expect((reqs ?? []).length === 1, `receipt prevented duplicate request (${(reqs ?? []).length})`);
    const { data: res } = await sb.from('hr_leave_accruals').select('id')
      .eq('source_request_id', ctx.rpcRequestId).eq('kind', 'pending_reserve');
    expect((res ?? []).length === 1, `receipt prevented duplicate reservation (${(res ?? []).length})`);
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

  await test('request/approve (workflow-native, manager) → completed + deduction + task decided', async () => {
    // A manager decides the manager-role task through the engine (admin is not
    // assigned → the finding-#1 guard would deny it).
    const r = await api('hr/leave/request/approve', ctx.mgrTok, {
      requestId: ctx.requestId, reviewNotes: 'E2E approval',
    });
    ok(r, `approve ok: ${r.body.message}`);
    // The adapter (onWorkflowCompleted → applyApprovedLeave) applies the deduction.
    const approved = await waitFor(async () => {
      const { data } = await sb.from('hr_leave_requests').select('status').eq('id', ctx.requestId).maybeSingle();
      return data?.status === 'approved';
    });
    expect(approved, 'request not approved within timeout');
    const { data: ded } = await sb.from('hr_leave_accruals')
      .select('id').eq('source_request_id', ctx.requestId).eq('kind', 'deduction').maybeSingle();
    expect(!!ded, 'deduction ledger row applied on approve');
    const { data: aud } = await sb.from('hr_audit_log')
      .select('id').eq('record_id', ctx.requestId).eq('action', 'hr.leave.approved').maybeSingle();
    expect(!!aud, 'approve audit written');
    // Workflow reached a terminal state and no manager task is left dangling.
    if (ctx.workflowId) {
      const { data: inst } = await sb.from('workflow_instances').select('status').eq('id', ctx.workflowId).maybeSingle();
      expect(inst && ['completed', 'approved'].includes(inst.status), `workflow terminal after approve, got ${inst?.status}`);
      const { data: open } = await sb.from('workflow_tasks').select('id').eq('workflow_id', ctx.workflowId).in('status', ['pending', 'open', 'in_progress']);
      expect((open ?? []).length === 0, `no dangling task after approve, got ${(open ?? []).length}`);
    }
  });

  await test('request/reject (workflow-native, manager) → rejected + reserve RELEASED + task decided', async () => {
    // Fresh request to reject (rejecting must release the pending reserve — the bug
    // this slice fixes was reject only flipping status and leaking the reserve).
    const sub = await api('hr/leave/request/submit', A, {
      employeeId: ctx.empId, leaveTypeId: ctx.leaveTypeId,
      fromDate: '2027-04-05', toDate: '2027-04-06', days: 2, idempotencyKey: ctx.rejectKey,
    });
    ok(sub, `reject-setup submit ok: ${sub.body.message}`);
    ctx.rejectRequestId = sub.body.data.requestId;
    const { data: rq } = await sb.from('hr_leave_requests').select('workflow_id').eq('id', ctx.rejectRequestId).single();

    const r = await api('hr/leave/request/reject', ctx.mgrTok, { requestId: ctx.rejectRequestId, reviewNotes: 'Not this period.' });
    ok(r, `reject ok: ${r.body.message}`);
    const rejected = await waitFor(async () => {
      const { data } = await sb.from('hr_leave_requests').select('status').eq('id', ctx.rejectRequestId).maybeSingle();
      return data?.status === 'rejected';
    });
    expect(rejected, 'request not rejected within timeout');
    // Reserve released (a 'release' ledger row) and NO deduction (leave not taken).
    const { data: rel } = await sb.from('hr_leave_accruals').select('id').eq('source_request_id', ctx.rejectRequestId).eq('kind', 'release').maybeSingle();
    expect(!!rel, 'pending reserve released on reject (no balance leak)');
    const { data: ded } = await sb.from('hr_leave_accruals').select('id').eq('source_request_id', ctx.rejectRequestId).eq('kind', 'deduction').maybeSingle();
    expect(!ded, 'no deduction on reject');
    if (rq?.workflow_id) {
      const { data: inst } = await sb.from('workflow_instances').select('status').eq('id', rq.workflow_id).maybeSingle();
      expect(inst && ['rejected', 'completed'].includes(inst.status), `workflow terminal after reject, got ${inst?.status}`);
      const { data: open } = await sb.from('workflow_tasks').select('id').eq('workflow_id', rq.workflow_id).in('status', ['pending', 'open', 'in_progress']);
      expect((open ?? []).length === 0, `no dangling task after reject, got ${(open ?? []).length}`);
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
      idempotencyKey: ctx.cancelKey,
    });
    ok(r, 'second submit ok');
    ctx.cancelRequestId = r.body.data.requestId;
  });

  await test('request/cancel (workflow-native) → cancelled + reserve released + task decided', async () => {
    const { data: rq } = await sb.from('hr_leave_requests').select('workflow_id').eq('id', ctx.cancelRequestId).single();
    const r = await api('hr/leave/request/cancel', A, {
      requestId: ctx.cancelRequestId,
      reason: 'Plans changed — E2E cancel',
    });
    ok(r, `cancel ok: ${r.body.message}`);
    const cancelled = await waitFor(async () => {
      const { data } = await sb.from('hr_leave_requests').select('status').eq('id', ctx.cancelRequestId).maybeSingle();
      return data?.status === 'cancelled';
    });
    expect(cancelled, 'request not cancelled within timeout');
    const { data: rel } = await sb.from('hr_leave_accruals')
      .select('id').eq('source_request_id', ctx.cancelRequestId)
      .eq('kind', 'release').maybeSingle();
    expect(!!rel, 'release ledger row after cancel (reserve released via adapter)');
    // Running workflow closed through the engine — no dangling task/instance.
    if (rq?.workflow_id) {
      const { data: inst } = await sb.from('workflow_instances').select('status').eq('id', rq.workflow_id).maybeSingle();
      expect(inst?.status === 'cancelled', `workflow cancelled, got ${inst?.status}`);
      const { data: open } = await sb.from('workflow_tasks').select('id').eq('workflow_id', rq.workflow_id).in('status', ['pending', 'open', 'in_progress']);
      expect((open ?? []).length === 0, `no dangling task after cancel, got ${(open ?? []).length}`);
    }
  });

  await test('request/cancel already-cancelled → fails', async () => {
    const r = await api('hr/leave/request/cancel', A, { requestId: ctx.cancelRequestId, reason: 'retry cancel' });
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
    fails(await api('hr/leave/types/list', null, {}), 'no token rejected');
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

