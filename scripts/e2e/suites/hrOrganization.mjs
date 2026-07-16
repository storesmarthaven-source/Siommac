/**
 * scripts/e2e/suites/hrOrganization.mjs
 *
 * E2E for HR Organization Structure (Phase A). Backend routes in hr.ts (/api/hr):
 *   organization/{tree,unit/get,unit/create,unit/update,unit/move,unit/archive,unit/delete,stats,health,change/preview}
 *   positions/{list,get,create,update,retire} · cost-centers/{list,create,update,retire}
 *
 * Covers: every endpoint · hierarchy invariants (cycle move / guarded delete) ·
 * position reports-to cycle · optimistic concurrency (409) · cost-centre reuse of
 * finance_cost_centers (no hr_cost_centers) · access control (employee denied,
 * hr_staff view-only) · §2 side-effects (app_events + hr_audit_log, polled).
 *
 * Requires migrations 20260715000000 (fields) + 20260715000001 (cost-centre perms)
 * applied + NOTIFY pgrst. Phase-B approval tests additionally need 000002 (CR envelope)
 * + 000003 (delete/override perms) + 000004 (workflow template + binding); without the
 * binding the approval-routing assertions self-skip. Provisions REAL employee / hr_staff
 * / hr_manager users (roles resolve from app_users, never from the JWT).
 */

