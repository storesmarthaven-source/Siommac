/**
 * scripts/e2e/suites/hrOnboardingWorkQueue.mjs
 *
 * LIVE proof of the unified Onboarding Work Queue slice:
 *
 *   1. Due-rule resolution   — {"offsetDays": n} from the frozen plan becomes a real due_at
 *                              on BOTH tasks and handoffs; an empty rule stays Unscheduled.
 *   2. Evidence write path   — uploads land in hr_onboarding_task_evidence, NOT in
 *                              task metadata, and carry a real review decision.
 *   3. Review actions        — approve / return, with audit + event + notification.
 *   4. Queue read model      — one server-paginated union over tasks, handoffs, blockers
 *                              and evidence with EXACT totals.
 *
 * WHY THESE ASSERTIONS ARE SHAPED THIS WAY
 * The RPC is the only place the union, the lifecycle mapping and the pagination exist, and
 * none of it is reachable from a mocked client. Every check below therefore reads the real
 * HTTP response or the real table through the service-role client — never a stub. Readers
 * throw on a missing key rather than defaulting, because a tolerant `?? []` is exactly how
 * three assertions in the scope suite passed while proving nothing.
 *
 * REQUIRES (operator-applied immediately before this run):
 *   20260930000002_hr_onboarding_work_queue_foundation.sql
 *   20260930000003_hr_onboarding_work_queue_rpc.sql
 *   then NOTIFY pgrst, 'reload schema';
 * Without them the queue endpoint 500s on a missing function and evidence writes 500 on a
 * missing table.
 *
 * Every row is tagged with h.TAG and removed in onCleanup (LIFO, children before parents).
 */

