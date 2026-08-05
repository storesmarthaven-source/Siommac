/**
 * scripts/e2e/suites/hrOnboardingWorker.mjs
 *
 * LIVE proof of the Worker ("My Onboarding") self-service projection.
 *
 * The whole point of this surface is what it does NOT return, so most of these assertions
 * are negative: a worker must never receive another worker's case, unassigned or
 * other-owner tasks, internal blockers, routing or audit. A read-model test that only
 * checks the happy path would pass while leaking all of it.
 *
 * The subject is always the authenticated actor — POST /onboarding/my accepts no employee
 * id — so isolation is proved by signing in AS the other worker, never by passing an id.
 *
 * REQUIRES (operator-applied before this run):
 *   20261003000000_hr_onboarding_worker_self_permission.sql   then NOTIFY pgrst.
 * Without it NO role holds hr.onboarding.self.view and every call here 403s.
 *
 * Every row is tagged with h.TAG and removed in onCleanup (LIFO, children before parents).
 */

export const title = 'HR Onboarding — worker self-service';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  for (const fn of ['section', 'acquireActors', 'onCleanup', 'mustDelete']) {
    if (typeof h[fn] !== 'function') throw new Error(`harness is missing required helper: h.${fn}()`);
  }

  // Two real workers. `forceSynthetic` so neither drags a pre-existing case into the counts.
  const { actors: [worker], createdIds: idW } = await h.acquireActors('employee', 1, {}, {}, { forceSynthetic: true });
  const { actors: [other],  createdIds: idO } = await h.acquireActors('employee', 1, {}, {}, { forceSynthetic: true });
  const { actors: [hr],     createdIds: idH } = await h.acquireActors('hr_manager', 1, {}, {}, { forceSynthetic: true });
  const actorIds = [...idW, ...idO, ...idH];
  const T = { worker: mint(worker), other: mint(other), hr: mint(hr) };

  const pkgIds = [], caseIds = [], taskIds = [], blockerIds = [], commIds = [], docIds = [];

  h.onCleanup(async () => {
    const nz = a => (a.length ? a : ['-']);
    await h.mustDelete('hr_onboarding_communications',   q => q.in('id', nz(commIds)));
    await h.mustDelete('hr_onboarding_document_requests', q => q.in('id', nz(docIds)));
    // The document row is FK'd from the request, so it must go after it.
    await h.mustDelete('hr_employee_documents',          q => q.in('employee_id', nz(actorIds)));
    await h.mustDelete('hr_onboarding_blockers',         q => q.in('id', nz(blockerIds)));
    await h.mustDelete('hr_onboarding_tasks',            q => q.in('id', nz(taskIds)));
    await h.mustDelete('hr_onboarding_cases',            q => q.in('id', nz(caseIds)));
    await h.mustDelete('hr_onboarding_task_templates',   q => q.in('package_id', nz(pkgIds)));
    await h.mustDelete('hr_onboarding_packages',         q => q.in('id', nz(pkgIds)));
    await h.mustDelete('app_users',                      q => q.in('id', nz(actorIds)));
  });

  const mine = tok => api('hr/onboarding/my', tok, {});
  const dataOf = (r, label) => {
    if (!('data' in (r.body ?? {}))) throw new Error(`${label}: no data key — ${JSON.stringify(r.body).slice(0, 240)}`);
    return r.body.data;
  };

  let pkgId, caseId, otherCaseId, myTaskId, foreignTaskId, unassignedTaskId, evidenceTaskId;

  await h.section('fixtures');

  await test('seed a package and one active case per worker', async () => {
    const pkg = await sb.from('hr_onboarding_packages').insert({
      package_key: `${TAG}_worker_pkg`.toLowerCase(), package_name: `${TAG} Worker Package`, status: 'active',
    }).select('id').single();
    if (pkg.error) throw new Error(pkg.error.message);
    pkgId = pkg.data.id; pkgIds.push(pkgId);

    const mk = async (employeeId, suffix) => {
      const r = await sb.from('hr_onboarding_cases').insert({
        case_no: `${TAG}-${suffix}`, employee_id: employeeId, worker_type: 'employee',
        package_key: `${TAG}_worker_pkg`.toLowerCase(), status: 'in_progress',
        owner_id: hr.id, started_by: hr.id, target_start_date: '2026-09-01',
      }).select('id').single();
      if (r.error) throw new Error(`case insert failed: ${r.error.message}`);
      caseIds.push(r.data.id);
      return r.data.id;
    };
    caseId = await mk(worker.id, 'W1');
    otherCaseId = await mk(other.id, 'W2');

    // Identical key sets: a multi-row PostgREST insert sends NULL for any key a row omits,
    // which overrides the column default and trips NOT NULL.
    const rows = [
      { case_id: caseId, task_key: 'w_mine', task_title: `${TAG} My Task`, owner_role: 'employee', module_key: 'hr', assigned_to: worker.id, status: 'pending', is_blocking: false, requires_evidence: false, sort_order: 1 },
      { case_id: caseId, task_key: 'w_unassigned', task_title: `${TAG} Unassigned Task`, owner_role: 'hr', module_key: 'hr', assigned_to: null, status: 'pending', is_blocking: true, requires_evidence: false, sort_order: 2 },
      { case_id: caseId, task_key: 'w_hr', task_title: `${TAG} HR Only Task`, owner_role: 'hr', module_key: 'hr', assigned_to: hr.id, status: 'pending', is_blocking: false, requires_evidence: false, sort_order: 3 },
      { case_id: caseId, task_key: 'w_evidence', task_title: `${TAG} Evidence Task`, owner_role: 'employee', module_key: 'hr', assigned_to: worker.id, status: 'pending', is_blocking: false, requires_evidence: true, sort_order: 4 },
      { case_id: otherCaseId, task_key: 'w_foreign', task_title: `${TAG} Foreign Task`, owner_role: 'employee', module_key: 'hr', assigned_to: other.id, status: 'pending', is_blocking: false, requires_evidence: false, sort_order: 1 },
    ];
    const t = await sb.from('hr_onboarding_tasks').insert(rows).select('id, task_key');
    if (t.error) throw new Error(`task insert failed: ${t.error.message}`);
    taskIds.push(...t.data.map(x => x.id));
    const byKey = Object.fromEntries(t.data.map(x => [x.task_key, x.id]));
    myTaskId = byKey.w_mine; unassignedTaskId = byKey.w_unassigned;
    foreignTaskId = byKey.w_foreign; evidenceTaskId = byKey.w_evidence;

    const b = await sb.from('hr_onboarding_blockers').insert({
      case_id: caseId, blocker_key: 'w_block', blocker_title: `${TAG} Internal Blocker`,
      blocking_module: 'it', severity: 'high', status: 'active', owner_id: hr.id,
    }).select('id').single();
    if (b.error) throw new Error(b.error.message);
    blockerIds.push(b.data.id);
  });

  await h.section('1 — the worker sees their own case, and only theirs');

  await test('the actor receives their own active case', async () => {
    const r = await mine(T.worker);
    ok(r, 'worker reads their onboarding');
    const d = dataOf(r, 'my onboarding');
    expect(d && d.caseId === caseId, `expected case ${caseId}, got ${d && d.caseId}`);
    expect(d.caseNo === `${TAG}-W1`, `wrong case_no: ${d.caseNo}`);
  });

  await test('a different worker receives their OWN case, never the first worker\'s', async () => {
    const d = dataOf(await mine(T.other), 'other worker');
    expect(d && d.caseId === otherCaseId, 'the second worker must get their own case');
    expect(d.caseId !== caseId, 'LEAK: one worker received another worker\'s case');
  });

  await test('the endpoint takes no employee id, so it cannot be aimed at anyone else', async () => {
    // Passing another worker's id must change nothing — the subject is the token.
    const r = await api('hr/onboarding/my', T.worker, { employeeId: other.id, caseId: otherCaseId });
    ok(r, 'my onboarding with injected ids');
    const d = dataOf(r, 'injected');
    expect(d.caseId === caseId, 'LEAK: a supplied employeeId/caseId changed the subject');
  });

  await h.section('2 — task isolation');

  await test('only tasks assigned to the actor are returned', async () => {
    const d = dataOf(await mine(T.worker), 'tasks');
    const ids = new Set((d.tasks ?? []).map(t => t.taskId));
    expect(ids.has(myTaskId), 'the worker\'s own task is missing');
    expect(ids.has(evidenceTaskId), 'the worker\'s evidence task is missing');
    expect(!ids.has(unassignedTaskId), 'LEAK: an unassigned internal task was returned');
    expect(!ids.has(foreignTaskId), 'LEAK: another case\'s task was returned');
    expect((d.tasks ?? []).length === 2, `expected exactly 2 worker tasks, got ${(d.tasks ?? []).length}`);
  });

  await test('internal blockers, routing and audit never appear', async () => {
    const d = dataOf(await mine(T.worker), 'shape');
    const keys = Object.keys(d);
    for (const forbidden of ['blockers', 'audit', 'handoffs', 'activeBlockers', 'ownerRole', 'workQueue']) {
      expect(!keys.includes(forbidden), `LEAK: worker payload exposes "${forbidden}"`);
    }
    const raw = JSON.stringify(d);
    expect(!raw.includes('Internal Blocker'), 'LEAK: an internal blocker title reached the worker');
    expect(!raw.includes('HR Only Task'), 'LEAK: an HR-only task reached the worker');
  });

  await h.section('3 — communications isolation');

  await test('only communications addressed to the actor are returned', async () => {
    const rows = [
      { case_id: caseId, communication_type: 'employee_welcome', channel: 'email', recipient_user_id: worker.id, subject: `${TAG} To The Worker`, body: 'yours', status: 'sent', sent_at: new Date().toISOString() },
      { case_id: caseId, communication_type: 'supervisor_notification', channel: 'email', recipient_user_id: hr.id, subject: `${TAG} To HR Only`, body: 'internal', status: 'sent', sent_at: new Date().toISOString() },
    ];
    const c = await sb.from('hr_onboarding_communications').insert(rows).select('id');
    if (c.error) throw new Error(`communication insert failed: ${c.error.message}`);
    commIds.push(...c.data.map(x => x.id));

    const d = dataOf(await mine(T.worker), 'messages');
    const subjects = (d.messages ?? []).map(m => m.subject ?? '');
    expect(subjects.some(s => s.includes('To The Worker')), 'the worker\'s own message is missing');
    expect(!subjects.some(s => s.includes('To HR Only')), 'LEAK: an HR-addressed message reached the worker');
  });

  await h.section('4 — progress and Day-One honesty');

  await test('progress spans the worker population and is not faked to 100%', async () => {
    const d = dataOf(await mine(T.worker), 'progress');
    expect(d.hasWorkerActions === true, 'a worker with assigned tasks must report hasWorkerActions');
    expect(d.progressPercent === 0, `nothing complete yet, so progress should be 0, got ${d.progressPercent}`);
  });

  await test('Day-One is NOT ready while the case is still in progress', async () => {
    const d = dataOf(await mine(T.worker), 'day one');
    expect(d.dayOneReady === false, 'an in-progress case must never report Day-One ready');
  });

  await test('a worker with no assigned work reports no actions rather than 100%', async () => {
    // The other worker's case has no tasks assigned to them beyond the foreign one; strip it
    // so the "nothing assigned" branch is exercised against real data.
    const upd = await sb.from('hr_onboarding_tasks').update({ assigned_to: null }).eq('id', foreignTaskId);
    if (upd.error) throw new Error(upd.error.message);
    const d = dataOf(await mine(T.other), 'empty worker');
    expect(d.hasWorkerActions === false, 'a worker with nothing assigned must report hasWorkerActions=false');
    expect(d.progressPercent === 0, `no actions must not read as complete, got ${d.progressPercent}`);
    expect(d.dayOneReady === false, 'Day-One must never be true merely because nothing is assigned');
    await sb.from('hr_onboarding_tasks').update({ assigned_to: other.id }).eq('id', foreignTaskId);
  });

  await h.section('5 — task completion authority');

  await test('the worker can complete a simple task assigned to them', async () => {
    const r = await api('hr/onboarding/task/complete', T.worker, { taskId: myTaskId });
    ok(r, 'complete own task');

    // The exact response contract the frontend consumes.
    const d = dataOf(r, 'complete');
    expect(d.taskId === myTaskId, `response taskId should be ${myTaskId}, got ${d.taskId}`);
    expect(d.status === 'completed', `response status should be completed, got ${d.status}`);
    expect(d.caseCompleted === false, 'the case still has open tasks, so caseCompleted must be false');

    const { data: row } = await sb.from('hr_onboarding_tasks').select('status, completed_by').eq('id', myTaskId).single();
    expect(row.status === 'completed', `task should be completed, got ${row.status}`);
    expect(row.completed_by === worker.id, 'the completer must be recorded');

    // A task-level event per successful completion — not only when the whole case closes.
    const { data: events } = await sb.from('app_events')
      .select('id, payload').eq('source_entity_id', caseId).eq('event_type', 'onboarding.task.completed');
    expect((events ?? []).length >= 1, 'completing a task must emit onboarding.task.completed');
    expect((events ?? []).some(e => e.payload?.taskId === myTaskId), 'the task event must identify its task');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('record_id', caseId).eq('action', 'hr.onboarding.task_completed');
    expect((audit ?? []).length >= 1, 'completing a task must write an hr_audit_log row');
  });

  await test('completing the same task twice is rejected, not silently repeated', async () => {
    const r = await api('hr/onboarding/task/complete', T.worker, { taskId: myTaskId });
    fails(r, 'a second completion of the same task must be rejected');
  });

  await test('closing the last open task completes the case and emits BOTH events', async () => {
    // Clear the remaining open tasks on this case so the worker's last one closes it.
    const { error } = await sb.from('hr_onboarding_tasks')
      .update({ status: 'skipped' }).eq('case_id', caseId).in('id', [unassignedTaskId]);
    if (error) throw new Error(error.message);
    const hrTask = await sb.from('hr_onboarding_tasks')
      .select('id').eq('case_id', caseId).eq('task_key', 'w_hr').single();
    await sb.from('hr_onboarding_tasks').update({ status: 'skipped' }).eq('id', hrTask.data.id);

    const r = await api('hr/onboarding/task/complete', T.worker, { taskId: evidenceTaskId });
    ok(r, 'complete the final task');
    const d = dataOf(r, 'final complete');
    expect(d.caseCompleted === true, 'closing the last open task must report caseCompleted');

    const { data: caseRow } = await sb.from('hr_onboarding_cases').select('status').eq('id', caseId).single();
    expect(caseRow.status === 'completed', `case should be completed, got ${caseRow.status}`);

    // The two events mean different things and BOTH must be present.
    const { data: taskEvents } = await sb.from('app_events')
      .select('id').eq('source_entity_id', caseId).eq('event_type', 'onboarding.task.completed');
    const { data: caseEvents } = await sb.from('app_events')
      .select('id').eq('source_entity_id', caseId).eq('event_type', 'onboarding.completed');
    expect((taskEvents ?? []).length >= 2, 'each completion emits its own task event');
    expect((caseEvents ?? []).length >= 1, 'case completion must still emit onboarding.completed');
  });

  await test('the worker cannot complete another worker\'s task', async () => {
    const r = await api('hr/onboarding/task/complete', T.worker, { taskId: foreignTaskId });
    fails(r, 'completing a foreign task must be denied');
  });

  await test('the worker cannot complete an unassigned internal task', async () => {
    const r = await api('hr/onboarding/task/complete', T.worker, { taskId: unassignedTaskId });
    fails(r, 'completing an unassigned internal task must be denied');
  });

  await h.section('7 — governed document upload / commit');

  let reqId, foreignReqId, waivedReqId, issuedPath;
  const urlFor = (tok, args) => api('hr/onboarding/my/document/upload-url', tok, args);
  const commit = (tok, args) => api('hr/onboarding/my/document/commit', tok, args);
  const FILE = { fileName: 'passport.pdf', mimeType: 'application/pdf', fileSize: 2048 };

  await test('seed document requests for both workers', async () => {
    // Section 5 deliberately drove this case to `completed`, and the upload guard correctly
    // refuses a closed case. Reopen it so section 7 exercises the document flow rather than
    // re-proving the closed-case guard (which has its own test below).
    const reopen = await sb.from('hr_onboarding_cases')
      .update({ status: 'in_progress', completed_at: null }).eq('id', caseId);
    if (reopen.error) throw new Error(`could not reopen the case: ${reopen.error.message}`);

    const rows = [
      { case_id: caseId, employee_id: worker.id, document_type: 'id_card', label: `${TAG} My ID`, status: 'pending', is_required: true, blocks_onboarding: false, can_waive: false, requires_expiry: false },
      { case_id: caseId, employee_id: worker.id, document_type: 'contract', label: `${TAG} Waived Doc`, status: 'waived', is_required: true, blocks_onboarding: false, can_waive: true, requires_expiry: false },
      { case_id: otherCaseId, employee_id: other.id, document_type: 'id_card', label: `${TAG} Their ID`, status: 'pending', is_required: true, blocks_onboarding: false, can_waive: false, requires_expiry: false },
    ];
    const r = await sb.from('hr_onboarding_document_requests').insert(rows).select('id, label');
    if (r.error) throw new Error(`document request insert failed: ${r.error.message}`);
    docIds.push(...r.data.map(x => x.id));
    const by = Object.fromEntries(r.data.map(x => [x.label, x.id]));
    reqId = by[`${TAG} My ID`]; waivedReqId = by[`${TAG} Waived Doc`]; foreignReqId = by[`${TAG} Their ID`];
  });

  await test('a worker cannot request an upload URL for another worker request', async () => {
    fails(await urlFor(T.worker, { requestId: foreignReqId, ...FILE }), 'cross-worker upload URL must be denied');
  });

  await test('a settled (waived) request cannot receive an upload', async () => {
    fails(await urlFor(T.worker, { requestId: waivedReqId, ...FILE }), 'a waived request must not be uploadable');
  });

  await test('an unsupported file type is rejected', async () => {
    fails(await urlFor(T.worker, { requestId: reqId, fileName: 'x.exe', mimeType: 'application/x-msdownload', fileSize: 100 }),
      'an executable must be rejected');
  });

  await test('an oversized file is rejected', async () => {
    fails(await urlFor(T.worker, { requestId: reqId, ...FILE, fileSize: 50 * 1024 * 1024 }),
      'a file over the limit must be rejected');
  });

  await test('the worker receives a signed URL on a server-derived path', async () => {
    const r = await urlFor(T.worker, { requestId: reqId, ...FILE });
    ok(r, 'issue upload url');
    const d = dataOf(r, 'upload url');
    expect(typeof d.uploadUrl === 'string' && d.uploadUrl.length > 0, 'an upload URL must be returned');
    expect(typeof d.token === 'string', 'a token must be returned');
    expect(typeof d.maxBytes === 'number', 'the size limit must be stated to the client');
    // The path is OURS — scoped to this actor and this request, never client-chosen.
    expect(d.path.startsWith(`onboarding/${worker.id}/${reqId}/`), `path must be actor+request scoped, got ${d.path}`);
    issuedPath = d.path;
  });

  await test('committing a forged path is refused', async () => {
    fails(await commit(T.worker, { requestId: reqId, path: `onboarding/${other.id}/${foreignReqId}/evil.pdf`, ...FILE }),
      'a path outside the issued prefix must be refused');
  });

  await test('committing before the file exists is refused', async () => {
    fails(await commit(T.worker, { requestId: reqId, path: issuedPath, ...FILE }),
      'a commit with no uploaded object must be refused');
  });

  await test('a real upload then commit records the document and its side effects', async () => {
    const bytes = Buffer.from('%PDF-1.4 e2e worker document');
    const put = await sb.storage.from('hr-employee-documents')
      .upload(issuedPath, bytes, { contentType: 'application/pdf', upsert: true });
    if (put.error) throw new Error(`could not place the test object: ${put.error.message}`);

    const r = await commit(T.worker, { requestId: reqId, path: issuedPath, ...FILE });
    ok(r, 'commit the document');
    const d = dataOf(r, 'commit');
    expect(d.requestId === reqId, 'response must identify the request');
    expect(typeof d.documentId === 'string', 'response must return the created document id');
    expect(d.status === 'uploaded', `response status should be uploaded, got ${d.status}`);

    const { data: req } = await sb.from('hr_onboarding_document_requests').select('status, document_id').eq('id', reqId).single();
    expect(req.status === 'uploaded', `request should be uploaded, got ${req.status}`);
    expect(req.document_id === d.documentId, 'the request must link to the created document');

    const { data: doc } = await sb.from('hr_employee_documents')
      .select('employee_id, file_path, confidentiality, uploaded_by').eq('id', d.documentId).single();
    expect(doc.employee_id === worker.id, 'the document must belong to the worker');
    expect(doc.file_path === issuedPath, 'the stored path must be the issued path');
    expect(doc.confidentiality === 'restricted_hr', 'onboarding evidence must be restricted');
    expect(doc.uploaded_by === worker.id, 'the uploader must be recorded');

    const { data: events } = await sb.from('app_events')
      .select('id').eq('source_entity_id', caseId).eq('event_type', 'onboarding.document.submitted');
    expect((events ?? []).length >= 1, 'a submission must emit onboarding.document.submitted');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('record_id', caseId).eq('action', 'hr.onboarding.document_submitted');
    expect((audit ?? []).length >= 1, 'a submission must write an hr_audit_log row');
  });

  await test('the same commit cannot be replayed onto the settled request', async () => {
    fails(await commit(T.worker, { requestId: reqId, path: issuedPath, ...FILE }),
      'replaying a commit against an uploaded request must be refused');
  });

  await test('a closed case refuses further document submission', async () => {
    const close = await sb.from('hr_onboarding_cases').update({ status: 'completed' }).eq('id', caseId);
    if (close.error) throw new Error(close.error.message);
    fails(await urlFor(T.worker, { requestId: waivedReqId, ...FILE }), 'a closed case must refuse uploads');
    await sb.from('hr_onboarding_cases').update({ status: 'in_progress' }).eq('id', caseId);
  });

  await test('the submitted document appears on the worker own projection', async () => {
    const d = dataOf(await mine(T.worker), 'after submit');
    const submitted = (d.documentRequests ?? []).find(x => x.requestId === reqId);
    expect(!!submitted, 'the request must still be visible to the worker');
    expect(submitted.status === 'uploaded', `worker should see it as uploaded, got ${submitted && submitted.status}`);
  });

  await h.section('6 — no onboarding at all');

  await test('a worker with no case receives null, not an error', async () => {
    const d = dataOf(await mine(T.hr), 'hr has no case of their own');
    expect(d === null, `expected null for an actor with no onboarding case, got ${JSON.stringify(d).slice(0, 120)}`);
  });
}
