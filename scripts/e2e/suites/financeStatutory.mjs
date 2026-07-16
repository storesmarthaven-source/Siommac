/**
 * scripts/e2e/suites/financeStatutory.mjs
 *
 * E2E for Finance Phase 1: Pay-Component Catalogue + Statutory Configuration.
 *
 * Routes under test:
 *   /api/finance/statutory/versions/{list,get,create,update,submit,approve,reject,activate,retire}
 *   /api/finance/statutory/nis-classes/{list,upsert}
 *   /api/finance/statutory/reports/list
 *   /api/finance/payroll/components/{list,create,update,retire}
 *
 * Covers:
 *   • Finance roles exist in the DB.
 *   • Pay-component CRUD (list/create/update/retire).
 *   • Non-finance role (employee/manager) DENIED manage endpoints.
 *   • Statutory version draft→submit→approve lifecycle.
 *   • CREATOR ≠ APPROVER enforced: same user attempting approve returns 422.
 *   • HR role cannot manage statutory (422/403).
 *   • Activate retires the prior active version (one-active-per-jurisdiction).
 *   • Response-shape assertions for fields the frontend will consume.
 *   • §2 side-effects: app_events + hr_audit_log asserted via service-role client.
 *   • Cleanup via h.TAG.
 *
 * NOTE: These migrations must be applied to the live DB before running:
 *   20260802000000 → 20260802000004 + NOTIFY pgrst, 'reload schema';
 */

