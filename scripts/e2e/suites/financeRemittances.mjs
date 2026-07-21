/**
 * scripts/e2e/suites/financeRemittances.mjs
 *
 * E2E for Finance ▸ Statutory Remittances & Filing (module F1).
 *
 * Routes under test:
 *   /api/finance/remittances/{list,get,lines/list,lines/list-all,compute,create,
 *                             submit,approve,mark-paid,mark-filed,cancel,
 *                             audit/list,reports/run}
 *
 * Covers:
 *   • Access control: employee DENIED; finance_staff can VIEW + CREATE (has manage) but
 *     is DENIED approve.
 *   • compute from an approved payroll run → returns PAYE/NIS/HS portions.
 *   • compute on a non-approved run → 422.
 *   • Full lifecycle: create → submit → approve → mark-paid → mark-filed.
 *   • SoD: creator (fmgr1) cannot approve own remittance → 422; a different finance_manager can.
 *   • Cancel path (with reason).
 *   • Response-shape assertions for fields the frontend consumes.
 *   • §2 side-effects: app_events (source_module 'finance_remittances') + hr_audit_log asserted
 *     via the service-role client.
 *   • Cleanup via h.TAG.
 *
 * Fixture seeded via service-role (compute needs a real approved run + run-lines):
 *   finance_statutory_versions → finance_payroll_runs (status 'approved') → finance_payroll_run_lines.
 *
 * NOTE: apply these migrations to the live DB before running, then NOTIFY pgrst, 'reload schema':
 *   20260805000000_finance_remittances.sql
 *   20260805000001_finance_remittances_permissions.sql
 *   20260805000002_workflow_finance_remittance_binding.sql
 */

import { payrollRunSeed, payrollPeriod } from '../helpers/payrollRun.mjs';

export const title = 'Finance — Statutory Remittances & Filing (F1)';

/** Deterministic-but-unique date from TAG + a per-suite salt, so this suite's seeded
 *  finance_statutory_versions row (unique on effective_from+jurisdiction) never
 *  collides with another suite's seed or a stale row from a crashed prior run. */
