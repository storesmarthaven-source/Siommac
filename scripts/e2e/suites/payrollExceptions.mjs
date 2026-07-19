/**
 * scripts/e2e/suites/payrollExceptions.mjs
 *
 * Live E2E for the Payroll Exceptions & Approvals slice (spec §15.3):
 *   POST /api/finance/payroll/findings/work-queue  — combined findings + approval-task keyset stream
 *   POST /api/finance/payroll/findings/detail       — one finding + activity feed
 *   POST /api/finance/payroll/findings/escalate     — reassign/escalate ownership (finding.assign gate)
 *   POST /api/finance/payroll/findings/comment       — append-only annotation (view_all gate)
 *
 * Approach: direct-seed deterministic runs/findings; drive commands through the API so the
 * §2 side-effects (event/audit/activity/notification) are exercised end-to-end.
 */
import { payrollRunSeed, payrollPeriod } from '../helpers/payrollRun.mjs';

export const title = 'Finance — Payroll Exceptions & Approvals (work-queue + escalate/comment)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  const mgrR = await acquireActors('finance_manager', 2, { pay_basis: 'salary', monthly_salary: 10000 });
  const stfR = await acquireActors('finance_staff', 1, { pay_basis: 'salary', monthly_salary: 8000 });
  const empR = await acquireActors('employee', 1, {}, {}, { forceSynthetic: true });
  const [fmgr1, fmgr2] = mgrR.actors, [fstaff] = stfR.actors, [emp] = empR.actors;
  const createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

  const T = {
    mgr:   mint({ id: fmgr1.id,  username: fmgr1.username,  role: 'finance_manager', department_id: fmgr1.department_id ?? null }),
    mgr2:  mint({ id: fmgr2.id,  username: fmgr2.username,  role: 'finance_manager', department_id: fmgr2.department_id ?? null }),
    staff: mint({ id: fstaff.id, username: fstaff.username, role: 'finance_staff',   department_id: fstaff.department_id ?? null }),
    emp:   mint({ id: emp.id,    username: emp.username,     role: 'employee',        department_id: emp.department_id ?? null }),
  };

  const ctx = {
    versionId: null, runA: null, runB: null,
    runIds: [], cvIds: [], snapIds: [], findingIds: [], workflowIds: [], taskIds: [],
    f: {},
  };
  let ik = 0;
  const key = (s) => `${TAG}:exc:${s}:${++ik}`;

  h.onCleanup(async () => {
    if (ctx.taskIds.length)     await h.mustDelete('workflow_tasks', q => q.in('id', ctx.taskIds));
    if (ctx.workflowIds.length) await h.mustDelete('workflow_instances', q => q.in('id', ctx.workflowIds));
    const runIds = ctx.runIds;
    if (runIds.length) {
      await sb.from('finance_payroll_runs').update({ current_calculation_version_id: null, current_input_snapshot_id: null }).in('id', runIds);
      await h.mustDelete('finance_payroll_finding_activity', q => q.in('run_id', runIds));
      if (ctx.findingIds.length) await h.mustDelete('finance_payroll_control_findings', q => q.in('id', ctx.findingIds));
      await h.mustDelete('finance_payroll_finding_command_receipts', q => q.in('finding_id', ctx.findingIds.length ? ctx.findingIds : ['00000000-0000-0000-0000-000000000000']));
      if (ctx.cvIds.length)   await h.mustDelete('finance_payroll_calculation_versions', q => q.in('id', ctx.cvIds));
      if (ctx.snapIds.length) await h.mustDelete('finance_payroll_input_snapshots', q => q.in('id', ctx.snapIds));
      await h.mustDelete('finance_payroll_run_warnings', q => q.in('run_id', runIds));
      await h.mustDelete('notifications',  q => q.in('source_id', runIds));
      await h.mustDelete('hr_audit_log',   q => q.in('record_id', ctx.findingIds.length ? ctx.findingIds : ['x']));
      await h.mustDelete('app_events',     q => q.in('source_entity_id', ctx.findingIds.length ? ctx.findingIds : ['x']));
      await h.mustDelete('finance_payroll_runs', q => q.in('id', runIds));
    }
    if (createdUserIds.length) await h.mustDelete('app_users', q => q.in('id', createdUserIds));
  });

  // ── statutory version ────────────────────────────────────────────────────────
  const { data: vsn } = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).limit(1).single();
  ctx.versionId = vsn?.id;
  if (!ctx.versionId) {
    const { data: any } = await sb.from('finance_statutory_versions').select('id').order('created_at', { ascending: false }).limit(1).single();
    ctx.versionId = any?.id;
  }
  expect(ctx.versionId, 'statutory version must exist for seeding');

  async function seedRun(saltKey, status) {
    const periodStart = payrollPeriod('payrollExceptions', saltKey, TAG);
    const row = payrollRunSeed({
      run_no: `${TAG}-EXC-${saltKey}`, periodStart, runType: 'scheduled',
      statutory_version_id: ctx.versionId, status,
      gross_total: 5000, net_total: 4000, deduction_total: 1000, employee_count: 2, created_by: fstaff.id,
    });
    const { data, error } = await sb.from('finance_payroll_runs').insert(row).select('id').single();
    expect(!error, `seed run ${saltKey}: ${error?.message}`);
    ctx.runIds.push(data.id);
    return data.id;
  }
  async function seedCalcChain(runId) {
    const { data: snap, error: se } = await sb.from('finance_payroll_input_snapshots')
      .insert({ run_id: runId, snapshot_no: 1, checksum: `exc-snap-${runId}`, employee_count: 2, input_count: 2 })
      .select('id').single();
    expect(!se, `snap: ${se?.message}`); ctx.snapIds.push(snap.id);
    const { data: cv, error: ce } = await sb.from('finance_payroll_calculation_versions')
      .insert({ run_id: runId, input_snapshot_id: snap.id, version_no: 1, checksum: `exc-cv-${runId}`,
        employee_count: 2, gross_total: 5000, deduction_total: 1000, net_total: 4000, nis_employer_total: 0,
        statutory_version_id: ctx.versionId, published_by: fstaff.id }).select('id').single();
    expect(!ce, `cv: ${ce?.message}`); ctx.cvIds.push(cv.id);
    await sb.from('finance_payroll_runs').update({ current_calculation_version_id: cv.id, current_input_snapshot_id: snap.id }).eq('id', runId);
    return cv.id;
  }
  async function seedFinding(runId, cvId, { severity, domain, state = 'open', title: ftitle }) {
    const { data, error } = await sb.from('finance_payroll_control_findings').insert({
      run_id: runId, calculation_version_id: cvId, source_type: 'e2e_exc', source_id: `${TAG}:${ftitle}:${++ik}`,
      finding_type: 'e2e_control', domain, severity, state, title: ftitle, detail: `exc test ${ftitle}`,
    }).select('*').single();
    expect(!error, `finding ${ftitle}: ${error?.message}`);
    ctx.findingIds.push(data.id);
    return data;
  }

  // Run A (calculated → commands allowed): blocker + warning + info + a warning to resolve.
  ctx.runA = await seedRun('runA', 'calculated');
  const cvA = await seedCalcChain(ctx.runA);
  ctx.f.blocker  = await seedFinding(ctx.runA, cvA, { severity: 'blocker', domain: 'variance',  title: 'EXC blocker' });
  ctx.f.warning  = await seedFinding(ctx.runA, cvA, { severity: 'warning', domain: 'statutory', title: 'EXC warning' });
  ctx.f.info     = await seedFinding(ctx.runA, cvA, { severity: 'info',    domain: 'population', title: 'EXC info' });
  ctx.f.toResolve = await seedFinding(ctx.runA, cvA, { severity: 'warning', domain: 'payment', title: 'EXC resolveme' });

  // Run B (pending_approval → commands frozen; comment still allowed): 1 finding.
  ctx.runB = await seedRun('runB', 'pending_approval');
  const cvB = await seedCalcChain(ctx.runB);
  ctx.f.frozen = await seedFinding(ctx.runB, cvB, { severity: 'warning', domain: 'input', title: 'EXC frozen' });

  const wq = (args, token = T.mgr) => api('finance/payroll/findings/work-queue', token, args);
  const findRow = (items, id) => items.find(i => i.id === id);
  // Re-fetch the live version before a mutating command — findings are shared across
  // tests (finance_staff also holds finding.assign via run.manage), so tracked versions drift.
  const curVer = async (id) => (await sb.from('finance_payroll_control_findings').select('version').eq('id', id).single()).data.version;

  // ═══════════════════════ work-queue ═══════════════════════
  await test('work-queue — 403 for employee', async () => {
    const r = await wq({}, T.emp);
    fails(r, 'employee denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('work-queue — 401 without token', async () => {
    const r = await api('finance/payroll/findings/work-queue', undefined, {});
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });

  await test('work-queue — manager gets items + full tabCounts', async () => {
    const r = await wq({ limit: 100 });
    ok(r, 'work-queue ok');
    const d = r.body.data;
    expect(Array.isArray(d.items), 'items array');
    expect(typeof d.total === 'number', 'total number');
    expect(typeof d.asOf === 'string', 'asOf string');
    for (const k of ['all', 'approvals', 'blockers', 'warnings', 'resolved'])
      expect(typeof d.tabCounts[k] === 'number', `tabCounts.${k} number`);
    // our seeded findings present
    expect(findRow(d.items, ctx.f.blocker.id), 'blocker row present');
    expect(findRow(d.items, ctx.f.warning.id), 'warning row present');
  });

  await test('work-queue — item shape + DEC-EXC-008 mapping', async () => {
    const r = await wq({ limit: 100 });
    ok(r, 'ok');
    const b = findRow(r.body.data.items, ctx.f.blocker.id);
    expect(b.kind === 'blocker' && b.severity === 'critical', `blocker→critical, got ${b.kind}/${b.severity}`);
    const w = findRow(r.body.data.items, ctx.f.warning.id);
    expect(w.kind === 'warning' && w.severity === 'medium', `warning→medium, got ${w.kind}/${w.severity}`);
    const inf = findRow(r.body.data.items, ctx.f.info.id);
    expect(inf.kind === 'warning' && inf.severity === 'low', `info→warning/low, got ${inf.kind}/${inf.severity}`);
    expect(b.run && b.run.reference === `${TAG}-EXC-runA`, 'run.reference resolved');
    expect(b.impact && b.impact.currency === 'TTD' && b.impact.amount === null, 'finding impact nulled');
    expect(Array.isArray(b.allowedActions) && b.allowedActions.includes('escalate'), 'blocker allowedActions include escalate');
    expect(!b.allowedActions.includes('waive'), 'blocker cannot waive (allowedActions)');
    expect(w.allowedActions.includes('waive'), 'warning can waive');
    expect(b.workflowTaskId === null, 'finding workflowTaskId null');
  });

  await test('work-queue — tab=blockers returns only blocker kind', async () => {
    const r = await wq({ tab: 'blockers', limit: 100 });
    ok(r, 'ok');
    for (const it of r.body.data.items) expect(it.kind === 'blocker', `non-blocker in blockers tab: ${it.kind}`);
    expect(findRow(r.body.data.items, ctx.f.blocker.id), 'our blocker present');
    expect(!findRow(r.body.data.items, ctx.f.warning.id), 'warning absent from blockers tab');
  });

  await test('work-queue — search matches title', async () => {
    const r = await wq({ search: 'EXC blocker', limit: 100 });
    ok(r, 'ok');
    expect(findRow(r.body.data.items, ctx.f.blocker.id), 'search finds blocker');
  });

  await test('work-queue — keyset pagination: no dup/missing', async () => {
    const seen = [];
    let cursor, pages = 0;
    do {
      const r = await wq({ limit: 2, cursor });
      ok(r, `page ${pages + 1}`);
      for (const it of r.body.data.items) { expect(!seen.includes(it.id), `dup ${it.id}`); seen.push(it.id); }
      cursor = r.body.data.nextCursor; pages++;
      if (pages > 300) break;
    } while (cursor);
    for (const f of [ctx.f.blocker, ctx.f.warning, ctx.f.info, ctx.f.toResolve])
      expect(seen.filter(id => id === f.id).length === 1, `seeded finding appears once: ${f.title}`);
  });

  await test('work-queue — malformed cursor → 422', async () => {
    const r = await wq({ cursor: 'not-a-valid-cursor' });
    fails(r, 'malformed cursor');
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  await test('work-queue — read-only: writes no app_events', async () => {
    const before = await sb.from('app_events').select('id', { count: 'exact', head: true });
    await wq({ limit: 50 });
    const after = await sb.from('app_events').select('id', { count: 'exact', head: true });
    expect(after.count === before.count, `read-only: app_events ${before.count}->${after.count}`);
  });

  // ═══════════════════════ detail ═══════════════════════
  await test('findings/detail — returns detail + activity feed', async () => {
    const r = await api('finance/payroll/findings/detail', T.mgr, { findingId: ctx.f.blocker.id });
    ok(r, 'detail ok');
    const d = r.body.data;
    expect(d.id === ctx.f.blocker.id, 'id matches');
    expect(d.kind === 'blocker' && d.severity === 'critical', 'mapping in detail');
    expect(d.trigger && d.trigger.ruleKey === 'e2e_control', 'trigger.ruleKey');
    expect(d.subject && d.subject.scopeLabel === 'variance', 'subject.scopeLabel = domain');
    expect(d.activity && Array.isArray(d.activity.items), 'activity page items array');
  });

  await test('findings/detail — 403 for employee', async () => {
    const r = await api('finance/payroll/findings/detail', T.emp, { findingId: ctx.f.blocker.id });
    fails(r, 'denied'); expect(r.status === 403, `403, got ${r.status}`);
  });

  await test('findings/detail — unknown id → 404', async () => {
    const r = await api('finance/payroll/findings/detail', T.mgr, { findingId: '00000000-0000-4000-8000-000000000000' });
    fails(r, '404'); expect(r.status === 404, `404, got ${r.status}`);
  });

  // ═══════════════════════ escalate ═══════════════════════
  await test('escalate — 403 for employee (no finding.assign)', async () => {
    const r = await api('finance/payroll/findings/escalate', T.emp, {
      findingId: ctx.f.warning.id, expectedVersion: await curVer(ctx.f.warning.id), idempotencyKey: key('esc-emp'), assigneeId: fmgr2.id,
    });
    fails(r, 'employee denied'); expect(r.status === 403, `403, got ${r.status}`);
  });

  await test('escalate — missing assigneeId → 400 (request validation)', async () => {
    const r = await api('finance/payroll/findings/escalate', T.mgr, {
      findingId: ctx.f.warning.id, expectedVersion: await curVer(ctx.f.warning.id), idempotencyKey: key('esc-noassignee'),
    });
    fails(r, 'no assignee'); expect(r.status === 400, `400, got ${r.status}`);
  });

  await test('escalate — unknown id → 404', async () => {
    const r = await api('finance/payroll/findings/escalate', T.mgr, {
      findingId: '00000000-0000-4000-8000-000000000000', expectedVersion: 1, idempotencyKey: key('esc-404'), assigneeId: fmgr2.id,
    });
    fails(r, '404'); expect(r.status === 404, `404, got ${r.status}`);
  });

  await test('escalate — manager escalates → in_progress + reassigned + exact side-effects', async () => {
    const evBefore = await sb.from('app_events').select('id', { count: 'exact', head: true }).eq('source_entity_id', ctx.f.blocker.id);
    const r = await api('finance/payroll/findings/escalate', T.mgr, {
      findingId: ctx.f.blocker.id, expectedVersion: await curVer(ctx.f.blocker.id), idempotencyKey: key('esc-ok'), assigneeId: fmgr2.id, note: 'please review',
    });
    ok(r, `escalate: ${r.body.message}`);
    expect(r.body.data.state === 'in_progress', `state in_progress, got ${r.body.data.state}`);
    expect(r.body.data.assigneeId === fmgr2.id, 'reassigned to mgr2');
    ctx.f.blocker.version = r.body.data.version;
    // exactly 1 escalate event + 1 activity + 1 audit
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'finance.payroll.finding.escalate').eq('source_entity_id', ctx.f.blocker.id);
    expect((ev ?? []).length === 1, `exactly 1 escalate event, got ${(ev ?? []).length}`);
    const { data: act } = await sb.from('finance_payroll_finding_activity').select('id').eq('finding_id', ctx.f.blocker.id).eq('activity_type', 'escalate');
    expect((act ?? []).length === 1, `exactly 1 escalate activity, got ${(act ?? []).length}`);
    const { data: aud } = await sb.from('hr_audit_log').select('id').eq('record_id', ctx.f.blocker.id).eq('action', 'payroll_finding.escalate');
    expect((aud ?? []).length === 1, `exactly 1 escalate audit, got ${(aud ?? []).length}`);
    // notification to the new assignee
    const { data: notif } = await sb.from('notifications').select('id').eq('user_id', fmgr2.id).eq('source_id', ctx.f.blocker.id);
    expect((notif ?? []).length >= 1, 'assignee notified');
  });

  await test('escalate — same idempotencyKey returns original, no duplicate side-effects', async () => {
    // The command route returns the finding object (not a {duplicate} envelope), so assert the
    // real replay invariants: same finding, unchanged version, and no 2nd activity/event row.
    const sameKey = key('esc-idem');
    const v0 = await curVer(ctx.f.warning.id);
    const r1 = await api('finance/payroll/findings/escalate', T.mgr, { findingId: ctx.f.warning.id, expectedVersion: v0, idempotencyKey: sameKey, assigneeId: fmgr2.id });
    ok(r1, `first escalate: ${r1.body.message}`);
    const actCount = async () => (await sb.from('finance_payroll_finding_activity').select('id', { count: 'exact', head: true }).eq('finding_id', ctx.f.warning.id).eq('activity_type', 'escalate')).count;
    const evCount  = async () => (await sb.from('app_events').select('id', { count: 'exact', head: true }).eq('event_type', 'finance.payroll.finding.escalate').eq('source_entity_id', ctx.f.warning.id)).count;
    const a1 = await actCount(), e1 = await evCount();
    const r2 = await api('finance/payroll/findings/escalate', T.mgr, { findingId: ctx.f.warning.id, expectedVersion: v0, idempotencyKey: sameKey, assigneeId: fmgr2.id });
    ok(r2, 'replay is success');
    expect(r2.body.data.id === r1.body.data.id, 'replay returns the same finding id');
    expect(r2.body.data.version === r1.body.data.version, `replay version unchanged (${r1.body.data.version} vs ${r2.body.data.version})`);
    const a2 = await actCount(), e2 = await evCount();
    expect(a1 === a2, `no new escalate activity on replay (${a1} -> ${a2})`);
    expect(e1 === e2, `no duplicate escalate event on replay (${e1} -> ${e2})`);
  });

  await test('escalate — stale expectedVersion → 409', async () => {
    const r = await api('finance/payroll/findings/escalate', T.mgr, { findingId: ctx.f.blocker.id, expectedVersion: 1, idempotencyKey: key('esc-stale'), assigneeId: fmgr2.id });
    fails(r, 'stale'); expect(r.status === 409, `409, got ${r.status}`);
  });

  await test('escalate — writes NO workflow rows (DEC-EXC-004 guard)', async () => {
    const before = await sb.from('workflow_tasks').select('id', { count: 'exact', head: true });
    await api('finance/payroll/findings/escalate', T.mgr, { findingId: ctx.f.info.id, expectedVersion: await curVer(ctx.f.info.id), idempotencyKey: key('esc-nowf'), assigneeId: fmgr2.id });
    const after = await sb.from('workflow_tasks').select('id', { count: 'exact', head: true });
    expect(after.count === before.count, `no workflow_tasks written (${before.count}->${after.count})`);
  });

  // ═══════════════════════ comment ═══════════════════════
  await test('comment — 403 for employee', async () => {
    const r = await api('finance/payroll/findings/comment', T.emp, { findingId: ctx.f.blocker.id, idempotencyKey: key('cmt-emp'), body: 'nope' });
    fails(r, 'denied'); expect(r.status === 403, `403, got ${r.status}`);
  });

  await test('comment — empty body → 400 (request validation)', async () => {
    const r = await api('finance/payroll/findings/comment', T.staff, { findingId: ctx.f.blocker.id, idempotencyKey: key('cmt-empty'), body: '   ' });
    fails(r, 'empty'); expect(r.status === 400, `400, got ${r.status}`);
  });

  await test('comment — unknown id → 404', async () => {
    const r = await api('finance/payroll/findings/comment', T.staff, { findingId: '00000000-0000-4000-8000-000000000000', idempotencyKey: key('cmt-404'), body: 'x' });
    fails(r, '404'); expect(r.status === 404, `404, got ${r.status}`);
  });

  await test('comment — staff can comment; exact side-effects; no version bump', async () => {
    const { data: pre } = await sb.from('finance_payroll_control_findings').select('version').eq('id', ctx.f.warning.id).single();
    const r = await api('finance/payroll/findings/comment', T.staff, { findingId: ctx.f.warning.id, idempotencyKey: key('cmt-ok'), body: 'staff annotation' });
    ok(r, `comment: ${r.body.message}`);
    expect(r.body.data.activity && r.body.data.activity.activityType === 'comment', 'returns comment activity');
    const { data: post } = await sb.from('finance_payroll_control_findings').select('version').eq('id', ctx.f.warning.id).single();
    expect(pre.version === post.version, `version unchanged (${pre.version} -> ${post.version})`);
    const { data: act } = await sb.from('finance_payroll_finding_activity').select('id').eq('finding_id', ctx.f.warning.id).eq('activity_type', 'comment');
    expect((act ?? []).length === 1, `exactly 1 comment activity, got ${(act ?? []).length}`);
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'finance.payroll.finding.comment').eq('source_entity_id', ctx.f.warning.id);
    expect((ev ?? []).length === 1, `exactly 1 comment event, got ${(ev ?? []).length}`);
  });

  await test('comment — idempotent (same key, no 2nd activity)', async () => {
    const sameKey = key('cmt-idem');
    const r1 = await api('finance/payroll/findings/comment', T.staff, { findingId: ctx.f.info.id, idempotencyKey: sameKey, body: 'once' });
    ok(r1, 'first comment');
    const { count: c1 } = await sb.from('finance_payroll_finding_activity').select('id', { count: 'exact', head: true }).eq('finding_id', ctx.f.info.id).eq('activity_type', 'comment');
    const r2 = await api('finance/payroll/findings/comment', T.staff, { findingId: ctx.f.info.id, idempotencyKey: sameKey, body: 'once' });
    ok(r2, 'replay'); expect(r2.body.data.duplicate === true || r2.body.data.activity, 'replay returns');
    const { count: c2 } = await sb.from('finance_payroll_finding_activity').select('id', { count: 'exact', head: true }).eq('finding_id', ctx.f.info.id).eq('activity_type', 'comment');
    expect(c1 === c2, `no new activity on replay (${c1} -> ${c2})`);
  });

  await test('comment — allowed on FROZEN (pending_approval) run', async () => {
    const r = await api('finance/payroll/findings/comment', T.mgr, { findingId: ctx.f.frozen.id, idempotencyKey: key('cmt-frozen'), body: 'note on submitted run' });
    ok(r, `comment on frozen run should succeed: ${r.body.message}`);
  });

  // ═══════════════════════ FSM negatives ═══════════════════════
  await test('waive — blocker not waivable → 422', async () => {
    const r = await api('finance/payroll/findings/waive', T.mgr, { id: ctx.f.blocker.id, expectedVersion: await curVer(ctx.f.blocker.id), idempotencyKey: key('waive-blk'), reason: 'try' });
    fails(r, 'blocker waive'); expect(r.status === 422, `422, got ${r.status}`);
  });

  await test('command on FROZEN run → 409 (escalate on pending_approval finding)', async () => {
    const { data } = await sb.from('finance_payroll_control_findings').select('version').eq('id', ctx.f.frozen.id).single();
    const r = await api('finance/payroll/findings/escalate', T.mgr, { findingId: ctx.f.frozen.id, expectedVersion: data.version, idempotencyKey: key('esc-frozen'), assigneeId: fmgr2.id });
    fails(r, 'frozen command'); expect(r.status === 409, `409, got ${r.status}`);
  });

  await test('resolve then reopen writes activity; reopen of open → 409', async () => {
    const { data: pre } = await sb.from('finance_payroll_control_findings').select('version').eq('id', ctx.f.toResolve.id).single();
    const rr = await api('finance/payroll/findings/resolve', T.mgr, { id: ctx.f.toResolve.id, expectedVersion: pre.version, idempotencyKey: key('res-ok'), note: 'resolved for e2e', evidence: { source: TAG } });
    ok(rr, `resolve: ${rr.body.message}`);
    const { data: ra } = await sb.from('finance_payroll_finding_activity').select('id').eq('finding_id', ctx.f.toResolve.id).eq('activity_type', 'resolve');
    expect((ra ?? []).length === 1, 'resolve wrote 1 activity');
    // reopen the resolved one
    const rp = await api('finance/payroll/findings/reopen', T.mgr, { id: ctx.f.toResolve.id, expectedVersion: rr.body.data.version, idempotencyKey: key('reopen-ok'), reason: 'reopen for e2e' });
    ok(rp, `reopen: ${rp.body.message}`);
    const { data: rpa } = await sb.from('finance_payroll_finding_activity').select('id').eq('finding_id', ctx.f.toResolve.id).eq('activity_type', 'reopen');
    expect((rpa ?? []).length === 1, 'reopen wrote 1 activity');
    // reopen again (now open) → 409
    const rp2 = await api('finance/payroll/findings/reopen', T.mgr, { id: ctx.f.toResolve.id, expectedVersion: rp.body.data.version, idempotencyKey: key('reopen-open'), reason: 'again' });
    fails(rp2, 'reopen open'); expect(rp2.status === 409, `409, got ${rp2.status}`);
  });

  // ═══════════════════════ approval-kind row (workflow-task link) ═══════════════════════
  await test('work-queue — approval row is review-only + exposes workflowTaskId + reads write no workflow rows', async () => {
    // clone an existing finance_payroll workflow_instance (inherits template FKs), point it at run B
    const { data: proto, error: pErr } = await sb.from('workflow_instances').select('*').eq('module_key', 'finance_payroll').limit(1).maybeSingle();
    if (pErr || !proto) { h.skip('no finance_payroll workflow_instance to clone'); return; }
    const inst = { ...proto };
    delete inst.id;
    inst.workflow_no = `${TAG}-EXC-WQ`;
    inst.source_record_id = ctx.runB;
    inst.source_record_ref = `${TAG}-EXC-runB`;
    inst.status = 'active';
    inst.active_transition_id = null;
    const { data: wi, error: wErr } = await sb.from('workflow_instances').insert(inst).select('id').single();
    if (wErr) { h.skip(`workflow_instance clone insert failed: ${wErr.message}`); return; }
    ctx.workflowIds.push(wi.id);
    const { data: task, error: tErr } = await sb.from('workflow_tasks').insert({
      workflow_id: wi.id, step_key: 'approve', step_type: 'approval', status: 'open',
      task_title: `${TAG} approval`, assigned_to: fmgr1.id, is_required: true,
    }).select('id').single();
    if (tErr) { h.skip(`approval task insert failed: ${tErr.message}`); return; }
    ctx.taskIds.push(task.id);

    const wtBefore = await sb.from('workflow_tasks').select('id', { count: 'exact', head: true });
    const r = await wq({ tab: 'approvals', limit: 100 });
    ok(r, 'approvals tab ok');
    const row = findRow(r.body.data.items, `task:${task.id}`);
    expect(row, 'approval row present in approvals tab');
    expect(row.kind === 'approval' && row.severity === 'high', `approval kind/high, got ${row.kind}/${row.severity}`);
    expect(Array.isArray(row.allowedActions) && row.allowedActions.length === 1 && row.allowedActions[0] === 'review', 'allowedActions == [review]');
    expect(row.workflowTaskId === task.id, 'workflowTaskId exposed');
    expect(r.body.data.tabCounts.approvals >= 1, 'tabCounts.approvals >= 1');
    const wtAfter = await sb.from('workflow_tasks').select('id', { count: 'exact', head: true });
    expect(wtAfter.count === wtBefore.count, 'reading approvals wrote no workflow rows');
  });
}