export const title = 'Finance — Statutory Configuration (Phase 1)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // ── Provision finance users for this suite (real roster preferred) ─────────
  let fmgr1Id, fmgr2Id, fstaff1Id, empId;

  const ctx = {
    sv1Id: null,  // first statutory version (to be activated, then superseded)
    sv2Id: null,  // second statutory version (to replace sv1 on activation)
    nisVersionId: null,
    seededActiveId: null,  // the REAL active TT version at suite start — restored in cleanup
    createdUserIds: [],
  };

  // Snapshot the currently-active TT statutory version BEFORE the activation tests run.
  // Those tests activate throwaway versions, which (one-active-per-jurisdiction) RETIRE
  // this seeded version; deleting the throwaways in cleanup would otherwise leave the real
  // seeded 2026 schedule retired with NO active version — exactly what left NIS 2026
  // retired in the app. We re-activate it in cleanup so the suite leaves no trace.
  try {
    const { data: activeRow } = await sb.from('finance_statutory_versions')
      .select('id').eq('jurisdiction', 'TT').eq('is_active', true).maybeSingle();
    ctx.seededActiveId = activeRow?.id ?? null;
  } catch { /* table may be empty on a fresh DB — nothing to restore */ }

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    // Delete test-created records in reverse dependency order
    try { await sb.from('finance_nis_classes').delete().in('statutory_version_id', [ctx.sv1Id, ctx.sv2Id].filter(Boolean)); } catch {}
    try { await sb.from('finance_statutory_versions').delete().or(`id.eq.${ctx.sv1Id},id.eq.${ctx.sv2Id}`).select(); } catch {}
    // Restore the real seeded active version that the activation tests retired (only after
    // the throwaways are gone, so one-active-per-jurisdiction is satisfied).
    try {
      if (ctx.seededActiveId) {
        await sb.from('finance_statutory_versions')
          .update({ status: 'active', is_active: true, retired_by: null, retired_at: null })
          .eq('id', ctx.seededActiveId);
      }
    } catch {}
    try { await sb.from('hr_audit_log').delete().in('actor_id', [fmgr1Id, fmgr2Id, fstaff1Id]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_statutory').in('actor_user_id', [fmgr1Id, fmgr2Id, fstaff1Id, empId]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll_components').in('actor_user_id', [fmgr1Id, fmgr2Id, fstaff1Id, empId]); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  let fmgr1Token, fmgr2Token, fstaff1Token, empToken;

  await test('finance_staff and finance_manager roles exist in roles table', async () => {
    const { data, error } = await sb.from('roles').select('name').in('name', ['finance_staff', 'finance_manager']);
    expect(!error, `roles query failed: ${error?.message}`);
    const names = (data ?? []).map(r => r.name);
    expect(names.includes('finance_staff'), 'finance_staff role missing from DB');
    expect(names.includes('finance_manager'), 'finance_manager role missing from DB');
  });

  await test('acquire two finance_manager users + one finance_staff + one employee (real roster preferred)', async () => {
    const mgrR = await acquireActors('finance_manager', 2);
    const stfR = await acquireActors('finance_staff', 1);
    const empR = await acquireActors('employee', 1);
    const [fmgr1, fmgr2] = mgrR.actors, [fstaff1] = stfR.actors, [emp] = empR.actors;
    fmgr1Id = fmgr1.id; fmgr2Id = fmgr2.id; fstaff1Id = fstaff1.id; empId = emp.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    fmgr1Token  = mint({ id: fmgr1Id,  username: fmgr1.username, role: 'finance_manager', department_id: fmgr1.department_id ?? null });
    fmgr2Token  = mint({ id: fmgr2Id,  username: fmgr2.username, role: 'finance_manager', department_id: fmgr2.department_id ?? null });
    fstaff1Token = mint({ id: fstaff1Id, username: fstaff1.username, role: 'finance_staff', department_id: fstaff1.department_id ?? null });
    empToken    = mint({ id: empId,    username: emp.username,  role: 'employee',        department_id: emp.department_id ?? null });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Pay Components — CRUD');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager can list pay components (active seed from migration)', async () => {
    const r = await api('finance/payroll/components/list', fmgr1Token, {});
    ok(r, `components list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data is not an array');
    // The seeded migration inserts 12 components
    expect(r.body.data.length >= 1, 'no seeded pay components found');
  });

  await test('finance_staff can view pay components', async () => {
    const r = await api('finance/payroll/components/list', fstaff1Token, {});
    ok(r, `finance_staff list failed: ${r.body.message}`);
  });

  await test('employee is DENIED pay components list', async () => {
    const r = await api('finance/payroll/components/list', empToken, {});
    fails(r, 'employee should be denied component list');
  });

  // Pay-component MUTATIONS are maker-checker since 8ba408d7: create/update/retire
  // return a pending CHANGE REQUEST, not a component. The full CR lifecycle
  // (submit → SoD → approve/reject → §2 events → atomic binding path) is covered
  // by the dedicated financePayComponents suite — only the read paths and the
  // permission negatives live here.
  await test('employee is DENIED creating a pay component', async () => {
    const r = await api('finance/payroll/components/create', empToken, {
      code: `EMP_${TAG.slice(-6)}`, name: 'Should fail', kind: 'earning',
    });
    fails(r, 'employee should be denied component create');
  });

  await test('finance_staff is DENIED creating a pay component', async () => {
    const r = await api('finance/payroll/components/create', fstaff1Token, {
      code: `STF_${TAG.slice(-6)}`, name: 'Should fail', kind: 'deduction',
    });
    fails(r, 'finance_staff should be denied component create');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Statutory Versions — Lifecycle');
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Draft creation ---
  await test('finance_manager can create a statutory version draft', async () => {
    const r = await api('finance/statutory/versions/create', fmgr1Token, {
      effectiveFrom: '2027-01-01',
      label: `E2E Test Version ${TAG}`,
      jurisdiction: 'TT',
      currency: 'TTD',
      payePersonalAllowance: 84000,
      payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25,
      payeBand2Rate: 0.30,
      hsMonthlyThreshold: 469.99,
      hsWeeklyHigh: 4.80,
      hsWeeklyLow: 2.40,
      nisMonthyCeiling: null,
    });
    ok(r, `create version failed: ${r.body.message}`);
    const d = r.body.data;
    // Response shape assertions
    expect(d.id,               'missing id');
    expect(d.effectiveFrom,    'missing effectiveFrom');
    expect(d.jurisdiction === 'TT', 'wrong jurisdiction');
    expect(d.status === 'draft',    'new version should be draft');
    expect(d.isActive === false,    'new version should not be active');
    expect(d.createdBy === fmgr1Id, 'createdBy mismatch');
    ctx.sv1Id = d.id;
  });

  await test('employee is DENIED creating statutory version', async () => {
    const r = await api('finance/statutory/versions/create', empToken, {
      effectiveFrom: '2028-01-01', label: 'Should fail',
      payePersonalAllowance: 1, payeBand1Ceiling: 1, payeBand1Rate: 0.1, payeBand2Rate: 0.1,
      hsMonthlyThreshold: 1, hsWeeklyHigh: 1, hsWeeklyLow: 1,
    });
    fails(r, 'employee should be denied create');
  });

  await test('finance_staff is DENIED creating statutory version', async () => {
    const r = await api('finance/statutory/versions/create', fstaff1Token, {
      effectiveFrom: '2028-01-01', label: 'Should fail',
      payePersonalAllowance: 1, payeBand1Ceiling: 1, payeBand1Rate: 0.1, payeBand2Rate: 0.1,
      hsMonthlyThreshold: 1, hsWeeklyHigh: 1, hsWeeklyLow: 1,
    });
    fails(r, 'finance_staff should be denied create');
  });

  await test('finance_staff can VIEW statutory versions', async () => {
    const r = await api('finance/statutory/versions/list', fstaff1Token, {});
    ok(r, `finance_staff list failed: ${r.body.message}`);
    expect(r.body.data.some(v => v.id === ctx.sv1Id), 'newly created version not in list');
  });

  await test('finance_manager can get a specific version', async () => {
    const r = await api('finance/statutory/versions/get', fmgr1Token, { id: ctx.sv1Id });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.sv1Id, 'wrong id');
  });

  await test('finance_manager can update a draft version', async () => {
    const r = await api('finance/statutory/versions/update', fmgr1Token, {
      id: ctx.sv1Id,
      label: `E2E Test Version (Updated) ${TAG}`,
      payePersonalAllowance: 90000,
    });
    ok(r, `update failed: ${r.body.message}`);
    expect(r.body.data.payePersonalAllowance === 90000, 'payePersonalAllowance not updated');
  });

  // --- NIS classes ---
  await test('finance_manager can upsert NIS classes for the draft version', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: ctx.sv1Id,
      classes: [
        { classNo: 1, weeklyMin: 0,    weeklyMax: 299.99, assumedAverageWeekly: 200, employeeWeekly: 12.95, employerWeekly: 19.40 },
        { classNo: 2, weeklyMin: 300,  weeklyMax: 399.99, employeeWeekly: 17.15, employerWeekly: 25.70 },
        { classNo: 3, weeklyMin: 400,  weeklyMax: null,   employeeWeekly: 21.35, employerWeekly: 32.00 },
      ],
    });
    ok(r, `upsert NIS classes failed: ${r.body.message}`);
    expect(r.body.data.length === 3, `expected 3 NIS classes, got ${r.body.data.length}`);
    ctx.nisVersionId = ctx.sv1Id;
  });

  await test('versions/list returns the derived nisRatePercent (dashboard rate-trend chart)', async () => {
    const r = await api('finance/statutory/versions/list', fmgr1Token, {});
    ok(r, `list failed: ${r.body.message}`);
    const v = r.body.data.find(x => x.id === ctx.sv1Id);
    expect(v, 'created version not in list');
    expect('nisRatePercent' in v, 'version row missing nisRatePercent (chart contract)');
    // rate = (employee + employer weekly) ÷ assumed-average weekly = (12.95 + 19.40) / 200 = 16.2%.
    expect(v.nisRatePercent === 16.2, `expected nisRatePercent 16.2, got ${v.nisRatePercent}`);
  });

  await test('finance_manager can list NIS classes', async () => {
    const r = await api('finance/statutory/nis-classes/list', fmgr1Token, { statutoryVersionId: ctx.sv1Id });
    ok(r, 'list NIS classes failed');
    expect(r.body.data.length === 3, `expected 3 NIS classes, got ${r.body.data.length}`);
    const c1 = r.body.data.find(c => c.classNo === 1);
    expect(c1, 'class 1 missing');
    // Response shape assertions
    expect('id'             in c1, 'NIS class missing id');
    expect('classNo'        in c1, 'NIS class missing classNo');
    expect('weeklyMin'      in c1, 'NIS class missing weeklyMin');
    expect('employeeWeekly' in c1, 'NIS class missing employeeWeekly');
    expect('employerWeekly' in c1, 'NIS class missing employerWeekly');
  });

  // --- Edit NIS Contribution Band page contract (design pivot 2026-07-08) ---
  await test('single-band upsert (Edit Band page contract): {classes:[one]} updates in place + full row shape', async () => {
    // The full-page NIS band editor sends EXACTLY this shape via financeStatutoryApi.upsertNisClass.
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: ctx.sv1Id,
      classes: [{ classNo: 2, weeklyMin: 300, weeklyMax: 399.99, employeeWeekly: 18.00, employerWeekly: 27.00 }],
    });
    ok(r, `single-band upsert failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'upsert should return an array');
    expect(r.body.data.length === 1, `expected 1 upserted row, got ${r.body.data.length}`);
    const row = r.body.data[0];
    for (const k of ['id', 'statutoryVersionId', 'classNo', 'weeklyMin', 'weeklyMax', 'employeeWeekly', 'employerWeekly', 'createdAt']) {
      expect(k in row, `upsert row missing ${k}`);
    }
    expect(row.classNo === 2, 'classNo mismatch');
    expect(Number(row.employeeWeekly) === 18.00, `employeeWeekly not updated, got ${row.employeeWeekly}`);

    // Idempotent update on class_no — list still has 3 (no duplicate band).
    const l = await api('finance/statutory/nis-classes/list', fmgr1Token, { statutoryVersionId: ctx.sv1Id });
    ok(l, 'list after single upsert failed');
    expect(l.body.data.length === 3, `expected 3 bands after in-place update, got ${l.body.data.length}`);
    const c2 = l.body.data.find(c => c.classNo === 2);
    expect(Number(c2.employerWeekly) === 27.00, `employerWeekly not persisted, got ${c2.employerWeekly}`);
  });

  await test('§2 side-effects: nis_classes.updated app_event + hr_audit_log row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'finance_statutory')
        .eq('event_type', 'finance.statutory.nis_classes.updated')
        .eq('source_entity_id', ctx.sv1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'finance.statutory.nis_classes.updated app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'finance_statutory')
      .eq('action', 'statutory_version.nis_classes_updated')
      .eq('record_id', ctx.sv1Id).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log statutory_version.nis_classes_updated not found');
  });

  // --- Submit (draft → pending_approval) ---
  await test('finance_manager (creator) can submit the version for approval — ATOMIC + idempotent (finding #3)', async () => {
    const key = `e2e-submit-1-${TAG}`;
    const r = await api('finance/statutory/versions/submit', fmgr1Token, { id: ctx.sv1Id, idempotencyKey: key });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'pending_approval', `expected pending_approval, got ${r.body.data.status}`);
    // Atomic: status + workflow_id committed together (no strand).
    const { data: row } = await sb.from('finance_statutory_versions').select('workflow_id').eq('id', ctx.sv1Id).maybeSingle();
    expect(row?.workflow_id, 'workflow_id must be stamped in the same commit (no strand)');
    const evc = (await sb.from('app_events').select('id', { count: 'exact', head: true }).eq('source_entity_id', ctx.sv1Id).eq('event_type', 'finance.statutory.version.submitted')).count ?? 0;
    expect(evc === 1, `exactly one submitted event, got ${evc}`);
    const auc = (await sb.from('hr_audit_log').select('id', { count: 'exact', head: true }).eq('record_id', ctx.sv1Id).eq('action', 'statutory_version.submitted')).count ?? 0;
    expect(auc === 1, `exactly one submitted audit, got ${auc}`);
    // Idempotent retry with the SAME key: succeeds via the receipt, creates no 2nd workflow.
    ok(await api('finance/statutory/versions/submit', fmgr1Token, { id: ctx.sv1Id, idempotencyKey: key }), 'idempotent retry should succeed');
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', ctx.sv1Id);
    expect((wfs ?? []).length === 1, `exactly one workflow after retry, got ${(wfs ?? []).length}`);
  });

  await test('submitted version cannot be updated (must be draft)', async () => {
    const r = await api('finance/statutory/versions/update', fmgr1Token, {
      id: ctx.sv1Id, label: 'Should fail — not draft',
    });
    fails(r, 'update of pending_approval version should fail');
  });

  // --- Segregation of duties: creator ≠ approver ---
  await test('CREATOR cannot approve their own submission (SoD violation → 422/error)', async () => {
    const r = await api('finance/statutory/versions/approve', fmgr1Token, { id: ctx.sv1Id });
    fails(r, 'creator should be denied approval of their own submission');
    expect(r.body.message?.toLowerCase().includes('segregation') || r.body.message?.toLowerCase().includes('creator'),
      `expected SoD error message, got: ${r.body.message}`);
  });

  // --- A DIFFERENT finance_manager can approve ---
  await test('DIFFERENT finance_manager can approve the submitted version', async () => {
    const r = await api('finance/statutory/versions/approve', fmgr2Token, { id: ctx.sv1Id });
    ok(r, `approve by mgr2 failed: ${r.body.message}`);
    expect(r.body.data.status === 'approved', `expected approved, got ${r.body.data.status}`);
    expect(r.body.data.approvedBy === fmgr2Id, 'approvedBy mismatch');
  });

  await test('§2 side-effects: statutory_version.approved event + hr_audit_log row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'finance_statutory')
        .eq('event_type', 'finance.statutory.version.approved')
        .eq('source_entity_id', ctx.sv1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'finance.statutory.version.approved app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'finance_statutory')
      .eq('action', 'statutory_version.approved')
      .eq('record_id', ctx.sv1Id).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log statutory_version.approved not found');
  });

  await test('§18 side-effects: approve creates a notification, message thread, and payroll handoff', async () => {
    // Notification (best-effort via event_rules — may be async; wait for it)
    const gotNotification = await waitFor(async () => {
      const { data } = await sb.from('notifications')
        .select('id').eq('source_id', ctx.sv1Id)
        .ilike('title', '%approved%').limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotNotification, 'notification for statutory_version.approved not found');

    // Message thread anchored to sv1
    const gotThread = await waitFor(async () => {
      const { data } = await sb.from('message_threads')
        .select('id').eq('source_entity_id', ctx.sv1Id)
        .ilike('subject', '%Statutory config update%').limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotThread, 'message thread for statutory_version.approved not found');

    // §8.1 payroll config update handoff
    const gotHandoff = await waitFor(async () => {
      const { data } = await sb.from('handoff_outbox')
        .select('id').eq('source_entity_id', ctx.sv1Id)
        .eq('target_module', 'finance_payroll').limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotHandoff, 'handoff_outbox payroll config update handoff not found for approved version');
  });

  // Editability includes APPROVED — mirrors the FE canEdit gate (draft || approved).
  // Shape-C (mig 20260919000395): an approved version requires an idempotencyKey so the
  // re-approval RPC can deduplicate retries. The key is stable per save attempt.
  await test('editability: NIS bands ARE upsertable on an APPROVED (not-yet-active) version', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: ctx.sv1Id,
      idempotencyKey: `e2e-reapproval-sv1-${TAG}`,
      classes: [{ classNo: 1, weeklyMin: 0, weeklyMax: 299.99, employeeWeekly: 13.50, employerWeekly: 20.00 }],
    });
    ok(r, `upsert on approved version should be allowed: ${r.body.message}`);
    expect(Number(r.body.data[0].employeeWeekly) === 13.50, 'approved-version band update not applied');
    // Side-effect: if finance_statutory.require_reapproval_on_edit is true (the default),
    // editing an approved version resets it to pending_approval so the changed figures are
    // re-reviewed before activation. The activation tests below need sv1 back in 'approved',
    // so we re-approve it with fmgr2 (non-creator) here.
    const { data: sv1After } = await sb.from('finance_statutory_versions').select('status').eq('id', ctx.sv1Id).maybeSingle();
    if (sv1After?.status === 'pending_approval') {
      const reApproveR = await api('finance/statutory/versions/approve', fmgr2Token, { id: ctx.sv1Id });
      expect(reApproveR.body?.success === true, `re-approve after band edit failed: ${reApproveR.body?.message}`);
    }
  });

  // --- Activate (approved → active, creator SoD still applies) ---
  await test('CREATOR cannot activate (SoD: creator cannot activate)', async () => {
    const r = await api('finance/statutory/versions/activate', fmgr1Token, { id: ctx.sv1Id });
    // fails() accepts any non-success response — whether SoD 422 or a guard error.
    fails(r, 'creator should be denied activation (SoD)');
  });

  await test('DIFFERENT finance_manager can activate the approved version', async () => {
    const r = await api('finance/statutory/versions/activate', fmgr2Token, { id: ctx.sv1Id });
    ok(r, `activate failed: ${r.body.message}`);
    expect(r.body.data.status === 'active',  `expected active, got ${r.body.data.status}`);
    expect(r.body.data.isActive === true,    'isActive should be true');
    expect(r.body.data.activatedBy === fmgr2Id, 'activatedBy mismatch');
  });

  // --- One-active-per-jurisdiction: create a second version and activate it ---
  await test('creating and activating a second version retires the first (one-active-per-jurisdiction)', async () => {
    // Create sv2 (by fmgr2, so fmgr1 can approve)
    const c = await api('finance/statutory/versions/create', fmgr2Token, {
      effectiveFrom: '2028-01-01',
      label: `E2E Version 2 ${TAG}`,
      jurisdiction: 'TT', currency: 'TTD',
      payePersonalAllowance: 95000, payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25, payeBand2Rate: 0.30,
      hsMonthlyThreshold: 500, hsWeeklyHigh: 5.00, hsWeeklyLow: 2.50,
    });
    ok(c, `create sv2 failed: ${c.body.message}`);
    ctx.sv2Id = c.body.data.id;

    // Submit sv2 (by creator fmgr2)
    const s = await api('finance/statutory/versions/submit', fmgr2Token, { id: ctx.sv2Id, idempotencyKey: `e2e-submit-2-${TAG}` });
    ok(s, `submit sv2 failed: ${s.body.message}`);

    // Approve sv2 by fmgr1 (different from creator fmgr2)
    const ap = await api('finance/statutory/versions/approve', fmgr1Token, { id: ctx.sv2Id });
    ok(ap, `approve sv2 failed: ${ap.body.message}`);

    // Activate sv2 by fmgr1 (different from creator fmgr2, and now also the approver — but not the creator)
    const act = await api('finance/statutory/versions/activate', fmgr1Token, { id: ctx.sv2Id });
    ok(act, `activate sv2 failed: ${act.body.message}`);
    expect(act.body.data.isActive === true, 'sv2 should be active');

    // Assert sv1 was retired by the activation
    const { data: sv1Row } = await sb.from('finance_statutory_versions')
      .select('status, is_active').eq('id', ctx.sv1Id).single();
    expect(sv1Row.status === 'retired', `sv1 should be retired, got ${sv1Row.status}`);
    expect(sv1Row.is_active === false,  'sv1 is_active should be false after sv2 activation');

    // Assert only one active version for TT
    const { data: activeVersions } = await sb.from('finance_statutory_versions')
      .select('id').eq('jurisdiction', 'TT').eq('is_active', true);
    expect((activeVersions ?? []).length === 1, `expected 1 active version, got ${(activeVersions ?? []).length}`);
    expect(activeVersions[0].id === ctx.sv2Id, 'active version should be sv2');
  });

  // Editability gate: bands are LOCKED once a version leaves draft/approved (active/retired).
  await test('editability gate: NIS band upsert on a RETIRED version is denied (422)', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: ctx.sv1Id, // sv1 was retired when sv2 activated
      classes: [{ classNo: 1, weeklyMin: 0, weeklyMax: 299.99, employeeWeekly: 99.99, employerWeekly: 99.99 }],
    });
    fails(r, 'upsert on retired version should fail');
    expect(r.status === 422, `expected 422 on retired version, got ${r.status}`);
    expect(r.body.message?.toLowerCase().includes('draft or approved'),
      `expected editability message, got: ${r.body.message}`);
  });

  await test('editability gate: NIS band upsert on an ACTIVE version is denied (422)', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: ctx.sv2Id, // sv2 is active
      classes: [{ classNo: 1, weeklyMin: 0, weeklyMax: 299.99, employeeWeekly: 1, employerWeekly: 1 }],
    });
    fails(r, 'upsert on active version should fail');
    expect(r.status === 422, `expected 422 on active version, got ${r.status}`);
  });

  // --- Reports ---
  await test('finance_manager can view statutory reports', async () => {
    const r = await api('finance/statutory/reports/list', fmgr1Token, {});
    ok(r, `reports/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not an array');
    // Shape assertions
    if (r.body.data.length > 0) {
      const row = r.body.data[0];
      expect('id' in row,            'report row missing id');
      expect('label' in row,         'report row missing label');
      expect('effectiveFrom' in row, 'report row missing effectiveFrom');
      expect('status' in row,        'report row missing status');
      expect('isActive' in row,      'report row missing isActive');
    }
  });

  await test('finance_staff is DENIED statutory reports (manager/admin surface)', async () => {
    // Statutory/finance reports are a manager/admin reporting surface. finance_staff
    // holds finance.statutory.view (data entry/review) but NOT reports.view — by design.
    const r = await api('finance/statutory/reports/list', fstaff1Token, {});
    fails(r, 'finance_staff should be denied statutory reports/list (reports.view is manager/admin only)');
  });

  await test('employee is DENIED statutory reports', async () => {
    const r = await api('finance/statutory/reports/list', empToken, {});
    fails(r, 'employee should be denied reports/list');
  });

  // --- Reject path ---
  await test('reject flow: draft → pending_approval → reject → back to draft', async () => {
    // Pre-clean: a PRIOR run that failed mid-test can leak its reject-test row
    // (cleanup registers after the asserts) — and the fixed effective date would
    // collide. Remove stale copies (and their workflow rows) before creating.
    const { data: stale } = await sb.from('finance_statutory_versions')
      .select('id').ilike('label', 'E2E Reject Test TEST-E2E-%').eq('effective_from', '2029-01-01');
    for (const row of stale ?? []) {
      const { data: wfRows } = await sb.from('workflow_instances').select('id').eq('source_record_id', row.id);
      const wfIds = (wfRows ?? []).map(w => w.id);
      if (wfIds.length) await sb.from('workflow_tasks').delete().in('workflow_id', wfIds);
      if (wfIds.length) await sb.from('workflow_instances').delete().in('id', wfIds);
      await sb.from('finance_statutory_versions').delete().eq('id', row.id);
    }

    // Create a new draft by fmgr1
    const c = await api('finance/statutory/versions/create', fmgr1Token, {
      effectiveFrom: '2029-01-01',
      label: `E2E Reject Test ${TAG}`,
      jurisdiction: 'TT', currency: 'TTD',
      payePersonalAllowance: 100000, payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25, payeBand2Rate: 0.30,
      hsMonthlyThreshold: 500, hsWeeklyHigh: 5.00, hsWeeklyLow: 2.50,
    });
    ok(c, `create for reject test failed: ${c.body.message}`);
    const rejectId = c.body.data.id;

    // Register cleanup IMMEDIATELY (not after the asserts) so a mid-test failure
    // cannot leak the row into the next run.
    h.onCleanup(async () => {
      try {
        const { data: wfRows } = await sb.from('workflow_instances').select('id').eq('source_record_id', rejectId);
        const wfIds = (wfRows ?? []).map(w => w.id);
        if (wfIds.length) await sb.from('workflow_tasks').delete().in('workflow_id', wfIds);
        if (wfIds.length) await sb.from('workflow_instances').delete().in('id', wfIds);
      } catch {}
      try { await sb.from('finance_statutory_versions').delete().eq('id', rejectId); } catch {}
    });

    // Submit it (creator: fmgr1)
    const s = await api('finance/statutory/versions/submit', fmgr1Token, { id: rejectId, idempotencyKey: `e2e-submit-3-${TAG}` });
    ok(s, `submit for reject test failed: ${s.body.message}`);

    // Creator cannot reject their own (SoD)
    const selfReject = await api('finance/statutory/versions/reject', fmgr1Token, { id: rejectId, reason: 'Self reject attempt' });
    fails(selfReject, 'creator should not be able to reject their own submission');

    // Reason is now mandatory — a reject with no reason is refused (fails at validation, no state change)
    const noReason = await api('finance/statutory/versions/reject', fmgr2Token, { id: rejectId });
    fails(noReason, 'reject with no reason should be refused');

    // Different manager can reject
    const r = await api('finance/statutory/versions/reject', fmgr2Token, { id: rejectId, reason: 'Rates need recalibration' });
    ok(r, `reject failed: ${r.body.message}`);
    expect(r.body.data.status === 'draft', `expected draft after reject, got ${r.body.data.status}`);

    // §18 side-effects: reject backbone asserts
    const gotRejectEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'finance_statutory')
        .eq('event_type', 'finance.statutory.version.rejected')
        .eq('source_entity_id', rejectId).limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotRejectEvent, 'app_event for version.rejected not found');

    const { data: rejectAudit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'finance_statutory')
      .eq('action', 'statutory_version.rejected')
      .eq('record_id', rejectId).limit(1);
    expect((rejectAudit ?? []).length > 0, 'hr_audit_log statutory_version.rejected not found');

    const gotRejectThread = await waitFor(async () => {
      const { data } = await sb.from('message_threads')
        .select('id').eq('source_entity_id', rejectId)
        .ilike('subject', '%rejected%').limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotRejectThread, 'message thread for version.rejected not found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Access Control — HR role denied statutory manage');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('a regular employee cannot manage statutory (also covers hr_staff equivalent denial)', async () => {
    const r = await api('finance/statutory/versions/create', empToken, {
      effectiveFrom: '2030-01-01', label: 'HR attempt',
      payePersonalAllowance: 1, payeBand1Ceiling: 1, payeBand1Rate: 0.1, payeBand2Rate: 0.1,
      hsMonthlyThreshold: 1, hsWeeklyHigh: 1, hsWeeklyLow: 1,
    });
    fails(r, 'non-finance role should be denied statutory.create');
  });

  await test('finance_staff can list (view) but not submit, approve, or activate', async () => {
    const listR = await api('finance/statutory/versions/list', fstaff1Token, {});
    ok(listR, 'finance_staff should be able to list statutory versions');

    // submit requires manage permission
    const submitR = await api('finance/statutory/versions/submit', fstaff1Token, { id: ctx.sv2Id, idempotencyKey: `e2e-submit-4-${TAG}` });
    fails(submitR, 'finance_staff should be denied submit');

    // approve requires approve permission
    const approveR = await api('finance/statutory/versions/approve', fstaff1Token, { id: ctx.sv2Id });
    fails(approveR, 'finance_staff should be denied approve');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › §2 Side-effects Verification');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('created + submitted events exist for sv1 in app_events', async () => {
    const { data: events } = await sb.from('app_events')
      .select('event_type').eq('source_module', 'finance_statutory')
      .eq('source_entity_id', ctx.sv1Id);
    const types = (events ?? []).map(e => e.event_type);
    expect(types.includes('finance.statutory.version.created'),  'missing created event for sv1');
    expect(types.includes('finance.statutory.version.submitted'), 'missing submitted event for sv1');
  });

  await test('§18 side-effects: submitted event created a notification for sv1', async () => {
    const gotNotification = await waitFor(async () => {
      const { data } = await sb.from('notifications')
        .select('id').eq('source_id', ctx.sv1Id)
        .ilike('title', '%submitted%').limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotNotification, 'notification for statutory_version.submitted not found');
  });

  await test('hr_audit_log has created/submitted/approved/activated rows for sv1', async () => {
    const { data: auditRows } = await sb.from('hr_audit_log')
      .select('action').eq('submodule_key', 'finance_statutory')
      .eq('record_id', ctx.sv1Id);
    const actions = (auditRows ?? []).map(a => a.action);
    expect(actions.includes('statutory_version.created'),  `missing created audit — found: ${JSON.stringify(actions)}`);
    expect(actions.includes('statutory_version.submitted'), `missing submitted audit`);
    expect(actions.includes('statutory_version.approved'),  `missing approved audit`);
    expect(actions.includes('statutory_version.activated'), `missing activated audit`);
  });

  await test('retired_by_activation audit row exists for sv1 when sv2 activated', async () => {
    const { data: retireAudit } = await sb.from('hr_audit_log')
      .select('action').eq('submodule_key', 'finance_statutory')
      .eq('record_id', ctx.sv1Id)
      .eq('action', 'statutory_version.retired_by_activation').limit(1);
    expect((retireAudit ?? []).length > 0, 'retired_by_activation audit row missing for sv1');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Wave 2B — /versions/detail');
  // ═══════════════════════════════════════════════════════════════════════════

  // NOTE: /versions/detail is gated by finance.statutory.view (same as /versions/get)

  await test('/versions/detail — finance_staff can fetch version detail (view gate)', async () => {
    const r = await api('finance/statutory/versions/detail', fstaff1Token, { id: ctx.sv2Id });
    ok(r, `/versions/detail failed: ${r.body.message}`);
    const d = r.body.data;
    // Core version fields
    expect(d.id === ctx.sv2Id,           'id mismatch');
    expect('effectiveFrom' in d,         'missing effectiveFrom');
    expect('jurisdiction' in d,          'missing jurisdiction');
    expect('status' in d,                'missing status');
    expect('isActive' in d,              'missing isActive');
    // Extended fields (Wave 2B additions)
    expect(Array.isArray(d.nisClasses),          'nisClasses must be array');
    expect(Array.isArray(d.approvalTimeline),     'approvalTimeline must be array');
    expect(typeof d.linkedPayrollRunCount === 'number', 'linkedPayrollRunCount must be number');
  });

  await test('/versions/detail — sv1 (retired) includes its NIS classes in the response', async () => {
    const r = await api('finance/statutory/versions/detail', fmgr1Token, { id: ctx.sv1Id });
    ok(r, `/versions/detail for sv1 failed: ${r.body.message}`);
    // sv1 had 3 NIS classes added in the lifecycle section
    expect(r.body.data.nisClasses.length >= 3, `expected ≥3 NIS classes, got ${r.body.data.nisClasses.length}`);
    const c1 = r.body.data.nisClasses.find(c => c.classNo === 1);
    expect(c1,               'class 1 not found');
    expect('id' in c1,       'NIS class missing id');
    expect('weeklyMin' in c1, 'NIS class missing weeklyMin');
  });

  await test('/versions/detail — employee is DENIED', async () => {
    const r = await api('finance/statutory/versions/detail', empToken, { id: ctx.sv2Id });
    fails(r, 'employee should be denied /versions/detail');
  });

  await test('/versions/detail — approval timeline has ≥1 entry for sv1', async () => {
    const r = await api('finance/statutory/versions/detail', fmgr1Token, { id: ctx.sv1Id });
    ok(r, `detail for sv1 failed: ${r.body.message}`);
    const timeline = r.body.data.approvalTimeline ?? [];
    expect(timeline.length >= 1, `expected ≥1 timeline entry, got ${timeline.length}`);
    const entry = timeline[0];
    expect('id' in entry,        'timeline entry missing id');
    expect('action' in entry,    'timeline entry missing action');
    expect('actorId' in entry,   'timeline entry missing actorId');
    expect('createdAt' in entry, 'timeline entry missing createdAt');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Wave 2B — /versions/approval-timeline');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('/versions/approval-timeline — returns lifecycle events for sv1', async () => {
    const r = await api('finance/statutory/versions/approval-timeline', fmgr1Token, { id: ctx.sv1Id });
    ok(r, `approval-timeline failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data must be array');
    const actions = r.body.data.map(e => e.action);
    expect(actions.some(a => a.includes('created') || a.includes('submitted')),
      `expected created/submitted in timeline, got: ${JSON.stringify(actions)}`);
    // Shape assertion
    const e0 = r.body.data[0];
    expect(e0 && 'id' in e0,        'entry missing id');
    expect(e0 && 'action' in e0,    'entry missing action');
    expect(e0 && 'actorId' in e0,   'entry missing actorId');
    expect(e0 && 'createdAt' in e0, 'entry missing createdAt');
  });

  await test('/versions/approval-timeline — employee is DENIED', async () => {
    const r = await api('finance/statutory/versions/approval-timeline', empToken, { id: ctx.sv1Id });
    fails(r, 'employee should be denied approval-timeline');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Wave 2B — NIS class delete + import');
  // ═══════════════════════════════════════════════════════════════════════════

  // We need a fresh DRAFT version for delete/import (sv1=retired, sv2=active).
  // We'll create a new draft version (sv3) using the existing manage perm,
  // add NIS classes via the existing upsert endpoint, then test delete/import.
  //
  // NOTE: finance.statutory.nisClass.delete and finance.statutory.nisClass.import
  // are NEW perm keys. They are NOT yet in the permission catalogue (reported in
  // StructuredOutput for the orchestrator to catalogue + grant).
  // Positive-path tests use the admin token (superadmin bypass) so this suite
  // stays green before the orchestrator applies the grants.

  let sv3Id = null;
  let nisClassToDelete = null;

  await test('create a draft version (sv3) for delete/import tests', async () => {
    const r = await api('finance/statutory/versions/create', fmgr1Token, {
      effectiveFrom: '2030-01-01',
      label: `E2E Delete/Import Test ${TAG}`,
      jurisdiction: 'TT', currency: 'TTD',
      payePersonalAllowance: 84000, payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25, payeBand2Rate: 0.30,
      hsMonthlyThreshold: 469.99, hsWeeklyHigh: 4.80, hsWeeklyLow: 2.40,
    });
    ok(r, `create sv3 failed: ${r.body.message}`);
    sv3Id = r.body.data.id;
    expect(r.body.data.status === 'draft', 'sv3 must be draft');
    h.onCleanup(async () => {
      try { await sb.from('finance_nis_classes').delete().eq('statutory_version_id', sv3Id); } catch {}
      try { await sb.from('finance_statutory_versions').delete().eq('id', sv3Id); } catch {}
    });
  });

  await test('seed NIS classes on sv3 for delete test', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: sv3Id,
      classes: [
        { classNo: 1, weeklyMin: 0,   weeklyMax: 299.99, employeeWeekly: 12.95, employerWeekly: 19.40 },
        { classNo: 2, weeklyMin: 300, weeklyMax: null,   employeeWeekly: 17.15, employerWeekly: 25.70 },
      ],
    });
    ok(r, `upsert NIS classes on sv3 failed: ${r.body.message}`);
    expect(r.body.data.length >= 1, 'expected ≥1 NIS class seeded');
    nisClassToDelete = r.body.data[0].id;
    expect(nisClassToDelete, 'NIS class id is missing');
  });

  // /nis-classes/delete — access control (employee always denied regardless of perm)
  await test('/nis-classes/delete — employee is DENIED (403)', async () => {
    const r = await api('finance/statutory/nis-classes/delete', empToken, { id: nisClassToDelete });
    fails(r, 'employee should be denied NIS class delete');
  });

  // /nis-classes/delete — positive path via finance_manager (has finance.statutory.nis_class.delete in DB)
  // NOTE: admin role also has this key in the hardcoded ROLE_PERMISSIONS seed, but the DB role_permissions
  // table for admin does not include it yet (Category A — operator must apply the Wave 2B permissions migration).
  // Using fmgr1Token (finance_manager) validates the feature works against the live DB.
  await test('/nis-classes/delete — finance_manager can delete an NIS class', async () => {
    const r = await api('finance/statutory/nis-classes/delete', fmgr1Token, { id: nisClassToDelete });
    ok(r, `/nis-classes/delete failed: ${r.body.message}`);
    // Verify row gone from DB
    const { data: gone } = await sb.from('finance_nis_classes').select('id').eq('id', nisClassToDelete).limit(1);
    expect((gone ?? []).length === 0, 'NIS class should be deleted from DB');
  });

  await test('/nis-classes/delete — §2 side-effects: audit log entry', async () => {
    const got = await waitFor(async () => {
      const { data } = await sb.from('hr_audit_log')
        .select('id').eq('submodule_key', 'finance_statutory')
        .eq('action', 'nis_class.deleted').limit(1);
      return (data ?? []).length > 0;
    });
    expect(got, 'hr_audit_log nis_class.deleted entry not found after delete');
  });

  await test('/nis-classes/delete — cannot delete from a non-draft version (retired sv1)', async () => {
    // Get a NIS class from the retired sv1
    const { data: sv1Classes } = await sb.from('finance_nis_classes')
      .select('id').eq('statutory_version_id', ctx.sv1Id).limit(1);
    if ((sv1Classes ?? []).length === 0) return; // no classes, skip guard assertion
    const r = await api('finance/statutory/nis-classes/delete', fmgr1Token, { id: sv1Classes[0].id });
    fails(r, 'delete from retired version should fail (422)');
  });

  // /nis-classes/import — positive path via finance_manager
  await test('/nis-classes/import — finance_manager can import NIS class rows for sv3', async () => {
    const importRows = [
      { classNo: 3, weeklyMin: 400, weeklyMax: 499.99, employeeWeekly: 18.00, employerWeekly: 27.00 },
      { classNo: 4, weeklyMin: 500, weeklyMax: null,   employeeWeekly: 22.00, employerWeekly: 33.00 },
    ];
    const r = await api('finance/statutory/nis-classes/import', fmgr1Token, {
      statutoryVersionId: sv3Id,
      rows: importRows,
    });
    ok(r, `/nis-classes/import failed: ${r.body.message}`);
    const d = r.body.data;
    // Response shape
    expect(typeof d.imported === 'number', 'imported must be a number');
    expect(Array.isArray(d.errors),        'errors must be an array');
    expect(d.imported === 2,               `expected 2 imported, got ${d.imported}`);
    expect(d.errors.length === 0,          `expected 0 errors, got ${JSON.stringify(d.errors)}`);
  });

  await test('/nis-classes/import — upsert conflict: re-importing same class numbers updates rows', async () => {
    // Re-import class 3 with different rates
    const r = await api('finance/statutory/nis-classes/import', fmgr1Token, {
      statutoryVersionId: sv3Id,
      rows: [{ classNo: 3, weeklyMin: 400, weeklyMax: 499.99, employeeWeekly: 20.00, employerWeekly: 30.00 }],
    });
    ok(r, `/nis-classes/import upsert conflict failed: ${r.body.message}`);
    expect(r.body.data.imported === 1, `expected 1 imported, got ${r.body.data.imported}`);
    // Verify updated rate in DB
    const { data: cls3 } = await sb.from('finance_nis_classes')
      .select('employee_weekly').eq('statutory_version_id', sv3Id).eq('class_no', 3).single();
    expect(Math.abs(Number(cls3?.employee_weekly) - 20.00) < 0.01, 'class 3 employee_weekly should be updated to 20.00');
  });

  await test('/nis-classes/import — employee is DENIED', async () => {
    const r = await api('finance/statutory/nis-classes/import', empToken, {
      statutoryVersionId: sv3Id,
      rows: [{ classNo: 99, weeklyMin: 0, weeklyMax: null, employeeWeekly: 1, employerWeekly: 1 }],
    });
    fails(r, 'employee should be denied NIS class import');
  });

  await test('/nis-classes/import — empty rows array is refused', async () => {
    const r = await api('finance/statutory/nis-classes/import', fmgr1Token, {
      statutoryVersionId: sv3Id,
      rows: [],
    });
    fails(r, 'empty rows array should be refused');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Wave 2B — /reports/run (typed)');
  // ═══════════════════════════════════════════════════════════════════════════

  // /reports/run requires finance.statutory.reports.view (same as /reports/list)

  await test('/reports/run — statutory_version_summary report returns typed result', async () => {
    const r = await api('finance/statutory/reports/run', fmgr1Token, {
      report: 'statutory_version_summary',
    });
    ok(r, `/reports/run statutory_version_summary failed: ${r.body.message}`);
    const d = r.body.data;
    // ReportResult shape
    expect(typeof d.report === 'string',       'report field must be string');
    expect(typeof d.generatedAt === 'string',  'generatedAt must be string');
    expect(Array.isArray(d.rows),              'rows must be array');
    // Row shape for version summary
    if (d.rows.length > 0) {
      const row = d.rows[0];
      expect('label' in row,         'version_summary row missing label');
      expect('effectiveFrom' in row, 'version_summary row missing effectiveFrom');
      expect('status' in row,        'version_summary row missing status');
      expect('isActive' in row,      'version_summary row missing isActive');
    }
  });

  await test('/reports/run — nis_class_summary report returns NIS band rows', async () => {
    const r = await api('finance/statutory/reports/run', fmgr1Token, {
      report: 'nis_class_summary',
    });
    ok(r, `/reports/run nis_class_summary failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data.rows), 'nis_class_summary rows must be array');
    if (r.body.data.rows.length > 0) {
      const row = r.body.data.rows[0];
      expect('classNo' in row,         'NIS class row missing classNo');
      expect('weeklyMin' in row,       'NIS class row missing weeklyMin');
      expect('employeeWeekly' in row,  'NIS class row missing employeeWeekly');
      expect('employerWeekly' in row,  'NIS class row missing employerWeekly');
    }
  });

  await test('/reports/run — pay_component_map report returns component catalogue', async () => {
    const r = await api('finance/statutory/reports/run', fmgr1Token, {
      report: 'pay_component_map',
    });
    ok(r, `/reports/run pay_component_map failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data.rows), 'pay_component_map rows must be array');
    expect(r.body.data.rows.length >= 1, 'expected ≥1 pay component in catalogue');
    if (r.body.data.rows.length > 0) {
      const row = r.body.data.rows[0];
      expect('code' in row, 'pay component row missing code');
      expect('name' in row, 'pay component row missing name');
      expect('kind' in row, 'pay component row missing kind');
    }
  });

  await test('/reports/run — statutory_approval_history report returns audit rows', async () => {
    const r = await api('finance/statutory/reports/run', fmgr1Token, {
      report: 'statutory_approval_history',
    });
    ok(r, `/reports/run statutory_approval_history failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data.rows), 'approval_history rows must be array');
  });

  await test('/reports/run — rejects unknown report key', async () => {
    const r = await api('finance/statutory/reports/run', fmgr1Token, {
      report: 'nonexistent_report_key_xyz',
    });
    fails(r, 'unknown report key should be refused by validation');
  });

  await test('/reports/run — employee is DENIED', async () => {
    const r = await api('finance/statutory/reports/run', empToken, {
      report: 'statutory_version_summary',
    });
    fails(r, 'employee should be denied /reports/run');
  });

  await test('/reports/run — finance_staff is DENIED (reports.view is manager/admin only)', async () => {
    const r = await api('finance/statutory/reports/run', fstaff1Token, {
      report: 'statutory_version_summary',
    });
    fails(r, 'finance_staff should be denied /reports/run (reports.view is manager/admin only)');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Shape-C — NIS Re-approval Atomicity (finding #3)');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Verifies that upsertNisClasses on an approved version uses the
  // workflow_submit_for_record_tx RPC (mig 20260919000395) to atomically:
  //   status flip (approved -> pending_approval) + approved_by clear +
  //   workflow instance + tasks + app_events + hr_audit_log in ONE txn.
  //
  // Requires mig 20260919000395 applied before running these tests.

  let sv4Id = null;
  let reapprovalWfId = null;
  const reapprovalKey = `e2e-sv4-reapproval-${TAG}`;

  await test('Shape-C setup: create sv4 draft and approve it (by separate actors)', async () => {
    const c = await api('finance/statutory/versions/create', fmgr1Token, {
      effectiveFrom: '2031-01-01',
      label: `E2E Shape-C Reapproval ${TAG}`,
      jurisdiction: 'TT', currency: 'TTD',
      payePersonalAllowance: 84000, payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25, payeBand2Rate: 0.30,
      hsMonthlyThreshold: 469.99, hsWeeklyHigh: 4.80, hsWeeklyLow: 2.40,
    });
    ok(c, `create sv4 failed: ${c.body.message}`);
    sv4Id = c.body.data.id;
    expect(c.body.data.status === 'draft', 'sv4 must be draft');

    const s = await api('finance/statutory/versions/submit', fmgr1Token, { id: sv4Id, idempotencyKey: `e2e-sv4-submit-${TAG}` });
    ok(s, `submit sv4 failed: ${s.body.message}`);

    const ap = await api('finance/statutory/versions/approve', fmgr2Token, { id: sv4Id });
    ok(ap, `approve sv4 failed: ${ap.body.message}`);
    expect(ap.body.data.status === 'approved', `sv4 should be approved, got ${ap.body.data.status}`);

    h.onCleanup(async () => {
      try {
        const { data: wfRows } = await sb.from('workflow_instances').select('id').eq('source_record_id', sv4Id);
        const wfIds = (wfRows ?? []).map(w => w.id);
        if (wfIds.length) await sb.from('workflow_tasks').delete().in('workflow_id', wfIds);
        if (wfIds.length) await sb.from('workflow_instances').delete().in('id', wfIds);
      } catch {}
      try { await sb.from('finance_nis_classes').delete().eq('statutory_version_id', sv4Id); } catch {}
      try { await sb.from('hr_audit_log').delete().eq('record_id', sv4Id); } catch {}
      try { await sb.from('app_events').delete().eq('source_entity_id', sv4Id); } catch {}
      try { await sb.from('finance_statutory_versions').delete().eq('id', sv4Id); } catch {}
    });
  });

  await test('Shape-C: missing idempotency key on approved version returns 400', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: sv4Id,
      classes: [{ classNo: 1, weeklyMin: 0, weeklyMax: 299.99, employeeWeekly: 13.50, employerWeekly: 20.00 }],
    });
    fails(r, 'missing idempotencyKey on approved version must return an error');
    expect(r.status === 400, `expected 400, got ${r.status}`);
    expect(r.body.message?.toLowerCase().includes('idempotency key'),
      `expected idempotency-key error, got: ${r.body.message}`);
  });

  await test('Shape-C: upsert on approved version with key triggers atomic re-approval', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: sv4Id,
      idempotencyKey: reapprovalKey,
      classes: [{ classNo: 1, weeklyMin: 0, weeklyMax: 299.99, employeeWeekly: 13.50, employerWeekly: 20.00 }],
    });
    ok(r, `re-approval upsert failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'response data must be an array of NIS class rows');
    expect(r.body.data.length >= 1, 'expected ≥1 NIS class row in response');

    // Version must now be pending_approval with cleared approved_by and new workflow_id
    const { data: sv4Row } = await sb.from('finance_statutory_versions')
      .select('status, workflow_id, approved_by').eq('id', sv4Id).single();
    expect(sv4Row.status === 'pending_approval',
      `expected pending_approval after re-approval, got ${sv4Row.status}`);
    expect(sv4Row.workflow_id != null, 'workflow_id must be set after re-approval');
    expect(sv4Row.approved_by == null, 'approved_by must be cleared (void prior approval)');
    reapprovalWfId = sv4Row.workflow_id;

    // Workflow instance must exist and be in_progress
    const { data: wfRow } = await sb.from('workflow_instances')
      .select('status, module_key, workflow_type').eq('id', reapprovalWfId).maybeSingle();
    expect(wfRow != null, 'workflow_instances row not found for re-approval workflow');
    expect(wfRow.status === 'in_progress',
      `expected in_progress workflow, got ${wfRow.status}`);
    expect(wfRow.module_key === 'finance_statutory',
      `expected finance_statutory module, got ${wfRow.module_key}`);
    expect(wfRow.workflow_type === 'finance_statutory_approval',
      `expected finance_statutory_approval type, got ${wfRow.workflow_type}`);

    // At least one pending workflow task must be created for the first step
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('id, status').eq('workflow_id', reapprovalWfId).eq('status', 'pending').limit(5);
    expect((tasks ?? []).length >= 1, 'expected ≥1 pending workflow_task for re-approval');

    // Exactly one app_event with the submitted event type for this version by this actor
    const { data: events } = await sb.from('app_events')
      .select('id, event_type').eq('source_entity_id', sv4Id)
      .eq('event_type', 'finance.statutory.version.submitted')
      .eq('actor_user_id', fmgr1Id);
    expect((events ?? []).length >= 1,
      'expected app_event finance.statutory.version.submitted for re-approval');

    // hr_audit_log must have the re-approval (not the fresh-submit) action
    const { data: auditRows } = await sb.from('hr_audit_log')
      .select('action').eq('record_id', sv4Id)
      .eq('action', 'statutory_version.reopened_by_edit').limit(5);
    expect((auditRows ?? []).length === 1,
      'expected exactly 1 hr_audit_log statutory_version.reopened_by_edit row');
  });

  await test('Shape-C: retry after re-approval is cleanly rejected, no second workflow', async () => {
    // Same lesson as the leave slice: the endpoint has a STATEFUL pre-check
    // (NIS classes are only editable on draft/approved versions) that runs
    // BEFORE the RPC receipt. After the first upsert flipped sv4 to
    // pending_approval, a sequential retry — same key or not — is CORRECTLY
    // rejected by that gate (a pending version must not be edited again).
    // The receipt protects the concurrent race inside the RPC, which the
    // shared _claim_request tests already cover.
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: sv4Id,
      idempotencyKey: reapprovalKey,
      classes: [{ classNo: 1, weeklyMin: 0, weeklyMax: 299.99, employeeWeekly: 13.50, employerWeekly: 20.00 }],
    });
    fails(r, 'retry on a pending_approval version must be rejected by the edit gate');
    expect(r.body.message?.toLowerCase().includes('draft or approved'),
      `expected the edit-gate message, got: ${r.body.message}`);

    // The invariant that matters: the retry changed NOTHING — same workflow,
    // no duplicate instance.
    const { data: sv4Row2 } = await sb.from('finance_statutory_versions')
      .select('workflow_id, status').eq('id', sv4Id).single();
    expect(sv4Row2.workflow_id === reapprovalWfId,
      `workflow_id must not change on retry: expected ${reapprovalWfId}, got ${sv4Row2.workflow_id}`);
    expect(sv4Row2.status === 'pending_approval',
      `status must remain pending_approval, got ${sv4Row2.status}`);

    const { data: allWfs } = await sb.from('workflow_instances')
      .select('id').eq('source_record_id', sv4Id).eq('status', 'in_progress');
    expect((allWfs ?? []).length === 1,
      `expected exactly 1 in_progress workflow for sv4, got ${(allWfs ?? []).length}`);
  });

  await test('Shape-C: employee is DENIED NIS class upsert (access control)', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', empToken, {
      statutoryVersionId: sv4Id,
      idempotencyKey: `e2e-sv4-unauth-${TAG}`,
      classes: [{ classNo: 99, weeklyMin: 0, weeklyMax: null, employeeWeekly: 1, employerWeekly: 1 }],
    });
    fails(r, 'employee should be denied NIS class upsert (finance.statutory.manage required)');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › §18 — CSV Export Data-Shape Verification');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The register CSV export (QuickActionStrip "Export Versions") is client-side:
  // it calls exportCsv() over the already-fetched versions list. §18 mandates
  // 'CSV export returns a file' as a per-page E2E gate. Since the export
  // uses the /versions/list response as its data source, we assert here that
  // every field consumed by exportCsv() is present in the API response shape.
  // This constitutes the backend contract that the client-side export depends on.

  await test('§18 CSV export — /versions/list returns every field consumed by the register export', async () => {
    const r = await api('finance/statutory/versions/list', fmgr1Token, {});
    ok(r, `versions/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data must be an array');
    expect(r.body.data.length >= 1, 'need at least one version to assert CSV shape');

    // Fields used by exportCsv() in StatutoryConfigOverview.tsx QuickActionStrip
    const csvFields = [
      'label', 'effectiveFrom', 'jurisdiction', 'status',
      'payePersonalAllowance', 'payeBand1Rate', 'payeBand2Rate',
      'hsMonthlyThreshold', 'createdAt',
    ];
    const row = r.body.data[0];
    for (const field of csvFields) {
      expect(field in row, `CSV export field "${field}" missing from /versions/list response`);
    }
  });

  await test('§18 CSV export — /versions/list includes §11 Owner field (createdBy) for Owner column', async () => {
    const r = await api('finance/statutory/versions/list', fmgr1Token, {});
    ok(r, `versions/list failed: ${r.body.message}`);
    const row = r.body.data[0];
    // createdBy is needed for the Owner EmployeeCell column (§20) and can be exported.
    expect('createdBy' in row, 'createdBy field missing from /versions/list — required for Owner column');
    expect('approvedBy' in row, 'approvedBy field missing — required for Approval State column');
    expect('linkedPayrollRunCount' in row,
      'linkedPayrollRunCount missing from /versions/list — required for Linked Runs column (§11)');
  });

  await test('§18 CSV export — linkedPayrollRunCount is a non-negative number per version', async () => {
    const r = await api('finance/statutory/versions/list', fmgr1Token, {});
    ok(r, `versions/list failed: ${r.body.message}`);
    for (const v of r.body.data) {
      expect(
        typeof v.linkedPayrollRunCount === 'number' && v.linkedPayrollRunCount >= 0,
        `linkedPayrollRunCount must be a non-negative number; got ${v.linkedPayrollRunCount} on ${v.id}`,
      );
    }
  });

  await test('§18 CSV export — /reports/run statutory_version_summary contains all exportable fields', async () => {
    // The Reports tab also has a client-side CSV download via ReportPanel.
    // Verify the statutory_version_summary report returns the fields it promises.
    const r = await api('finance/statutory/reports/run', fmgr1Token, {
      report: 'statutory_version_summary',
    });
    ok(r, `/reports/run statutory_version_summary failed: ${r.body.message}`);
    expect(typeof r.body.data.report === 'string',       'report field must be a string');
    expect(typeof r.body.data.generatedAt === 'string',  'generatedAt must be a string');
    expect(Array.isArray(r.body.data.rows),              'rows must be an array');
    // generatedAt must be an ISO timestamp (the export header row uses it).
    expect(/^\d{4}-\d{2}-\d{2}T/.test(r.body.data.generatedAt),
      `generatedAt must be an ISO timestamp, got: ${r.body.data.generatedAt}`);
    // When there is data (there will be after the lifecycle tests), assert shape.
    if (r.body.data.rows.length > 0) {
      const row = r.body.data.rows[0];
      const reportExportFields = ['label', 'effectiveFrom', 'jurisdiction', 'status', 'isActive', 'createdAt'];
      for (const field of reportExportFields) {
        expect(field in row, `statutory_version_summary report row missing "${field}" — CSV export would be incomplete`);
      }
    }
  });

  await test('§18 CSV export — /reports/run pay_component_map contains all exportable fields', async () => {
    const r = await api('finance/statutory/reports/run', fmgr1Token, {
      report: 'pay_component_map',
    });
    ok(r, `/reports/run pay_component_map failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data.rows), 'rows must be an array');
    if (r.body.data.rows.length > 0) {
      const row = r.body.data.rows[0];
      const exportFields = ['code', 'name', 'kind', 'isStatutory', 'isTaxable', 'isActive'];
      for (const field of exportFields) {
        expect(field in row, `pay_component_map row missing "${field}" — CSV export would be incomplete`);
      }
    }
  });
}