function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = (n % 1000) + salt * 1000; // exclusive ~1000-day band per salt
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  let fmgr1Id, fmgr2Id, fstaff1Id, empId, line1EmpId, line2EmpId;

  const ctx = {
    versionId: null,
    runId: null,          // approved run (computable)
    draftRunId: null,     // non-approved run (compute must 422)
    nisRemId: null,       // NIS remittance taken through the full lifecycle
    cancelRemId: null,    // remittance for the cancel path
    staffRemId: null,     // PAYE remittance created by finance_staff (has manage)
    createdUserIds: [],
  };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('finance_remittance_lines').delete().in('remittance_id', [ctx.nisRemId, ctx.cancelRemId, ctx.staffRemId].filter(Boolean)); } catch {}
    try { await sb.from('finance_remittances').delete().or(`id.eq.${ctx.nisRemId},id.eq.${ctx.cancelRemId},id.eq.${ctx.staffRemId}`); } catch {}
    try { await sb.from('finance_payroll_run_lines').delete().in('run_id', [ctx.runId, ctx.draftRunId].filter(Boolean)); } catch {}
    try { await sb.from('finance_payroll_runs').delete().or(`id.eq.${ctx.runId},id.eq.${ctx.draftRunId}`); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_remittances').in('actor_id', [fmgr1Id, fmgr2Id, fstaff1Id]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_remittances').in('actor_user_id', [fmgr1Id, fmgr2Id, fstaff1Id, empId]); } catch {}
    // Gap 8 cleanup: message_threads cascade-delete posts/participants; notifications by source_id.
    try { if (ctx.nisRemId) await sb.from('message_threads').delete().eq('source_module', 'finance_remittances').eq('source_entity_id', ctx.nisRemId); } catch {}
    try { if (ctx.nisRemId) await sb.from('notifications').delete().eq('source_id', ctx.nisRemId); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
    // Ticket cleanup for the missing-receipt path (§12 ticket side-effect test).
    try { if (ctx.staffRemId) await sb.from('tickets').delete().eq('source_entity_id', ctx.staffRemId); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  let fmgr1Token, fmgr2Token, fstaff1Token, empToken;

  await test('acquire finance_manager ×2, finance_staff, employee + 2 line employees (real roster preferred)', async () => {
    const mgrR = await acquireActors('finance_manager', 2);
    const stfR = await acquireActors('finance_staff', 1);
    const empR = await acquireActors('employee', 3);
    const [fmgr1, fmgr2] = mgrR.actors, [fstaff1] = stfR.actors, [emp, line1Emp, line2Emp] = empR.actors;
    fmgr1Id = fmgr1.id; fmgr2Id = fmgr2.id; fstaff1Id = fstaff1.id; empId = emp.id; line1EmpId = line1Emp.id; line2EmpId = line2Emp.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    fmgr1Token  = mint({ id: fmgr1Id,  username: fmgr1.username, role: 'finance_manager', department_id: fmgr1.department_id ?? null });
    fmgr2Token  = mint({ id: fmgr2Id,  username: fmgr2.username, role: 'finance_manager', department_id: fmgr2.department_id ?? null });
    fstaff1Token = mint({ id: fstaff1Id, username: fstaff1.username, role: 'finance_staff', department_id: fstaff1.department_id ?? null });
    empToken    = mint({ id: empId,    username: emp.username, role: 'employee', department_id: emp.department_id ?? null });
  });

  await test('seed a statutory version + approved payroll run + 2 run-lines (fixture for compute)', async () => {
    // statutory version (required NOT-NULL cols; others default)
    // finance_statutory_versions has unique(effective_from, jurisdiction) — derive a
    // TAG-specific date so concurrent/parallel suites (and stale rows from a prior
    // crashed run) never collide with this suite's own seed date.
    const seedDate = seedDateFromTag(TAG, 1);
    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: seedDate,
      label: `E2E Rem Version ${TAG}`,
      paye_personal_allowance: 90000,
      paye_band1_ceiling: 1000000,
      paye_band1_rate: 0.25,
      paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99,
      hs_weekly_high: 8.25,
      hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, `seed version failed: ${verErr?.message}`);
    ctx.versionId = ver.id;

    // approved run (compute requires status in approved/locked/exported)
    // Run identity is (pay group, period_start, period_end, run_type); the salt-derived
    // date becomes period_start, so salts must be globally unique across suites
    // (contract gate enforces it) to avoid scheduled-run identity collisions when
    // multiple finance suites seed a run in the same test pass.
    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: `RUN-E2E-${TAG.slice(-6)}`,
      periodMonth: payrollPeriod('financeRemittances', 'approvedRun', TAG),
      statutory_version_id: ctx.versionId,
      status: 'approved',
      employee_count: 2,
    })).select('id').single();
    expect(!rnErr, `seed run failed: ${rnErr?.message}`);
    ctx.runId = rn.id;

    // a second, draft run — compute must reject it
    const { data: dr, error: drErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: `RUN-E2E-DRAFT-${TAG.slice(-6)}`,
      periodMonth: payrollPeriod('financeRemittances', 'draftRun', TAG),
      statutory_version_id: ctx.versionId,
      status: 'draft',
      employee_count: 1,
    })).select('id').single();
    expect(!drErr, `seed draft run failed: ${drErr?.message}`);
    ctx.draftRunId = dr.id;

    // run-lines carrying the deduction columns compute reads
    const { error: lErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.runId, employee_id: line1EmpId, paye: 1200.00, nis_employee: 138.60, nis_employer: 291.20, health_surcharge: 8.25 },
      { run_id: ctx.runId, employee_id: line2EmpId, paye: 800.00,  nis_employee: 138.60, nis_employer: 291.20, health_surcharge: 8.25 },
    ]);
    expect(!lErr, `seed run-lines failed: ${lErr?.message}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Atomic submit (finding #3, slice A3)');
  // ═══════════════════════════════════════════════════════════════════════════
  // Submit now commits status(draft->submitted) + workflow_id + the whole workflow +
  // business event/audit in ONE txn (workflow_submit_for_record_tx, finance_remittances
  // branch), with request-key idempotency. Fresh isolated run + drafts (one per
  // authority — unique(payroll_run_id,authority)); self-cleaned below.

  const atomCtx = { runId: null, remIds: [] };
  await test('A3 atomic setup: seed a fresh approved run', async () => {
    const { data, error } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: `RUN-E2E-A3-${TAG.slice(-6)}`, periodMonth: payrollPeriod('financeRemittances', 'atomicRun', TAG),
      statutory_version_id: ctx.versionId, status: 'approved', employee_count: 1,
    })).select('id').single();
    expect(!error, `seed atom run failed: ${error?.message}`);
    atomCtx.runId = data.id;
  });
  const seedDraftRem = async (authority) => {
    const { data, error } = await sb.from('finance_remittances').insert({
      remittance_no: `REM-E2E-A3-${authority}-${TAG.slice(-6)}`,
      period_year: 2026, period_month: 6, authority, payroll_run_id: atomCtx.runId,
      due_date: '2026-07-15',   // NOT NULL — statutory filing due date (mid next month)
      status: 'draft', created_by: fmgr1Id, total_due: 100, employee_portion: 40, employer_portion: 60,
    }).select('id').single();
    if (error) throw new Error(`seedDraftRem(${authority}): ${error.message}`);
    atomCtx.remIds.push(data.id);
    return data.id;
  };

  await test('A3 atomic: retry same key returns original workflow (no double-create, exact counts, no strand)', async () => {
    const id = await seedDraftRem('paye_bir');
    const key = `a3-idem-${TAG}-${id}`;
    const r1 = await api('finance/remittances/submit', fmgr1Token, { id, idempotencyKey: key });
    ok(r1, `first submit failed: ${r1.body.message}`);
    const wf1 = r1.body.data.workflowId;
    expect(wf1, 'first submit returns a workflowId');
    expect(r1.body.data.status === 'submitted', `status should be submitted, got ${r1.body.data.status}`);
    const r2 = await api('finance/remittances/submit', fmgr1Token, { id, idempotencyKey: key });
    ok(r2, `idempotent retry failed: ${r2.body.message}`);
    expect(r2.body.data.workflowId === wf1, `retry should return ${wf1}, got ${r2.body.data.workflowId}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 1, `exactly one workflow, got ${(wfs ?? []).length}`);
    const evc = (await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', id).eq('event_type', 'finance.remittance.submitted')).count ?? 0;
    expect(evc === 1, `exactly one submitted event, got ${evc}`);
    const auc = (await sb.from('hr_audit_log').select('id', { count: 'exact', head: true })
      .eq('record_id', id).eq('action', 'remittance.submitted')).count ?? 0;
    expect(auc === 1, `exactly one audit row, got ${auc}`);
    const r3 = await api('finance/remittances/submit', fmgr1Token, { id, idempotencyKey: `a3-str-${id}` });
    fails(r3, 'resubmitting a submitted remittance should be rejected');
    const { data: wfs2 } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs2 ?? []).length === 1, `still exactly one workflow, got ${(wfs2 ?? []).length}`);
  });

  await test('A3 atomic: concurrent submits — exactly one succeeds, one workflow', async () => {
    const id = await seedDraftRem('nis_nibtt');
    const [a, b2] = await Promise.all([
      api('finance/remittances/submit', fmgr1Token, { id, idempotencyKey: `a3-c1-${id}` }),
      api('finance/remittances/submit', fmgr1Token, { id, idempotencyKey: `a3-c2-${id}` }),
    ]);
    expect([a, b2].filter(x => x.body.success).length === 1, 'exactly one concurrent submit should succeed');
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 1, `exactly one workflow, got ${(wfs ?? []).length}`);
  });

  await test('A3 atomic: a submit without an idempotency key is rejected', async () => {
    const id = await seedDraftRem('health_surcharge');
    const r = await api('finance/remittances/submit', fmgr1Token, { id });
    fails(r, 'submit without an idempotency key should be rejected');
    const { data: rem } = await sb.from('finance_remittances').select('status').eq('id', id).single();
    expect(rem.status === 'draft', `remittance should stay draft, got ${rem.status}`);
  });

  await test('A3 atomic: cleanup seeded run + remittances', async () => {
    for (const rid of atomCtx.remIds) {
      try { await sb.from('workflow_instances').delete().eq('source_record_id', rid); } catch {}
      try { await sb.from('app_events').delete().eq('source_entity_id', rid); } catch {}
      try { await sb.from('hr_audit_log').delete().eq('record_id', rid); } catch {}
      try { await sb.from('finance_remittances').delete().eq('id', rid); } catch {}
    }
    if (atomCtx.runId) { try { await sb.from('finance_payroll_runs').delete().eq('id', atomCtx.runId); } catch {} }
    expect(true, 'cleanup complete');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Access control');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED remittances/list', async () => {
    fails(await api('finance/remittances/list', empToken, {}), 'employee should be denied list');
  });

  await test('employee is DENIED remittances/create', async () => {
    fails(await api('finance/remittances/create', empToken, { payrollRunId: ctx.runId, authority: 'nis_nibtt' }), 'employee should be denied create');
  });

  await test('finance_staff can VIEW (list) and CREATE (has manage) but is DENIED approve', async () => {
    ok(await api('finance/remittances/list', fstaff1Token, {}), 'finance_staff should be able to list');
    // finance_staff holds finance.remittances.manage by design ("can view and
    // create/manage remittances, not approve") — use a distinct authority (paye_bir)
    // so this doesn't collide with the nis_nibtt/health_surcharge remittances created
    // later in this suite for the same run.
    const r = await api('finance/remittances/create', fstaff1Token, { payrollRunId: ctx.runId, authority: 'paye_bir' });
    ok(r, `finance_staff create should succeed (has manage): ${r.body.message}`);
    ctx.staffRemId = r.body.data.id;
    fails(await api('finance/remittances/approve', fstaff1Token, { id: '00000000-0000-0000-0000-000000000000' }), 'finance_staff should be denied approve');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Compute');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('compute NIS from the approved run → sums employee + employer portions', async () => {
    const r = await api('finance/remittances/compute', fmgr1Token, { payrollRunId: ctx.runId, authority: 'nis_nibtt' });
    ok(r, `compute failed: ${r.body.message}`);
    const d = r.body.data;
    expect(Math.abs(d.employeePortion - 277.20) < 0.01, `NIS employee portion mismatch: ${d.employeePortion}`);
    expect(Math.abs(d.employerPortion - 582.40) < 0.01, `NIS employer portion mismatch: ${d.employerPortion}`);
    expect(Math.abs(d.totalDue - 859.60) < 0.01, `NIS total mismatch: ${d.totalDue}`);
    expect(d.lineCount === 2, 'expected 2 computed lines');
  });

  await test('compute PAYE from the approved run → employee portion only', async () => {
    const r = await api('finance/remittances/compute', fmgr1Token, { payrollRunId: ctx.runId, authority: 'paye_bir' });
    ok(r, `compute PAYE failed: ${r.body.message}`);
    expect(Math.abs(r.body.data.totalDue - 2000.00) < 0.01, `PAYE total mismatch: ${r.body.data.totalDue}`);
    expect(r.body.data.employerPortion === 0, 'PAYE employer portion should be 0');
  });

  await test('compute on a NON-approved (draft) run → refused (422)', async () => {
    fails(await api('finance/remittances/compute', fmgr1Token, { payrollRunId: ctx.draftRunId, authority: 'nis_nibtt' }), 'compute on draft run should fail');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Lifecycle + SoD');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager creates an NIS remittance (draft) from the run', async () => {
    const r = await api('finance/remittances/create', fmgr1Token, { payrollRunId: ctx.runId, authority: 'nis_nibtt', dueDate: '2026-07-15' });
    ok(r, `create failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id, 'missing id');
    expect(d.status === 'draft', `expected draft, got ${d.status}`);
    expect(d.authority === 'nis_nibtt', 'authority mismatch');
    expect(Math.abs(d.totalDue - 859.60) < 0.01, `total mismatch: ${d.totalDue}`);
    ctx.nisRemId = d.id;
  });

  await test('§2 side-effect: finance.remittance.created event + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_remittances').eq('event_type', 'finance.remittance.created')
        .eq('source_entity_id', ctx.nisRemId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'created app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_remittances').eq('action', 'remittance.created').eq('record_id', ctx.nisRemId).limit(1);
    expect((audit ?? []).length > 0, 'created audit row not found');
  });

  await test('submit (draft → submitted) starts the approval workflow', async () => {
    const r = await api('finance/remittances/submit', fmgr1Token, { id: ctx.nisRemId, idempotencyKey: `rem-nis-submit-${TAG}` });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'submitted', `expected submitted, got ${r.body.data.status}`);
  });

  await test('SoD: creator (fmgr1) cannot approve their own remittance → refused', async () => {
    fails(await api('finance/remittances/approve', fmgr1Token, { id: ctx.nisRemId }), 'creator should not approve own remittance');
  });

  await test('a DIFFERENT finance_manager (fmgr2) can approve', async () => {
    const r = await api('finance/remittances/approve', fmgr2Token, { id: ctx.nisRemId });
    ok(r, `approve failed: ${r.body.message}`);
    expect(r.body.data.status === 'approved', `expected approved, got ${r.body.data.status}`);
  });

  await test('mark-paid (approved → paid) with authority reference', async () => {
    const r = await api('finance/remittances/mark-paid', fmgr2Token, { id: ctx.nisRemId, paidDate: '2026-07-10', authorityReference: `NIBTT-${TAG.slice(-6)}` });
    ok(r, `mark-paid failed: ${r.body.message}`);
    expect(r.body.data.status === 'paid', `expected paid, got ${r.body.data.status}`);
  });

  await test('mark-filed (paid → filed) with all Wave 2B fields', async () => {
    const r = await api('finance/remittances/mark-filed', fmgr2Token, {
      id: ctx.nisRemId,
      filedDate:          '2026-07-12',
      authorityReference: `NIBTT-FILE-${TAG.slice(-6)}`,
      filingMethod:       'online_portal',
      receiptReference:   `RCPT-${TAG.slice(-6)}`,
      filedNotes:         'E2E filing test',
    });
    ok(r, `mark-filed failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.status === 'filed', `expected filed, got ${d.status}`);
    expect(d.filingMethod === 'online_portal', `filingMethod mismatch: ${d.filingMethod}`);
    expect(d.receiptReference != null, 'receiptReference should be set');
    expect(d.filedNotes === 'E2E filing test', 'filedNotes mismatch');
  });

  await test('§2 side-effect: approved + paid + filed events all written', async () => {
    const gotAll = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('event_type')
        .eq('source_module', 'finance_remittances').eq('source_entity_id', ctx.nisRemId);
      const types = new Set((data ?? []).map(e => e.event_type));
      return ['finance.remittance.approved', 'finance.remittance.paid', 'finance.remittance.filed'].every(t => types.has(t));
    });
    expect(gotAll, 'approved/paid/filed events not all present');
  });

  // Gap 8: message thread + notification side-effects from mark-filed ─────────

  await test('§2 side-effect (Gap 8): mark-filed creates a message thread anchored to the remittance', async () => {
    const gotThread = await waitFor(async () => {
      const { data } = await sb.from('message_threads')
        .select('id')
        .eq('source_module', 'finance_remittances')
        .eq('source_entity_id', ctx.nisRemId)
        .limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotThread, 'mark-filed should create a message_threads row with source_module=finance_remittances and source_entity_id=nisRemId');
  });

  await test('§2 side-effect (Gap 8): mark-filed notification written to notifications table', async () => {
    // The backbone's notification spec always includes createdBy as recipientUserIds,
    // ensuring a notifications row is written with source_id = remittance id.
    const gotNotif = await waitFor(async () => {
      const { data } = await sb.from('notifications')
        .select('id')
        .eq('source_id', ctx.nisRemId)
        .limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(gotNotif, 'mark-filed notification not found in notifications table (source_id should equal the remittance id)');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Cancel + reports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('create a Health-Surcharge remittance then cancel it (with reason)', async () => {
    const cr = await api('finance/remittances/create', fmgr1Token, { payrollRunId: ctx.runId, authority: 'health_surcharge' });
    ok(cr, `create HS failed: ${cr.body.message}`);
    ctx.cancelRemId = cr.body.data.id;
    const r = await api('finance/remittances/cancel', fmgr1Token, { id: ctx.cancelRemId, reason: 'E2E cancel' });
    ok(r, `cancel failed: ${r.body.message}`);
    expect(r.body.data.status === 'cancelled', `expected cancelled, got ${r.body.data.status}`);
  });

  await test('get returns the remittance with all Wave 2B fields the frontend consumes', async () => {
    const r = await api('finance/remittances/get', fmgr1Token, { id: ctx.nisRemId });
    ok(r, `get failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of ['id', 'remittanceNo', 'authority', 'status', 'totalDue', 'employeePortion', 'employerPortion', 'periodYear', 'periodMonth', 'filingMethod', 'receiptReference', 'filedNotes']) {
      expect(k in d, `get response missing ${k}`);
    }
    // Verify filed fields are present on the filed record
    expect(d.filingMethod === 'online_portal', `filing method should be online_portal, got ${d.filingMethod}`);
    expect(d.filedNotes === 'E2E filing test', `filedNotes should match, got ${d.filedNotes}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Lines list-all (Wave 2B)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('lines/list-all returns lines with remittance context (authority + period + remittanceNo)', async () => {
    const r = await api('finance/remittances/lines/list-all', fmgr1Token, {});
    ok(r, `lines/list-all failed: ${r.body.message}`);
    const rows = r.body.data;
    expect(Array.isArray(rows), 'lines/list-all should return an array');
    if (rows.length > 0) {
      const first = rows[0];
      for (const k of ['id', 'remittanceId', 'employeeId', 'employeePortion', 'employerPortion', 'lineTotal', 'authority', 'periodYear', 'periodMonth', 'remittanceNo']) {
        expect(k in first, `lines/list-all row missing ${k}`);
      }
    }
  });

  await test('lines/list-all filtered by authority returns only matching lines', async () => {
    const r = await api('finance/remittances/lines/list-all', fmgr1Token, { authority: 'nis_nibtt' });
    ok(r, `lines/list-all with authority filter failed: ${r.body.message}`);
    const rows = r.body.data;
    for (const row of rows) {
      expect(row.authority === 'nis_nibtt', `Expected nis_nibtt, got ${row.authority}`);
    }
  });

  await test('employee is DENIED lines/list-all', async () => {
    fails(await api('finance/remittances/lines/list-all', empToken, {}), 'employee should be denied lines/list-all');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Audit log (Wave 2B)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('audit/list returns hr_audit_log entries for the remittance', async () => {
    const r = await api('finance/remittances/audit/list', fmgr1Token, { id: ctx.nisRemId });
    ok(r, `audit/list failed: ${r.body.message}`);
    const rows = r.body.data;
    expect(Array.isArray(rows), 'audit/list should return an array');
    // The filed remittance should have at least created + submitted + approved + paid + filed
    expect(rows.length >= 1, `Expected at least 1 audit entry, got ${rows.length}`);
    if (rows.length > 0) {
      const first = rows[0];
      for (const k of ['id', 'action', 'createdAt']) {
        expect(k in first, `audit entry missing ${k}`);
      }
    }
  });

  await test('employee is DENIED audit/list', async () => {
    fails(await api('finance/remittances/audit/list', empToken, { id: ctx.nisRemId }), 'employee should be denied audit/list');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Reports (Wave 2B)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('reports/run returns remittance_summary with correct ReportResult shape', async () => {
    const r = await api('finance/remittances/reports/run', fmgr1Token, { report: 'remittance_summary' });
    ok(r, `reports/run failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.report === 'remittance_summary', `report key mismatch: ${d.report}`);
    expect(typeof d.generatedAt === 'string', 'generatedAt should be a string');
    expect(Array.isArray(d.rows), 'rows should be an array');
  });

  await test('reports/run remittance_lines returns per-employee breakdown', async () => {
    const r = await api('finance/remittances/reports/run', fmgr1Token, { report: 'remittance_lines' });
    ok(r, `reports/run lines failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.report === 'remittance_lines', `report key mismatch: ${d.report}`);
    expect(Array.isArray(d.rows), 'rows should be an array');
  });

  await test('reports/run authority_filing_status returns filing status per authority', async () => {
    const r = await api('finance/remittances/reports/run', fmgr1Token, { report: 'authority_filing_status' });
    ok(r, `reports/run filing status failed: ${r.body.message}`);
    expect(r.body.data.report === 'authority_filing_status', 'report key mismatch');
  });

  await test('reports/run with unknown report key returns 422', async () => {
    fails(await api('finance/remittances/reports/run', fmgr1Token, { report: 'unknown_report' }), 'unknown report key should fail');
  });

  await test('finance_staff is DENIED reports/run', async () => {
    fails(await api('finance/remittances/reports/run', fstaff1Token, { report: 'remittance_summary' }), 'finance_staff should be denied reports/run');
  });

  await test('employee is DENIED reports/run', async () => {
    fails(await api('finance/remittances/reports/run', empToken, { report: 'remittance_summary' }), 'employee should be denied reports/run');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Ticket side-effect (§12 / §20)');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The mark-filed backend raises a ticket when isOverdue || missingReceipt.
  // Exercise the missingReceipt path (omit receiptReference) using staffRemId
  // (paye_bir, created by fstaff1 — currently in 'draft' status).
  //
  // Flow: submit as fstaff1 → approve as fmgr1 (≠ creator → SoD passes) →
  //       mark-paid as fmgr1 → mark-filed WITHOUT receiptReference as fmgr1
  //       → assert tickets row with source_entity_id = staffRemId exists.

  await test('take staffRemId (paye_bir) to filed without receipt reference — triggers §12 ticket', async () => {
    // submit as fstaff1 (has finance.remittances.manage)
    let r = await api('finance/remittances/submit', fstaff1Token, { id: ctx.staffRemId, idempotencyKey: `rem-staff-submit-${TAG}` });
    ok(r, `submit staffRemId failed: ${r.body.message}`);
    expect(r.body.data.status === 'submitted', `expected submitted, got ${r.body.data.status}`);

    // approve by fmgr1 (creator = fstaff1 ≠ fmgr1 → SoD passes)
    r = await api('finance/remittances/approve', fmgr1Token, { id: ctx.staffRemId });
    ok(r, `approve staffRemId failed: ${r.body.message}`);
    expect(r.body.data.status === 'approved', `expected approved, got ${r.body.data.status}`);

    // mark-paid by fmgr1
    r = await api('finance/remittances/mark-paid', fmgr1Token, {
      id:       ctx.staffRemId,
      paidDate: '2026-07-10',
    });
    ok(r, `mark-paid staffRemId failed: ${r.body.message}`);
    expect(r.body.data.status === 'paid', `expected paid, got ${r.body.data.status}`);

    // mark-filed WITHOUT receiptReference → missingReceipt = true → ticket must be raised
    r = await api('finance/remittances/mark-filed', fmgr1Token, {
      id:           ctx.staffRemId,
      filedDate:    '2026-07-12',
      filingMethod: 'in_person',
      // receiptReference intentionally omitted — §12 requires a ticket when missing
    });
    ok(r, `mark-filed staffRemId (no receipt) failed: ${r.body.message}`);
    expect(r.body.data.status === 'filed', `expected filed, got ${r.body.data.status}`);
  });

  await test('§12 / §20: ticket row created in tickets table when receipt reference is missing on mark-filed', async () => {
    const gotTicket = await waitFor(async () => {
      const { data } = await sb
        .from('tickets')
        .select('id')
        .eq('source_module', 'finance_remittances')
        .eq('source_entity_id', ctx.staffRemId)
        .limit(1);
      return (data ?? []).length > 0;
    }, 8000);
    expect(
      gotTicket,
      '§12 ticket not found — expected a tickets row with source_module=finance_remittances ' +
      'and source_entity_id=staffRemId when receiptReference is omitted from mark-filed',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › mark-filed permission (Wave 2B)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_staff (has manage, not markFiled) is DENIED mark-filed', async () => {
    // finance_staff can manage remittances (create/submit/cancel) but cannot mark filed —
    // that requires the separate finance.remittances.markFiled permission.
    fails(await api('finance/remittances/mark-filed', fstaff1Token, { id: ctx.staffRemId, filedDate: '2026-07-12', filingMethod: 'online_portal' }), 'finance_staff should be denied mark-filed');
  });

  await test('list can be searched by remittanceNo', async () => {
    const r = await api('finance/remittances/list', fmgr1Token, { search: 'REM' });
    ok(r, `list with search failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'search result should be an array');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › CSV export (Gap 9)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('CSV export (Gap 9) — list endpoint returns all fields the client-side CSV template uses', async () => {
    // The RemPaymentsTab and main register both call exportCsv() against the
    // list response.  Assert every field referenced in the CsvColumn definitions
    // is present in the list response shape (including payrollRunNo added in Wave 2B).
    const r = await api('finance/remittances/list', fmgr1Token, {});
    ok(r, `list failed for CSV-field check: ${r.body.message}`);
    const rows = r.body.data;
    expect(Array.isArray(rows), 'list should return an array');
    // At least the NIS remittance we created should be present.
    expect(rows.length > 0, 'list should return at least one remittance (the E2E NIS rem)');
    const first = rows[0];
    const csvFields = [
      'remittanceNo', 'authority', 'periodYear', 'periodMonth', 'dueDate',
      'employeePortion', 'employerPortion', 'totalDue', 'status',
      'paidDate', 'filedDate', 'authorityReference', 'filingMethod',
      'receiptReference', 'payrollRunNo',
    ];
    for (const k of csvFields) {
      expect(k in first, `CSV source field '${k}' missing from list response`);
    }
    // payrollRunNo must be a string (resolved run code) or null — never undefined.
    expect(
      first.payrollRunNo === null || typeof first.payrollRunNo === 'string',
      `payrollRunNo must be string|null, got ${typeof first.payrollRunNo}`,
    );
  });
}