export const title = 'HR — Organization Structure (Phase A)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  let empUserId, staffUserId, mgrUserId;
  const ccCode      = `${TAG}-CC`;
  const posKey1     = `${TAG}-POS1`;
  const posKey2     = `${TAG}-POS2`;
  const ctx = { ccId: null, rootId: null, childId: null, posId1: null, posId2: null, empT: null, staffT: null, mgrT: null, pbRoot: null, pbChild: null, pbCrId: null, orgKey: TAG + '-orgmove', createdUserIds: [] };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    // Scoped by the SPECIFIC change request this run created (ctx.pbCrId) + the
    // TAG-stamped manual seed — NOT by requested_by=mgrUserId, which may now be a
    // real hr_manager with unrelated real change requests that must not be deleted.
    try { await sb.from('hr_org_change_requests').delete().or(`id.eq.${ctx.pbCrId ?? '00000000-0000-0000-0000-000000000000'},change_no.ilike.%${TAG}%`); } catch {}
    try { if (ctx.pbCrId) await sb.from('workflow_instances').delete().eq('module_key', 'hr_org_structure').eq('source_record_id', ctx.pbCrId); } catch {}
    try { await sb.from('hr_positions').delete().ilike('position_key', `%${TAG}%`); } catch {}
    try { await sb.from('departments').delete().ilike('name', `%${TAG}%`); } catch {}
    try { await sb.from('finance_cost_centers').delete().ilike('code', `%${TAG}%`); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'hr').ilike('source_entity_id', `%${TAG}%`); } catch {}
  });

  // ── Setup: acquire employee + hr_staff users (real roster preferred) ─────────
  h.section('Org › Setup');

  await test('acquire employee + hr_staff users', async () => {
    const empR = await acquireActors('employee', 1);
    const stfR = await acquireActors('hr_staff', 1);
    const [emp] = empR.actors, [staff] = stfR.actors;
    empUserId = emp.id; staffUserId = staff.id;
    ctx.createdUserIds.push(...empR.createdIds, ...stfR.createdIds);
    ctx.empT = mint({ id: empUserId, username: emp.username, role: 'employee', department_id: emp.department_id ?? null });
    ctx.staffT = mint({ id: staffUserId, username: staff.username, role: 'hr_staff', department_id: staff.department_id ?? null });
  });

  // ── Cost centres (shared finance_cost_centers registry) ───────────────────────
  h.section('Org › Cost centres');

  await test('cost-centers/create → row lives in finance_cost_centers (no hr_cost_centers)', async () => {
    const r = await api('hr/cost-centers/create', A, { code: ccCode, name: `Ops Payroll ${TAG}`, currency: 'TTD', annualBudget: 500000 });
    ok(r, `create cc failed: ${r.body.message}`);
    ctx.ccId = r.body.data.id;
    const { data } = await sb.from('finance_cost_centers').select('id, is_active').eq('id', ctx.ccId).maybeSingle();
    expect(!!data, 'cost centre not found in finance_cost_centers');
    expect(data.is_active === true, 'new cost centre should be active');
  });

  await test('cost-centers/create duplicate code → 409', async () => {
    const r = await api('hr/cost-centers/create', A, { code: ccCode, name: 'dup' });
    fails(r, 'duplicate cost-centre code should be rejected');
  });

  await test('cost-centers/list returns the new centre with assignedUnitCount', async () => {
    const r = await api('hr/cost-centers/list', A, {});
    ok(r, 'list cc failed');
    const row = r.body.data.find(c => c.id === ctx.ccId);
    expect(!!row && 'assignedUnitCount' in row, 'cost centre missing from list / no assignedUnitCount');
  });

  // ── Org units ─────────────────────────────────────────────────────────────────
  h.section('Org › Units');

  await test('unit/create root + child', async () => {
    const r1 = await api('hr/organization/unit/create', A, { name: `Division ${TAG}`, code: `${TAG}-DIV`, orgUnitType: 'division' });
    ok(r1, `create root failed: ${r1.body.message}`);
    ctx.rootId = r1.body.data.id;
    const r2 = await api('hr/organization/unit/create', A, { name: `Team ${TAG}`, code: `${TAG}-TEAM`, orgUnitType: 'team', parentId: ctx.rootId });
    ok(r2, `create child failed: ${r2.body.message}`);
    ctx.childId = r2.body.data.id;
  });

  await test('side-effects: org.unit.created event + hr_audit_log written', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('source_module', 'hr').eq('event_type', 'org.unit.created').eq('source_entity_id', ctx.rootId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'org.unit.created app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id').eq('submodule_key', 'organization').eq('action', 'hr.org_unit.created').eq('record_id', ctx.rootId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log row for org_unit.created not found');
  });

  await test('organization/tree returns enriched units (childCount, camelCase)', async () => {
    const r = await api('hr/organization/tree', A, {});
    ok(r, 'tree failed');
    const root = r.body.data.find(u => u.id === ctx.rootId);
    expect(!!root, 'root not in tree');
    expect(root.childCount >= 1, 'root childCount should be >= 1');
    expect('orgUnitType' in root && 'costCenterName' in root, 'enriched camelCase fields missing');
  });

  await test('unit/get returns detail with children', async () => {
    const r = await api('hr/organization/unit/get', A, { unitId: ctx.rootId });
    ok(r, 'unit/get failed');
    expect(Array.isArray(r.body.data.children), 'children missing');
    expect(r.body.data.children.some(c => c.id === ctx.childId), 'child not in detail');
  });

  let rootUpdatedAt = null;
  await test('unit/update assigns cost centre → departments.cost_center_id set', async () => {
    const r = await api('hr/organization/unit/update', A, { unitId: ctx.rootId, costCenterId: ctx.ccId });
    ok(r, `update failed: ${r.body.message}`);
    const { data } = await sb.from('departments').select('cost_center_id, updated_at').eq('id', ctx.rootId).maybeSingle();
    expect(data?.cost_center_id === ctx.ccId, 'cost_center_id not set on department');
    rootUpdatedAt = data?.updated_at ?? null;
  });

  await test('CONCURRENCY: stale expectedUpdatedAt → 409', async () => {
    const r = await api('hr/organization/unit/update', A, { unitId: ctx.rootId, name: `Division ${TAG} X`, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });
    fails(r, 'stale expectedUpdatedAt should 409');
    expect(r.status === 409, `expected 409, got ${r.status}`);
  });

  await test('HIERARCHY: move root under its own child → 409 (cycle)', async () => {
    const r = await api('hr/organization/unit/move', A, { unitId: ctx.rootId, newParentId: ctx.childId });
    fails(r, 'cycle move should be rejected');
    expect(r.status === 409, `expected 409, got ${r.status}`);
  });

  await test('HIERARCHY: delete root while it has a child → 409', async () => {
    const r = await api('hr/organization/unit/delete', A, { unitId: ctx.rootId });
    fails(r, 'delete of a unit with children should 409');
    expect(r.status === 409, `expected 409, got ${r.status}`);
  });

  await test('change/preview reports impact for delete', async () => {
    const r = await api('hr/organization/change/preview', A, { entityType: 'org_unit', entityId: ctx.rootId, action: 'delete' });
    ok(r, 'preview failed');
    expect(r.body.data.affectedChildUnits >= 1, 'preview should report child units');
    expect(Array.isArray(r.body.data.blockers), 'blockers array missing');
  });

  // ── Positions ─────────────────────────────────────────────────────────────────
  h.section('Org › Positions');

  await test('positions/create x2 (under root)', async () => {
    const r1 = await api('hr/positions/create', A, { positionKey: posKey1, title: `Supervisor ${TAG}`, departmentId: ctx.rootId, headcountBudget: 2, isSafetyCritical: true });
    ok(r1, `create pos1 failed: ${r1.body.message}`);
    ctx.posId1 = r1.body.data.id;
    const r2 = await api('hr/positions/create', A, { positionKey: posKey2, title: `Lead ${TAG}`, departmentId: ctx.rootId });
    ok(r2, `create pos2 failed: ${r2.body.message}`);
    ctx.posId2 = r2.body.data.id;
  });

  await test('positions/list computes incumbentCount + vacancy', async () => {
    const r = await api('hr/positions/list', A, {});
    ok(r, 'positions list failed');
    const p = r.body.data.find(x => x.id === ctx.posId1);
    expect(!!p, 'position not listed');
    expect(p.incumbentCount === 0, 'incumbentCount should be 0');
    expect(p.vacancy === 2, `vacancy should be 2, got ${p.vacancy}`);
  });

  await test('positions/get returns incumbents array', async () => {
    const r = await api('hr/positions/get', A, { positionId: ctx.posId1 });
    ok(r, 'positions/get failed');
    expect(Array.isArray(r.body.data.incumbents), 'incumbents missing');
  });

  await test('positions/update sets reports-to (pos1 → pos2)', async () => {
    const r = await api('hr/positions/update', A, { positionId: ctx.posId1, reportsToPositionId: ctx.posId2, idempotencyKey: TAG + '-posupd1' });
    ok(r, `update pos failed: ${r.body.message}`);
  });

  await test('HIERARCHY: position reports-to cycle → 409', async () => {
    const r = await api('hr/positions/update', A, { positionId: ctx.posId2, reportsToPositionId: ctx.posId1, idempotencyKey: TAG + '-posupd2' });
    fails(r, 'position reports-to cycle should be rejected');
    expect(r.status === 409, `expected 409, got ${r.status}`);
  });

  await test('positions/retire → position inactive', async () => {
    const r = await api('hr/positions/retire', A, { positionId: ctx.posId2 });
    ok(r, 'retire failed');
    const { data } = await sb.from('hr_positions').select('is_active').eq('id', ctx.posId2).maybeSingle();
    expect(data?.is_active === false, 'position not retired');
  });

  // ── Stats + health ──────────────────────────────────────────────────────────
  h.section('Org › Stats + health');

  await test('organization/stats returns the KPI shape', async () => {
    const r = await api('hr/organization/stats', A, {});
    ok(r, 'stats failed');
    for (const k of ['unitCount', 'activeUnitCount', 'positionCount', 'costCenterCount', 'employeesWithoutUnit', 'vacantSafetyCriticalPositions']) {
      expect(k in r.body.data, `stats missing ${k}`);
    }
  });

  await test('organization/health returns severity buckets + issues', async () => {
    const r = await api('hr/organization/health', A, {});
    ok(r, 'health failed');
    expect(Array.isArray(r.body.data.issues), 'issues missing');
    expect('criticalCount' in r.body.data && 'warningCount' in r.body.data, 'health counts missing');
  });

  // ── Access control (real provisioned roles) ───────────────────────────────────
  h.section('Org › Access control');

  await test('employee denied on tree (no org.view)', async () => {
    fails(await api('hr/organization/tree', ctx.empT, {}), 'employee should be denied org.view');
  });
  await test('employee denied on unit/create (no org.manage)', async () => {
    fails(await api('hr/organization/unit/create', ctx.empT, { name: `x ${TAG}` }), 'employee should be denied org.manage');
  });
  await test('hr_staff CAN read tree (view granted)', async () => {
    ok(await api('hr/organization/tree', ctx.staffT, {}), 'hr_staff should be allowed org.view');
  });
  await test('hr_staff CAN read cost-centers/list', async () => {
    ok(await api('hr/cost-centers/list', ctx.staffT, {}), 'hr_staff should be allowed cost_centers.view');
  });
  await test('hr_staff DENIED unit/create (oversight-only manage)', async () => {
    fails(await api('hr/organization/unit/create', ctx.staffT, { name: `y ${TAG}` }), 'hr_staff should not manage org');
  });
  await test('hr_staff DENIED cost-centers/create', async () => {
    fails(await api('hr/cost-centers/create', ctx.staffT, { name: `z ${TAG}` }), 'hr_staff should not manage cost centres');
  });

  // ── Phase B — approval envelope (requires migrations …000002-…000004 applied) ─
  h.section('Org › Phase B — approval');

  await test('acquire hr_manager (approval-tier, no override; real roster preferred)', async () => {
    const mgrR = await acquireActors('hr_manager', 1);
    const [mgr] = mgrR.actors;
    mgrUserId = mgr.id;
    ctx.createdUserIds.push(...mgrR.createdIds);
    ctx.mgrT = mint({ id: mgrUserId, username: mgr.username, role: 'hr_manager', department_id: mgr.department_id ?? null });
  });

  // Approval routing only activates once the org workflow binding (…000004) is applied.
  const { data: bindRows } = await sb.from('module_workflow_bindings').select('id').eq('module_key', 'hr_org_structure').eq('is_active', true).limit(1);
  const approvalOn = (bindRows ?? []).length > 0;
  if (!approvalOn) console.log('[hrOrganization] org approval binding (20260715000004) not applied — skipping approval-routing assertions.');

  await test('setup: Phase B parent + child units', async () => {
    const r1 = await api('hr/organization/unit/create', A, { name: `PB Div ${TAG}`, orgUnitType: 'division' });
    ok(r1, `create pb root failed: ${r1.body.message}`); ctx.pbRoot = r1.body.data.id;
    const r2 = await api('hr/organization/unit/create', A, { name: `PB Team ${TAG}`, orgUnitType: 'team', parentId: ctx.pbRoot });
    ok(r2, `create pb child failed: ${r2.body.message}`); ctx.pbChild = r2.body.data.id;
  });

  if (approvalOn) {
    await test('hr_manager high-risk move → pendingApproval + CR + workflow linked in-commit', async () => {
      const r = await api('hr/organization/unit/move', ctx.mgrT, { unitId: ctx.pbChild, newParentId: null, idempotencyKey: ctx.orgKey });
      ok(r, `move failed: ${r.body.message}`);
      expect(r.body.data?.mode === 'pendingApproval', `expected pendingApproval, got ${JSON.stringify(r.body.data)}`);
      ctx.pbCrId = r.body.data.changeRequestId;
      const { data: cr } = await sb.from('hr_org_change_requests').select('status, workflow_id').eq('id', ctx.pbCrId).maybeSingle();
      expect(cr?.status === 'pending_approval', `CR status ${cr?.status}`);
      expect(!!cr?.workflow_id, 'workflow_id not stamped atomically at submit');
      // Finding #3 atomic create-and-start: instance in_progress, first task → hr_manager
      const { data: wf } = await sb.from('workflow_instances').select('module_key, status').eq('id', cr.workflow_id).maybeSingle();
      expect(wf?.module_key === 'hr_org_structure', 'workflow instance not created for hr_org_structure');
      expect(wf?.status === 'in_progress', `workflow instance not in_progress: ${wf?.status}`);
      const { data: tasks } = await sb.from('workflow_tasks').select('assigned_role').eq('workflow_id', cr.workflow_id);
      expect((tasks ?? []).some(t => t.assigned_role === 'hr_manager'), `first task → hr_manager: ${JSON.stringify(tasks)}`);
      // exactly one business event + one audit
      const { data: ev } = await sb.from('app_events').select('id')
        .eq('source_module', 'hr').eq('event_type', 'org.change.requested').eq('source_entity_id', ctx.pbCrId);
      expect((ev ?? []).length === 1, `exactly 1 org.change.requested event, got ${(ev ?? []).length}`);
      const { data: aud } = await sb.from('hr_audit_log').select('id')
        .eq('submodule_key', 'organization').eq('action', 'hr.org_change.requested').eq('record_id', ctx.pbCrId);
      expect((aud ?? []).length === 1, `exactly 1 org_change audit, got ${(aud ?? []).length}`);
      const { data: unit } = await sb.from('departments').select('parent_id').eq('id', ctx.pbChild).maybeSingle();
      expect(unit?.parent_id === ctx.pbRoot, 'move applied before approval (should be held)');
    });

    await test('same-key retry → same CR, no duplicate workflow (idempotent)', async () => {
      const r = await api('hr/organization/unit/move', ctx.mgrT, { unitId: ctx.pbChild, newParentId: null, idempotencyKey: ctx.orgKey });
      ok(r, `retry failed: ${r.body.message}`);
      expect(r.body.data?.changeRequestId === ctx.pbCrId, `retry created a new CR (${r.body.data?.changeRequestId} vs ${ctx.pbCrId})`);
      const { data: crs } = await sb.from('hr_org_change_requests').select('id')
        .eq('entity_type', 'org_unit').eq('entity_id', ctx.pbChild).eq('action', 'move')
        .in('status', ['pending_approval', 'approved', 'scheduled']);
      expect((crs ?? []).length === 1, `retry duplicated the CR (${(crs ?? []).length})`);
    });

    await test('changes/list + change/get include the pending request', async () => {
      const r = await api('hr/organization/changes/list', A, { status: 'pending_approval' });
      ok(r, 'changes/list failed');
      expect(r.body.data.some(x => x.id === ctx.pbCrId), 'pending CR not in list');
      const g = await api('hr/organization/change/get', A, { changeRequestId: ctx.pbCrId });
      ok(g, 'change/get failed'); expect(g.body.data.riskLevel === 'high', `expected high risk, got ${g.body.data.riskLevel}`);
    });

    await test('change/cancel sets status cancelled', async () => {
      const r = await api('hr/organization/change/cancel', A, { changeRequestId: ctx.pbCrId, reason: 'test' });
      ok(r, `cancel failed: ${r.body.message}`);
      const { data: cr } = await sb.from('hr_org_change_requests').select('status').eq('id', ctx.pbCrId).maybeSingle();
      expect(cr?.status === 'cancelled', `CR status ${cr?.status}`);
    });
  }

  await test('ACCESS: apply-due denied for non-superadmin', async () => {
    fails(await api('hr/organization/changes/apply-due', ctx.mgrT, {}), 'hr_manager should not run the sweep');
  });

  // Effective-dating sweep exercises the SAME dispatchApply the approval adapter uses
  // on completion — insert a scheduled change directly, sweep, assert it lands.
  if (admin.role === 'superadmin') {
    await test('apply-due applies a scheduled change + marks it applied', async () => {
      const { data: cr, error } = await sb.from('hr_org_change_requests').insert({
        change_no: `ORC-${TAG}-SCHED`, entity_type: 'org_unit', entity_id: ctx.pbChild, action: 'archive',
        risk_level: 'high', status: 'scheduled', effective_from: new Date(Date.now() - 60000).toISOString(),
        old_state: { isActive: true }, new_state: { isActive: false }, requested_by: mgrUserId,
      }).select('id').single();
      expect(!error, `seed scheduled CR failed: ${error?.message}`);
      const r = await api('hr/organization/changes/apply-due', A, {});
      ok(r, `apply-due failed: ${r.body.message}`);
      const applied = await waitFor(async () => {
        const { data: u } = await sb.from('departments').select('is_active').eq('id', ctx.pbChild).maybeSingle();
        return u?.is_active === false;
      });
      expect(applied, 'scheduled archive not applied by sweep');
      const { data: done } = await sb.from('hr_org_change_requests').select('status').eq('id', cr.id).maybeSingle();
      expect(done?.status === 'applied', `scheduled CR status ${done?.status}`);
    });
  } else {
    console.log('[hrOrganization] harness admin is not superadmin — skipping apply-due sweep assertion.');
  }

  // ── Teardown of the tree (guarded delete happy path) ──────────────────────────
  h.section('Org › Delete (guarded happy path)');

  await test('archive child then delete empty units', async () => {
    // detach positions from root so it becomes deletable
    await sb.from('hr_positions').delete().ilike('position_key', `%${TAG}%`);
    ctx.posId1 = null; ctx.posId2 = null;
    const arch = await api('hr/organization/unit/archive', A, { unitId: ctx.childId });
    ok(arch, 'archive child failed');
    const delChild = await api('hr/organization/unit/delete', A, { unitId: ctx.childId, idempotencyKey: TAG + '-delchild' });
    ok(delChild, `delete child failed: ${delChild.body.message}`);
    const delRoot = await api('hr/organization/unit/delete', A, { unitId: ctx.rootId, idempotencyKey: TAG + '-delroot' });
    ok(delRoot, `delete root failed: ${delRoot.body.message}`);
    ctx.childId = null; ctx.rootId = null;
  });
}