export const title = 'HR Onboarding — unified Work Queue';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  for (const fn of ['section', 'acquireActors', 'onCleanup', 'mustDelete']) {
    if (typeof h[fn] !== 'function') throw new Error(`harness is missing required helper: h.${fn}()`);
  }

  // ── Actors ────────────────────────────────────────────────────────────────────
  // forceSynthetic: the queue is scope-filtered by ownership, so a real roster user would
  // drag pre-existing cases into every count.
  const { actors: [manager], createdIds: idMgr }   = await h.acquireActors('hr_manager', 1, {}, {}, { forceSynthetic: true });
  const { actors: [staff],   createdIds: idStaff } = await h.acquireActors('hr_staff',   1, {}, {}, { forceSynthetic: true });
  const actorIds = [...idMgr, ...idStaff];
  const T = { manager: mint(manager), staff: mint(staff) };

  const pkgIds = [], tplIds = [], deptIds = [], employeeIds = [], caseIds = [];
  const taskIds = [], handoffIds = [], blockerIds = [], evidenceIds = [];

  h.onCleanup(async () => {
    const nz = a => (a.length ? a : ['-']);
    await h.mustDelete('hr_onboarding_task_evidence',    q => q.in('id', nz(evidenceIds)));
    await h.mustDelete('hr_onboarding_blockers',         q => q.in('id', nz(blockerIds)));
    await h.mustDelete('hr_onboarding_handoffs',         q => q.in('id', nz(handoffIds)));
    await h.mustDelete('hr_onboarding_tasks',            q => q.in('id', nz(taskIds)));
    await h.mustDelete('hr_onboarding_cases',            q => q.in('id', nz(caseIds)));
    await h.mustDelete('hr_onboarding_task_templates',   q => q.in('package_id', nz(pkgIds)));
    await h.mustDelete('hr_onboarding_handoff_templates', q => q.in('package_id', nz(pkgIds)));
    await h.mustDelete('hr_onboarding_packages',         q => q.in('id', nz(pkgIds)));
    // Route idempotency records reference the synthetic actors. Remove them before
    // deleting app_users so cleanup is complete rather than relying on the next sweep.
    await h.mustDelete('module_mutation_runs',            q => q.in('actor_user_id', nz([...actorIds, ...employeeIds])));
    await h.mustDelete('app_users',                      q => q.in('id', nz(employeeIds)));
    await h.mustDelete('departments',                    q => q.in('id', nz(deptIds)));
    await h.mustDelete('app_users',                      q => q.in('id', nz(actorIds)));
    void tplIds;
  });

  // ── Readers that fail loudly ──────────────────────────────────────────────────
  const dataOf = (r, label) => {
    const d = r.body?.data;
    if (!d) throw new Error(`${label}: no data — got ${JSON.stringify(r.body).slice(0, 300)}`);
    return d;
  };
  const queueOf = (r, label) => {
    const d = dataOf(r, label);
    if (!Array.isArray(d.rows)) throw new Error(`${label}: rows is not an array — keys ${Object.keys(d).join(',')}`);
    if (typeof d.total !== 'number') throw new Error(`${label}: total is not a number — got ${JSON.stringify(d.total)}`);
    return d;
  };
  const rowKey = r => `${r.sourceType}:${r.sourceId}`;
  /**
   * Guard for tests that depend on an earlier fixture. Without it a broken seed makes a
   * negative-path test pass for the WRONG reason — the endpoint rejects `undefined` rather
   * than rejecting the thing under test.
   */
  const need = (value, what) => {
    if (!value) throw new Error(`fixture missing: ${what} — an earlier step did not complete`);
    return value;
  };

  const queue = (tok, args = {}) => api('hr/onboarding/work-queue/list', tok, args);

  /**
   * Launch is now a governed transaction: it needs an idempotency `requestId` and an
   * explicit disposition for every unsatisfied document requirement. This suite is not
   * testing either, so it supplies a fresh request id and asks the worker for whatever the
   * real requirements turn out to be.
   */
  async function startCase(token, args) {
    const preview = await api('hr/onboarding/intake-preview', token, {
      employeeId: args.employeeId, packageKey: args.packageKey,
      targetStartDate: args.targetStartDate ?? null,
    });
    const documentSelections = (preview.body?.data?.documents?.items ?? [])
      .filter(item => item.state !== 'present_verified')
      .map(item => ({ requirementId: item.requirementId, action: 'request_from_worker' }));
    return api('hr/onboarding/start', token, { requestId: crypto.randomUUID(), documentSelections, ...args });
  }


  // ── Fixtures ──────────────────────────────────────────────────────────────────
  // The planned first day is fixed and in the past, so "overdue" is deterministic rather
  // than depending on when the suite runs.
  const START_DATE = '2026-03-10';
  const dayAfter = n => new Date(Date.UTC(2026, 2, 10 + n)).toISOString();

  let deptId, employeeId, pkgKey, caseId;

  await h.section('fixtures');

  await test('seed a department, employee and a package whose plan carries due offsets', async () => {
    const dept = await sb.from('departments').insert({ name: `${TAG} WQ Dept` }).select('id').single();
    if (dept.error) throw new Error(dept.error.message);
    deptId = dept.data.id; deptIds.push(deptId);

    employeeId = `USR-${TAG}-WQE`;
    // username is NOT NULL on app_users — omitting it fails the insert and silently
    // cascades into every downstream fixture.
    const emp = await sb.from('app_users').insert({
      id: employeeId, username: `${TAG}_wq_subject`, full_name: `${TAG} Queue Subject`,
      role: 'employee', department_id: deptId, status: 'active',
    }).select('id').single();
    if (emp.error) throw new Error(`employee insert failed: ${emp.error.message}`);
    employeeIds.push(employeeId);

    pkgKey = `${TAG}_wq_pkg`.toLowerCase();
    const pkg = await sb.from('hr_onboarding_packages').insert({
      package_key: pkgKey, package_name: `${TAG} Work Queue Package`, status: 'active',
    }).select('id').single();
    if (pkg.error) throw new Error(pkg.error.message);
    pkgIds.push(pkg.data.id);

    // Two tasks: one scheduled three days BEFORE the start date, one with an empty rule.
    // One handoff scheduled one day AFTER. This is the whole due-rule contract.
    // Both objects MUST carry an identical key set. On a multi-row insert PostgREST builds
    // one column list from the union of the objects and sends NULL for any key a row omits,
    // which overrides the column DEFAULT and trips the NOT NULL constraint. Relying on
    // defaults here is only safe when every row spells every column out.
    const tpls = await sb.from('hr_onboarding_task_templates').insert([
      { package_id: pkg.data.id, task_key: 'wq_scheduled', task_title: `${TAG} Scheduled Task`,
        owner_role: 'hr', module_key: 'hr', sort_order: 1,
        is_required: true, is_blocking: false, requires_evidence: true,
        due_rule: { offsetDays: -3 } },
      { package_id: pkg.data.id, task_key: 'wq_unscheduled', task_title: `${TAG} Unscheduled Task`,
        owner_role: 'hr', module_key: 'hr', sort_order: 2,
        is_required: true, is_blocking: false, requires_evidence: false,
        due_rule: {} },
    ]).select('id');
    if (tpls.error) throw new Error(`task template insert failed: ${tpls.error.message}`);
    tplIds.push(...tpls.data.map(t => t.id));

    const hTpl = await sb.from('hr_onboarding_handoff_templates').insert({
      package_id: pkg.data.id, handoff_key: 'wq_handoff', target_module: 'it',
      handoff_type: 'account_provisioning', due_rule: { offsetDays: 1 },
    }).select('id');
    if (hTpl.error) throw new Error(hTpl.error.message);
  });

  await h.section('1 — due-rule resolution');

  await test('start resolves task and handoff due dates from the frozen plan', async () => {
    const r = await startCase(T.manager, {
      employeeId, packageKey: pkgKey, ownerId: manager.id, targetStartDate: START_DATE,
    });
    ok(r, 'start onboarding case');
    caseId = dataOf(r, 'start').caseId;
    expect(!!caseId, 'start returned no caseId');
    caseIds.push(caseId);

    const { data: tks, error: tErr } = await sb.from('hr_onboarding_tasks')
      .select('id, task_key, due_at').eq('case_id', caseId);
    if (tErr) throw new Error(tErr.message);
    taskIds.push(...tks.map(t => t.id));

    const scheduled = tks.find(t => t.task_key === 'wq_scheduled');
    const unscheduled = tks.find(t => t.task_key === 'wq_unscheduled');
    expect(!!scheduled && !!unscheduled, 'both template tasks should have been created');

    // -3 days from 2026-03-10 is 2026-03-07. Asserted exactly: an "is not null" check would
    // pass on any invented date.
    expect(scheduled.due_at && scheduled.due_at.slice(0, 10) === '2026-03-07',
      `scheduled task due_at should be 2026-03-07, got ${scheduled.due_at}`);
    expect(unscheduled.due_at === null,
      `a template with an empty due_rule must stay Unscheduled, got ${unscheduled.due_at}`);

    const { data: hfs, error: hErr } = await sb.from('hr_onboarding_handoffs')
      .select('id, due_at').eq('case_id', caseId);
    if (hErr) throw new Error(hErr.message);
    handoffIds.push(...hfs.map(x => x.id));
    expect(hfs.length === 1, `expected 1 handoff, got ${hfs.length}`);
    expect(hfs[0].due_at && hfs[0].due_at.slice(0, 10) === '2026-03-11',
      `handoff due_at should be 2026-03-11, got ${hfs[0].due_at}`);
  });

  await test('launch REFUSES a case with no target start date', async () => {
    // This test used to launch an anchorless case and assert every item was Unscheduled.
    // The governed launch now REQUIRES a target start date, so that state is unreachable
    // through `start` and the old assertion was testing an impossible case. The no-anchor
    // path is still covered: the empty `due_rule` template above proves a task with no rule
    // stays Unscheduled even when the case DOES have a start date.
    const id2 = `USR-${TAG}-WQE2`;
    const emp2 = await sb.from('app_users').insert({
      id: id2, username: `${TAG}_wq_subject2`, full_name: `${TAG} Queue Subject Two`,
      role: 'employee', department_id: deptId, status: 'active',
    }).select('id').single();
    if (emp2.error) throw new Error(`second employee insert failed: ${emp2.error.message}`);
    employeeIds.push(id2);

    const r = await startCase(T.manager, { employeeId: id2, packageKey: pkgKey, ownerId: manager.id });
    fails(r, 'a launch with no target start date must be refused');
    expect(/target start date/i.test(r.body?.message ?? ''),
      `the refusal should name the missing start date, got: ${r.body?.message}`);
  });

  await h.section('2 — evidence write path');

  let taskId, evidenceId;

  await test('attaching evidence writes a table row, not task metadata', async () => {
    const { data: tk } = await sb.from('hr_onboarding_tasks')
      .select('id, metadata').eq('case_id', caseId).eq('task_key', 'wq_scheduled').single();
    taskId = tk.id;

    const r = await api('hr/onboarding/task/attach-evidence', T.manager, {
      taskId, fileName: `${TAG}-proof.pdf`, filePath: `onboarding/${TAG}/proof.pdf`,
      mimeType: 'application/pdf', fileSize: 2048,
    });
    ok(r, 'attach evidence');
    evidenceId = dataOf(r, 'attach').evidenceId;
    evidenceIds.push(evidenceId);

    const { data: row, error } = await sb.from('hr_onboarding_task_evidence')
      .select('id, task_id, case_id, file_name, review_status, version, submitted_by, is_legacy')
      .eq('id', evidenceId).single();
    if (error) throw new Error(`evidence row not found: ${error.message}`);
    expect(row.task_id === taskId, 'evidence row must point at its task');
    expect(row.case_id === caseId, 'evidence row must carry its case for queue scoping');
    expect(row.review_status === 'pending_review', `new evidence must be pending_review, got ${row.review_status}`);
    expect(row.version === 1, `first submission should be version 1, got ${row.version}`);
    expect(row.is_legacy === false, 'a fresh upload is not legacy evidence');

    // The legacy JSON path must be dead: nothing may have been appended to metadata.
    const { data: after } = await sb.from('hr_onboarding_tasks').select('metadata').eq('id', taskId).single();
    const legacy = after?.metadata?.evidence;
    expect(!Array.isArray(legacy) || legacy.length === 0,
      `metadata.evidence must no longer be written — found ${JSON.stringify(legacy)}`);
  });

  await h.section('3 — review actions');

  await test('returning evidence requires a reason', async () => {
    need(evidenceId, 'evidenceId');
    const r = await api('hr/onboarding/task/review-evidence', T.manager, {
      evidenceId, decision: 'returned',
    });
    fails(r, 'returning evidence without a note must be rejected');
  });

  await test('return records the decision, audit, event and a notification', async () => {
    need(evidenceId, 'evidenceId');
    const before = await sb.from('notifications').select('id', { count: 'exact', head: true });
    const r = await api('hr/onboarding/task/review-evidence', T.manager, {
      evidenceId, decision: 'returned', note: `${TAG} illegible scan`,
    });
    ok(r, 'return evidence');

    const { data: row } = await sb.from('hr_onboarding_task_evidence')
      .select('review_status, reviewed_by, reviewed_at, review_note').eq('id', evidenceId).single();
    expect(row.review_status === 'returned', `expected returned, got ${row.review_status}`);
    expect(row.reviewed_by === manager.id, 'reviewer must be recorded');
    expect(!!row.reviewed_at, 'review timestamp must be recorded');
    expect(row.review_note?.includes(TAG), 'the reason must be stored');

    const { data: events } = await sb.from('app_events')
      .select('id').eq('source_entity_id', caseId).eq('event_type', 'onboarding.task.evidence_returned');
    expect((events ?? []).length >= 1, 'a return must emit onboarding.task.evidence_returned');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('record_id', caseId).eq('action', 'hr.onboarding.task_evidence_returned');
    expect((audit ?? []).length >= 1, 'a return must write an audit row');

    const after = await sb.from('notifications').select('id', { count: 'exact', head: true });
    expect((after.count ?? 0) > (before.count ?? 0), 'a return must notify the assignee');
  });

  await test('a decided submission cannot be reviewed twice', async () => {
    need(evidenceId, 'evidenceId');
    const r = await api('hr/onboarding/task/review-evidence', T.manager, {
      evidenceId, decision: 'approved',
    });
    fails(r, 'a second decision on the same submission must be rejected');
  });

  await test('a resubmission supersedes the returned one and can be approved', async () => {
    need(taskId, 'taskId'); need(evidenceId, 'evidenceId');
    const r = await api('hr/onboarding/task/attach-evidence', T.manager, {
      taskId, fileName: `${TAG}-proof-v2.pdf`, filePath: `onboarding/${TAG}/proof-v2.pdf`,
    });
    ok(r, 'attach replacement evidence');
    const v2 = dataOf(r, 'attach v2').evidenceId;
    evidenceIds.push(v2);

    const { data: row } = await sb.from('hr_onboarding_task_evidence')
      .select('version, supersedes_id').eq('id', v2).single();
    expect(row.version === 2, `resubmission should be version 2, got ${row.version}`);
    expect(row.supersedes_id === evidenceId, 'a resubmission must reference what it replaces');

    const approve = await api('hr/onboarding/task/review-evidence', T.manager, {
      evidenceId: v2, decision: 'approved',
    });
    ok(approve, 'approve replacement evidence');
    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('record_id', caseId).eq('action', 'hr.onboarding.task_evidence_approved');
    expect((audit ?? []).length >= 1, 'an approval must write an audit row');
  });

  await test('hr_staff cannot rule on evidence', async () => {
    need(evidenceId, 'evidenceId');
    const r = await api('hr/onboarding/task/review-evidence', T.staff, {
      evidenceId, decision: 'approved',
    });
    fails(r, 'hr_staff must not hold hr.onboarding.task.manage');
    expect(r.status === 403 || r.body?.success === false,
      `expected a denial, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await h.section('4 — unified queue read');

  await test('a blocker joins the same queue as tasks, handoffs and evidence', async () => {
    need(caseId, 'caseId');
    const b = await sb.from('hr_onboarding_blockers').insert({
      case_id: caseId, blocker_key: 'wq_blocker', blocker_title: `${TAG} Queue Blocker`,
      blocking_module: 'it', severity: 'high', status: 'active', owner_id: manager.id,
      due_at: dayAfter(2),
    }).select('id').single();
    if (b.error) throw new Error(b.error.message);
    blockerIds.push(b.data.id);

    const r = await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG });
    ok(r, 'work queue list');
    const d = queueOf(r, 'queue');
    const types = new Set(d.rows.map(x => x.sourceType));
    for (const t of ['task', 'handoff', 'blocker', 'evidence']) {
      expect(types.has(t), `queue is missing every ${t} row — got ${[...types].join(',') || 'nothing'}`);
    }
  });

  await test('rows carry both the raw and the normalised status, plus a source link', async () => {
    const d = queueOf(await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG }), 'queue');
    expect(d.rows.length > 0, 'expected fixture rows');
    const LIFECYCLES = new Set(['open', 'in_progress', 'blocked', 'done', 'cancelled']);
    for (const row of d.rows) {
      expect(typeof row.sourceStatus === 'string' && row.sourceStatus.length > 0,
        `row ${rowKey(row)} lost its sourceStatus`);
      expect(LIFECYCLES.has(row.normalizedStatus),
        `row ${rowKey(row)} has an unmapped normalizedStatus "${row.normalizedStatus}"`);
      expect(typeof row.sourceId === 'string' && !!row.caseId,
        `row ${rowKey(row)} cannot be opened without sourceId + caseId`);
      // Accountable person and owning queue are separate axes and must not be merged.
      expect(!('department' in row) || row.departmentId !== row.owningQueue,
        'owning queue must not be conflated with the subject department');
    }
  });

  await test('the total is exact and stable across pages, with no repeats or gaps', async () => {
    const full = queueOf(await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG }), 'full');
    expect(full.total === full.rows.length,
      `single-page total ${full.total} should equal the ${full.rows.length} rows returned`);

    const seen = new Set();
    let pages = 0;
    for (let page = 1; page <= 20; page++) {
      const d = queueOf(await queue(T.manager, { scope: 'all', pageSize: 2, page, query: TAG }), `page ${page}`);
      expect(d.total === full.total, `page ${page} reported total ${d.total}, expected ${full.total}`);
      if (!d.rows.length) break;
      pages++;
      for (const row of d.rows) {
        const k = rowKey(row);
        expect(!seen.has(k), `row ${k} appeared on more than one page — pagination is not stable`);
        seen.add(k);
      }
    }
    expect(pages > 1, 'expected the fixture set to span more than one page at pageSize 2');
    expect(seen.size === full.total,
      `paging collected ${seen.size} distinct rows but the total is ${full.total}`);
  });

  await test('a page past the end returns no rows but still reports the true total', async () => {
    const full = queueOf(await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG }), 'full');
    const d = queueOf(await queue(T.manager, { scope: 'all', pageSize: 5, page: 500, query: TAG }), 'out of range');
    expect(d.rows.length === 0, 'a page past the end must return no rows');
    expect(d.total === full.total,
      `an out-of-range page reported total ${d.total}; the real total is ${full.total} and must not collapse to 0`);
  });

  await test('filters narrow the queue and are applied server-side', async () => {
    const all = queueOf(await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG }), 'all');

    const tasksOnly = queueOf(await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG, sourceTypes: ['task'] }), 'tasks only');
    expect(tasksOnly.rows.every(r => r.sourceType === 'task'), 'sourceTypes filter leaked another type');
    expect(tasksOnly.total < all.total, 'filtering by one source type should reduce the total');
    expect(tasksOnly.total === tasksOnly.rows.length, 'filtered total must match the filtered rows');

    const unscheduled = queueOf(await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG, dueState: 'unscheduled' }), 'unscheduled');
    expect(unscheduled.rows.every(r => r.dueAt === null), 'the unscheduled filter returned dated work');
    expect(unscheduled.total >= 1, 'the empty-due-rule task should be Unscheduled');

    const overdue = queueOf(await queue(T.manager, { scope: 'all', pageSize: 200, query: TAG, dueState: 'overdue' }), 'overdue');
    expect(overdue.rows.every(r => r.dueAt !== null && new Date(r.dueAt) < new Date()),
      'the overdue filter returned work that is not overdue');
  });

  await test('an invalid scope is rejected, not silently narrowed', async () => {
    const r = await queue(T.manager, { scope: 'everything' });
    fails(r, 'an unrecognised scope must be rejected');
  });

  await test('an unauthorised scope is denied rather than downgraded', async () => {
    const r = await queue(T.staff, { scope: 'all', pageSize: 50 });
    fails(r, 'hr_staff must not be able to read the all-scope queue');
    expect(r.status === 403 || r.body?.success === false,
      `expected 403, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await test('an over-long filter array is rejected', async () => {
    const r = await queue(T.manager, { scope: 'all', accountableIds: Array.from({ length: 500 }, (_, i) => `u${i}`) });
    fails(r, 'an unbounded id list must be rejected before it reaches SQL');
  });

  await test('hr_staff defaults to their own work and sees no one else\'s', async () => {
    // The manager owns every fixture case, so the staff member's default queue must not
    // contain any of them. This is the "assigned to me" default, proved by absence.
    const d = queueOf(await queue(T.staff, { pageSize: 200, query: TAG }), 'staff default');
    expect(d.rows.length === 0,
      `hr_staff's default queue leaked ${d.rows.length} rows owned by someone else`);
    expect(d.total === 0, `hr_staff's default total should be 0, got ${d.total}`);
  });
}
