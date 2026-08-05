/**
 * scripts/e2e/suites/hrOnboarding.mjs
 *
 * E2E for HR Onboarding (v36 §10) + the management module (Phases 2–5), mounted at
 * /api/hr/onboarding/* :
 *   LAUNCH:  preview-package → start → get → task/reassign → task/complete → cancel
 *   PKGS:    packages/list (DB-driven)
 *   MGMT:    reassign-owner / pause / resume / task block-unblock / blocker escalate-
 *            waive-resolve / task/add / ready / complete / audit  + reads (dashboard-
 *            stats / list / tasks/list / handoffs/list / timeline reuse)
 *   CUSTOM:  actions/templates create-list-update-retire + actions/case add (from
 *            template + one-off document_request) / list / complete / cancel
 *
 * Covers package instantiation, assignee resolution, auto-completion, the case state
 * machine + blocker lifecycle, custom-action instantiation into the REAL lifecycle
 * (task + pending handoff; approval-without-template rejected), access control against
 * REAL roles (employee denied), and §2 side-effects (rows + app_events + hr_audit_log).
 *
 * REQUIRES (operator-applied, in order):
 *   20260709000000_hr_onboarding.sql, 20260710000001, 20260711000002,
 *   20260714000000_hr_onboarding_management.sql, 20260714000001 (perms),
 *   20260714000002 + 20260714000003 (packages + seed),
 *   20260714000004 + 20260714000005 (custom actions + perms)   then NOTIFY pgrst.
 */

export const title = 'HR Onboarding';

export default async function run(h) {
  const { api: rawApi, test, expect, ok, fails, mint, sb, TAG } = h;

  /**
   * Launch now REFUSES a case unless every unsatisfied document requirement carries an
   * explicit disposition (wizard step 4). That is deliberate — it is what stops the wizard
   * accepting input the backend ignores — but it means a bare `start` no longer succeeds.
   *
   * These suites are not testing the Documents step, so rather than hand-maintaining a
   * selection list per package, this resolves the real requirements from intake-preview and
   * asks the worker for anything not already satisfied. A caller that IS testing dispositions
   * passes its own `documentSelections` and this leaves them untouched.
   */
  async function defaultDocumentSelections(token, args) {
    if (args.documentSelections !== undefined) return args.documentSelections;
    if (!args.employeeId || !args.packageKey) return undefined;
    const preview = await rawApi('hr/onboarding/intake-preview', token, {
      employeeId: args.employeeId, packageKey: args.packageKey,
      targetStartDate: args.targetStartDate ?? '2027-01-01',
    });
    const items = preview.body?.data?.documents?.items ?? [];
    return items
      .filter(item => !(item.state === 'present_verified'))
      .map(item => ({ requirementId: item.requirementId, action: 'request_from_worker' }));
  }

  const api = async (path, token, args = {}) => {
    if (path !== 'hr/onboarding/start') return rawApi(path, token, args);
    const documentSelections = await defaultDocumentSelections(token, args);
    return rawApi(path, token, {
      requestId: crypto.randomUUID(), targetStartDate: '2027-01-01',
      ...(documentSelections === undefined ? {} : { documentSelections }),
      ...args,
    });
  };
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { caseId: null, cancelCaseId: null, mCaseId: null, cCaseId: null, packageId: null, packageKey: null, packageTaskId: null, packageHandoffId: null, templateId: null, tplName: `${TAG}-ca-tpl`, empId: null, contractorEmpId: null, empTok: null, mgrTok: null, taskIds: [], mTaskIds: [] };

  // Poll a predicate until true (or timeout) — for fire-and-forget app_event asserts
  // that can lose a race under full-suite load. Returns true on success, false on timeout.
  const waitFor = async (check, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 250)); }
    return false;
  };

  // Remove this run's custom-action template AND any abandoned one left by an earlier run.
  // "Abandoned" = E2E-named and older than ABANDONED_MS, so a suite running concurrently in
  // another process can never have its live fixture deleted out from under it.
  const ABANDONED_MS = 6 * 60 * 60 * 1000;
  const sweepLeakedActionTemplates = async () => {
    const { data: rows } = await sb.from('hr_onboarding_action_templates')
      .select('id, action_name, created_at').like('action_name', 'TEST-E2E-%-ca-tpl');
    const cutoff = Date.now() - ABANDONED_MS;
    const doomed = (rows ?? []).filter(r =>
      r.action_name === ctx.tplName || new Date(r.created_at).getTime() < cutoff);
    if (!doomed.length) return;
    const ids = doomed.map(r => r.id);
    try { await sb.from('app_events').delete().in('source_entity_id', ids); } catch { /* optional */ }
    try { await sb.from('hr_audit_log').delete().in('record_id', ids); } catch { /* optional */ }
    for (const r of doomed) {
      try { await sb.from('app_events').delete().eq('event_type', 'onboarding.custom_action_template.created').eq('payload->>actionName', r.action_name); } catch { /* optional */ }
    }
    try { await sb.from('hr_onboarding_action_templates').delete().in('id', ids); } catch { /* FK-held → reported by the next run */ }
  };

  h.onCleanup(async () => {
    const caseIds = [ctx.caseId, ctx.cancelCaseId, ctx.mCaseId, ctx.cCaseId, ctx.hoCaseId, ctx.ownerCaseId, ctx.probationCaseId, ctx.contractorProbCaseId].filter(Boolean);
    for (const id of caseIds) {
      await sb.from('app_events').delete().eq('source_entity_id', id);
      await sb.from('hr_audit_log').delete().eq('record_id', id);
    }
    if (caseIds.length) await sb.from('hr_onboarding_cases').delete().in('id', caseIds);   // cascades tasks + handoffs + case_actions + communications
    if (ctx.exportAuditId) await sb.from('hr_audit_log').delete().eq('id', ctx.exportAuditId);   // report export has no record_id → delete by id
    // Custom-action template lives on a seeded package → remove it + its events/audit.
    // Swept by NAME, not just by ctx.templateId: an id-only sweep leaks the row whenever a
    // run aborts between create and cleanup, and a leaked ACTIVE template on a shared
    // package is then auto-included in every later launch of that package — which is
    // exactly how three orphans once broke the office_admin start path.
    await sweepLeakedActionTemplates();
    if (ctx.packageId) {
      await sb.from('app_events').delete().eq('source_entity_id', ctx.packageId);
      await sb.from('hr_audit_log').delete().eq('record_id', ctx.packageId);
      await sb.from('hr_onboarding_packages').delete().eq('id', ctx.packageId);
    }
    for (const id of (ctx.createdEmpIds ?? []).filter(Boolean)) {
      // (employeeId, packageKey)-keyed artifacts this run created for the TAGGED test
      // employees: the mutation-run idempotency ledger + the derived onboarding.started
      // event dedupe_key (text keys, not FKs, so they don't cascade with the employee).
      try { await sb.from('module_mutation_runs').delete().ilike('idempotency_key', `hr.onboarding.start:${id}%`); } catch { /* optional */ }
      try { await sb.from('app_events').delete().ilike('dedupe_key', `hr.onboarding.start:${id}%`); } catch { /* optional */ }
    }
    if (ctx.createdEmpIds?.length) { try { await sb.from('app_users').delete().in('id', ctx.createdEmpIds); } catch { /* FK-blocked → leaked test user, non-fatal */ } }
    // Remove the global setting overrides this suite set (revert to catalog defaults).
    for (const k of (ctx.settingKeys ?? [])) {
      try { await sb.from('app_setting_values').delete().eq('setting_key', k).eq('scope_type', 'global').is('scope_id', null); } catch { /* optional */ }
    }
  });

  // Test-owned identities. The two onboarding TARGETS are CREATED + tagged — never a
  // borrowed real employee (review finding #3): this suite cancels cases, clears onboarding
  // idempotency/event history and reruns starts, all of which must touch test-owned rows
  // only. The manager is borrowed for a read-only auth TOKEN (no data mutation on it); the
  // created employees point their supervisor at that manager so supervisor tasks resolve an
  // assignee. Unique per-run ids also make the (employee,packageKey) idempotency key unique,
  // so concurrent/repeat runs can never dedupe each other's start case or event. The second
  // employee lets the probation-wiring cases stay active without hitting the "one active
  // case per employee" gate.
  {
    const { data: mgr } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'manager').eq('status', 'active').neq('id', admin.id).limit(1).maybeSingle();
    if (mgr) ctx.mgrTok = mint(mgr);
    const mk = (suffix) => ({ id: `ONB-${suffix}-${TAG}`, username: `${TAG}_onb_${suffix.toLowerCase()}`, full_name: `Onboarding E2E ${suffix}`, role: 'employee', status: 'active', employment_type: 'employee', supervisor_id: mgr?.id ?? null });
    const empRow = { ...mk('EMPA'), contractor_flag: false };
    const emp2Row = { ...mk('EMPB'), contractor_flag: false };
    const contractorRow = { ...mk('CONTRACTOR'), contractor_flag: true };
    const { error: empErr } = await sb.from('app_users').insert([empRow, emp2Row, contractorRow]);
    if (empErr) throw new Error(`onboarding: failed to seed tagged test employees: ${empErr.message}`);
    ctx.empId = empRow.id; ctx.empTok = mint({ id: empRow.id, username: empRow.username, role: 'employee', department_id: null });
    ctx.empId2 = emp2Row.id;
    ctx.contractorEmpId = contractorRow.id;
    ctx.createdEmpIds = [empRow.id, emp2Row.id, contractorRow.id];
  }

  // Cancel every currently-active onboarding case for an employee — used between `start`
  // calls that reuse the same employee, so the new "one active case per employee" backend
  // gate (validateOnboardingLaunchGates) doesn't reject the next test's start.
  const closeActiveCasesFor = async (employeeId) => {
    if (!employeeId) return;
    const { data: active } = await sb.from('hr_onboarding_cases').select('id')
      .eq('employee_id', employeeId)
      .in('status', ['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation']);
    for (const row of active ?? []) {
      await api('hr/onboarding/cancel', A, { caseId: row.id, reason: 'e2e: close before next case for the same employee' });
    }
  };

  // ── Phase 7 settings: publish the onboarding catalog, then pin the gates +
  // require-owner OFF globally so the lifecycle tests below are deterministic
  // regardless of the catalog defaults (which are ON). 7b flips them on/off to prove
  // the wiring; cleanup deletes these overrides. ───────────────────────────────────
  ctx.settingKeys = [
    'hr_onboarding.block_activation_until_documents_complete',
    'hr_onboarding.block_activation_until_training_complete',
    'hr_onboarding.block_activation_until_hse_complete',
    'hr_onboarding.block_activation_until_payroll_complete',
    'hr_onboarding.require_owner_on_start',
    'hr_onboarding.work_email_domain',
  ];
  // Self-heal before anything launches: an abandoned ACTIVE custom-action template from a
  // killed earlier run is auto-included in every launch of the package it sits on, and its
  // unresolved owner then fails the start with "Choose an owning team or accountable person".
  await test('sweep abandoned custom-action templates from earlier runs (setup)', async () => {
    await sweepLeakedActionTemplates();
    const { data: left } = await sb.from('hr_onboarding_action_templates')
      .select('id, action_name, created_at, is_active').like('action_name', 'TEST-E2E-%-ca-tpl').eq('is_active', true);
    const stale = (left ?? []).filter(r => Date.now() - new Date(r.created_at).getTime() > ABANDONED_MS);
    expect(stale.length === 0, `abandoned active E2E templates still present: ${stale.map(r => r.action_name).join(', ')}`);
  });

  await test('settings: catalog sync + pin gates/owner off (setup)', async () => {
    ok(await api('settings/catalog/sync', A, {}), 'catalog sync');
    for (const k of ctx.settingKeys) {
      if (k === 'hr_onboarding.work_email_domain') continue;
      ok(await api('settings/values/set', A, { settingKey: k, scopeType: 'global', scopeId: null, value: false }), `pin ${k}=false`);
    }
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.work_email_domain', scopeType: 'global', scopeId: null, value: 'e2e.invalid' }), 'pin work email domain');
  });

  // (No defensive "clear leftover state" step is needed: the onboarding target employees
  // are CREATED fresh + tagged per run, so there is never pre-existing case / idempotency /
  // event state to collide with — the root cause the old defensive step worked around.)

  // ── preview ───────────────────────────────────────────────────────────────────
  await test('preview-package (admin) → tasks + handoffs', async () => {
    const r = await api('hr/onboarding/preview-package', A, { packageKey: 'contractor_worker' });
    ok(r, 'preview');
    expect(Array.isArray(r.body.data.tasks) && r.body.data.tasks.length > 0, 'tasks listed');
    expect(Array.isArray(r.body.data.handoffs), 'handoffs listed');
  });

  await test('preview-package invalid key → fails', async () => {
    const r = await api('hr/onboarding/preview-package', A, { packageKey: 'not_a_package' });
    fails(r, 'invalid package rejected');
  });

  // ── start ─────────────────────────────────────────────────────────────────────
  await test('start (admin) → creates case + tasks + handoff intents', async () => {
    // contractor_worker is a contractor-only package → the case type must be 'contractor'
    // (enforced by validateWorkerTypeAndPackage), and contractor required fields must be supplied.
    ctx.launchRequestId = crypto.randomUUID();
    const r = await api('hr/onboarding/start', A, {
      requestId: ctx.launchRequestId,
      employeeId: ctx.contractorEmpId, packageKey: 'contractor_worker', targetStartDate: '2027-01-01',
    });
    ok(r, 'start');
    expect(!!r.body.data.caseId, 'caseId returned');
    expect(/^ONB-/.test(r.body.data.caseNo), `caseNo format — got ${r.body.data.caseNo}`);
    expect(r.body.data.taskCount > 0, 'tasks created');
    ctx.caseId = r.body.data.caseId;
    // onboarding.started is emitted through runModuleMutation (written just after the HTTP
    // response resolves), so poll rather than querying once — matches the suite's other
    // event assertions and removes a load-sensitive race.
    const gotStartedEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.started').eq('source_entity_id', ctx.caseId).limit(1);
      return (data ?? []).length === 1;
    });
    expect(gotStartedEvent, 'onboarding.started event');
    const { data: hos } = await sb.from('hr_onboarding_handoffs').select('status').eq('case_id', ctx.caseId);
    expect((hos ?? []).length >= 1 && hos.every(x => x.status === 'pending'), 'handoff intents pending');
  });

  await test('start retry with the same request id returns the same frozen case', async () => {
    const replay = await api('hr/onboarding/start', A, {
      requestId: ctx.launchRequestId,
      employeeId: ctx.contractorEmpId,
      packageKey: 'contractor_worker',
      targetStartDate: '2027-01-01',
    });
    ok(replay, 'idempotent replay');
    expect(replay.body.data.caseId === ctx.caseId, 'same case returned');
    const { count } = await sb.from('hr_onboarding_cases').select('id', { count: 'exact', head: true })
      .eq('launch_request_id', ctx.launchRequestId);
    expect(count === 1, `one case for request id, got ${count}`);
  });

  await test('start unauthorized (employee) → denied', async () => {
    const r = await api('hr/onboarding/start', ctx.empTok, { employeeId: ctx.empId, packageKey: 'office_admin' });
    fails(r, 'employee cannot start');
  });

  await test('start unauthorized (manager) → denied', async () => {
    const r = await api('hr/onboarding/start', ctx.mgrTok, { employeeId: ctx.empId, packageKey: 'office_admin' });
    fails(r, 'manager cannot start');
  });

  // ── worker-type ⇄ package eligibility + case-type required fields (backend gate) ──
  await test('contractor worker type and package snapshot are server-derived', async () => {
    // The contractor start above (ctx.caseId) must have persisted its intake fields.
    const { data: kase } = await sb.from('hr_onboarding_cases')
      .select('metadata, worker_type, package_id, package_version_no, launch_snapshot')
      .eq('id', ctx.caseId).maybeSingle();
    expect(kase?.worker_type === 'contractor', `worker_type = ${kase?.worker_type}`);
    expect(!kase?.metadata?.workerTypeDetails, 'no shadow contractor intake copied into case metadata');
    expect(!!kase?.package_id && Number.isInteger(kase?.package_version_no), 'package id and version frozen');
    expect(kase?.launch_snapshot?.package?.id === kase?.package_id, 'snapshot carries package identity');
  });

  await test('employee case with a contractor-only package → rejected (eligibility gate)', async () => {
    const r = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'contractor_worker', targetStartDate: '2027-01-01' });
    fails(r, 'employee cannot use a contractor-only package');
  });

  await test('contractor case with an employee-only package → rejected (eligibility gate)', async () => {
    const r = await api('hr/onboarding/start', A, {
      employeeId: ctx.contractorEmpId, packageKey: 'standard_employee', targetStartDate: '2027-01-01',
    });
    fails(r, 'contractor cannot use an employee-only package');
  });

  // ── get ───────────────────────────────────────────────────────────────────────
  await test('get (admin) → case + tasks + handoffs', async () => {
    const r = await api('hr/onboarding/get', A, { caseId: ctx.caseId });
    ok(r, 'get');
    expect(r.body.data.case && r.body.data.case.status === 'in_progress', 'case in_progress');
    ctx.taskIds = (r.body.data.tasks ?? []).map(t => t.id);
    expect(ctx.taskIds.length > 0, 'tasks returned');
  });

  // ── reassign + assigned-user completes own task ────────────────────────────────
  await test('task/reassign (admin) → assign first task to the employee', async () => {
    const r = await api('hr/onboarding/task/reassign', A, { taskId: ctx.taskIds[0], assignedTo: ctx.empId });
    ok(r, 'reassign');
    // The event is emitted fire-and-forget (void emitAppEvent) — poll rather than read
    // once, so a slow async insert under full-suite load isn't a false failure.
    const seen = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.task.assigned').eq('source_entity_id', ctx.caseId).limit(1);
      return !!(data && data.length);
    });
    expect(seen, 'task.assigned event');
  });

  await test('task/complete (assigned employee completes own task)', async () => {
    const r = await api('hr/onboarding/task/complete', ctx.empTok, { taskId: ctx.taskIds[0] });
    ok(r, 'employee completes own task');
    expect(r.body.data.status === 'completed', 'task completed');
  });

  await test('task/complete unauthorized (employee, not assigned) → denied', async () => {
    // taskIds[1] is not assigned to the employee → denied (no manage permission).
    const r = await api('hr/onboarding/task/complete', ctx.empTok, { taskId: ctx.taskIds[1] });
    fails(r, 'employee cannot complete unassigned task');
  });

  await test('task/complete remaining (admin) → auto-completes the case', async () => {
    let lastCaseCompleted = false;
    for (let i = 1; i < ctx.taskIds.length; i++) {
      const r = await api('hr/onboarding/task/complete', A, { taskId: ctx.taskIds[i] });
      ok(r, `complete task ${i}`);
      lastCaseCompleted = r.body.data.caseCompleted;
    }
    expect(lastCaseCompleted === true, 'case auto-completed on last task');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status, completed_at').eq('id', ctx.caseId).maybeSingle();
    expect(kase && kase.status === 'completed' && !!kase.completed_at, 'case status completed');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.completed').eq('source_entity_id', ctx.caseId).limit(1);
    expect(ev && ev.length === 1, 'onboarding.completed event');
  });

  // ── cancel ──────────────────────────────────────────────────────────────────
  await test('cancel (admin) → case cancelled + handoffs cancelled', async () => {
    const start = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'office_admin' });
    ok(start, 'start case to cancel');
    ctx.cancelCaseId = start.body.data.caseId;
    // Reason is now mandatory — cancel with no reason is refused (validation fails before any state change)
    const noReason = await api('hr/onboarding/cancel', A, { caseId: ctx.cancelCaseId });
    expect(!noReason.ok || !noReason.body?.success, 'cancel with no reason should be refused');
    const r = await api('hr/onboarding/cancel', A, { caseId: ctx.cancelCaseId, reason: 'e2e cancel' });
    ok(r, 'cancel');
    expect(r.body.data.status === 'cancelled', 'cancelled');
    const { data: hos } = await sb.from('hr_onboarding_handoffs').select('status').eq('case_id', ctx.cancelCaseId);
    expect((hos ?? []).every(x => x.status === 'cancelled'), 'handoffs cancelled');
  });

  await test('cancel unauthorized (employee) → denied', async () => {
    const r = await api('hr/onboarding/cancel', ctx.empTok, { caseId: ctx.cancelCaseId });
    fails(r, 'employee cannot cancel');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 4 — packages/list (DB-driven picker)
  // ════════════════════════════════════════════════════════════════════════════
  await test('packages/list → seeded packages with derived owners', async () => {
    const r = await api('hr/onboarding/packages/list', A, {});
    ok(r, 'packages/list');
    const keys = (r.body.data ?? []).map(p => p.key);
    expect(keys.includes('standard_employee') && keys.includes('contractor_worker'), 'seeded packages present');
    const std = r.body.data.find(p => p.key === 'standard_employee');
    expect(std && std.taskCount > 0 && typeof std.owners === 'string', 'package summary has taskCount + owners');
  });

  await test('packages/reference-data returns governed selector catalogues', async () => {
    const r = await api('hr/onboarding/packages/reference-data', A, {});
    ok(r, 'reference data');
    expect(Array.isArray(r.body.data.documentRequirements), 'document requirements array');
    expect(Array.isArray(r.body.data.trainingRequirements), 'training requirements array');
    expect(Array.isArray(r.body.data.workflowTemplates), 'workflow templates array');
    fails(await api('hr/onboarding/packages/reference-data', ctx.empTok, {}), 'employee cannot read package-authoring catalogues');
  });

  await test('package draft setup creates the governed template test fixture', async () => {
    const created = await api('hr/onboarding/packages/create', A, {
      label: `${TAG} Package`, description: 'E2E-owned package definition', workerTypes: ['employee'], defaultSlaDays: 10, defaultOwnerRole: 'hr',
    });
    ok(created, 'package create');
    ctx.packageId = created.body.data.id;
    ctx.packageKey = created.body.data.key;
    const task = await api('hr/onboarding/packages/task-templates/create', A, {
      packageId: ctx.packageId, taskKey: `${TAG}_task`, taskTitle: 'E2E package task', ownerRole: 'hr', sortOrder: 10,
    });
    ok(task, 'task template create'); ctx.packageTaskId = task.body.data.id;
    const handoff = await api('hr/onboarding/packages/handoff-templates/create', A, {
      packageId: ctx.packageId, handoffKey: `${TAG}_handoff`, targetModule: 'hr', handoffType: 'e2e_review', sortOrder: 10,
    });
    ok(handoff, 'handoff template create'); ctx.packageHandoffId = handoff.body.data.id;
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 3 — management case lifecycle (dedicated case M, package supervisor_manager)
  // ════════════════════════════════════════════════════════════════════════════
  await test('start case M (admin) → for management-write tests', async () => {
    const r = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'supervisor_manager' });
    ok(r, 'start M');
    ctx.mCaseId = r.body.data.caseId;
    const g = await api('hr/onboarding/get', A, { caseId: ctx.mCaseId });
    ctx.mTaskIds = (g.body.data.tasks ?? []).map(t => t.id);
    expect(ctx.mTaskIds.length >= 3, 'case M has tasks');
  });

  await test('reassign-owner (admin) → owner changed + event', async () => {
    const r = await api('hr/onboarding/reassign-owner', A, { caseId: ctx.mCaseId, ownerId: ctx.empId });
    ok(r, 'reassign-owner');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.case.owner_changed').eq('source_entity_id', ctx.mCaseId).limit(1);
    expect(ev && ev.length >= 1, 'owner_changed event');
  });

  await test('pause → resume (admin)', async () => {
    const p = await api('hr/onboarding/pause', A, { caseId: ctx.mCaseId, reason: 'e2e pause' });
    ok(p, 'pause'); expect(p.body.data.status === 'paused', 'paused');
    const r = await api('hr/onboarding/resume', A, { caseId: ctx.mCaseId });
    ok(r, 'resume'); expect(r.body.data.status === 'in_progress', 'resumed to in_progress');
  });

  await test('task/block → blocker row created + case blocked', async () => {
    const r = await api('hr/onboarding/task/block', A, { taskId: ctx.mTaskIds[0], reason: 'e2e block', severity: 'high' });
    ok(r, 'block');
    const { data: tk } = await sb.from('hr_onboarding_tasks').select('status').eq('id', ctx.mTaskIds[0]).maybeSingle();
    expect(tk && tk.status === 'blocked', 'task blocked');
    const { data: bl } = await sb.from('hr_onboarding_blockers').select('id, status').eq('task_id', ctx.mTaskIds[0]).eq('status', 'active');
    expect((bl ?? []).length === 1, 'one active blocker for task');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', ctx.mCaseId).maybeSingle();
    expect(kase && kase.status === 'blocked', 'case recomputed to blocked');
  });

  await test('blockers/list → surfaces the blocker', async () => {
    const r = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    ok(r, 'blockers/list');
    expect(r.body.data.some(b => b.taskId === ctx.mTaskIds[0] && b.status === 'active'), 'blocker listed');
  });

  await test('task/unblock → task pending + blocker resolved + case in_progress', async () => {
    const r = await api('hr/onboarding/task/unblock', A, { taskId: ctx.mTaskIds[0] });
    ok(r, 'unblock');
    const { data: bl } = await sb.from('hr_onboarding_blockers').select('status').eq('task_id', ctx.mTaskIds[0]);
    expect((bl ?? []).every(b => b.status === 'resolved'), 'blocker resolved');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', ctx.mCaseId).maybeSingle();
    expect(kase && kase.status === 'in_progress', 'case back to in_progress');
  });

  await test('blocker escalate → waive (admin) unblocks linked task', async () => {
    await api('hr/onboarding/task/block', A, { taskId: ctx.mTaskIds[1], reason: 'e2e block 2' });
    const list = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    const b = list.body.data.find(x => x.taskId === ctx.mTaskIds[1] && x.status === 'active');
    expect(!!b, 'active blocker found');
    const esc = await api('hr/onboarding/blocker/escalate', A, { blockerId: b.blockerId, note: 'e2e escalate' });
    ok(esc, 'escalate'); expect(esc.body.data.status === 'escalated', 'escalated');
    const wv = await api('hr/onboarding/blocker/waive', A, { blockerId: b.blockerId, reason: 'e2e waiver' });
    ok(wv, 'waive'); expect(wv.body.data.status === 'waived', 'waived');
    const { data: tk } = await sb.from('hr_onboarding_tasks').select('status').eq('id', ctx.mTaskIds[1]).maybeSingle();
    expect(tk && tk.status === 'pending', 'waived blocker unblocked the task');
  });

  await test('blocker/waive without reason → fails', async () => {
    await api('hr/onboarding/task/block', A, { taskId: ctx.mTaskIds[2], reason: 'e2e block 3' });
    const list = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    const b = list.body.data.find(x => x.taskId === ctx.mTaskIds[2] && x.status === 'active');
    const r = await api('hr/onboarding/blocker/waive', A, { blockerId: b.blockerId, reason: '' });
    fails(r, 'waiver requires a reason');
    await api('hr/onboarding/blocker/resolve', A, { blockerId: b.blockerId, note: 'cleanup' });   // clear for ready test
  });

  await test('blocker/notify-owner → notification to owner + audit; ownerless → fails', async () => {
    // Fresh blocking task → blocker (owner defaults to the task's assignee, which is null
    // for supervisor-owned tasks unless assigned). Assign it, block it, then notify.
    const add = await api('hr/onboarding/task/add', A, { caseId: ctx.mCaseId, taskTitle: `${TAG} notify-src`, ownerRole: 'hr', assignedTo: ctx.empId, isBlocking: true });
    ok(add, 'add task'); const notifyTaskId = add.body.data.taskId;
    ok(await api('hr/onboarding/task/block', A, { taskId: notifyTaskId, reason: 'e2e notify' }), 'block it');
    const list = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    const owned = list.body.data.find(b => b.taskId === notifyTaskId && b.status === 'active');
    expect(!!owned && owned.ownerId, 'blocker has an owner (the assignee)');
    const r = await api('hr/onboarding/blocker/notify-owner', A, { blockerId: owned.blockerId, message: 'Please action this' });
    ok(r, 'notify-owner'); expect(r.body.data.notifiedOwnerId === owned.ownerId, 'notified the owner');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.blocker.owner_notified').eq('source_entity_id', ctx.mCaseId).limit(1);
    expect(ev && ev.length >= 1, 'owner_notified event');
    // Ownerless blocker (unassigned task) → notify fails with a clear message.
    const add2 = await api('hr/onboarding/task/add', A, { caseId: ctx.mCaseId, taskTitle: `${TAG} notify-noowner`, ownerRole: 'supervisor', isBlocking: true });
    await api('hr/onboarding/task/block', A, { taskId: add2.body.data.taskId, reason: 'e2e' });
    const list2 = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    const ownerless = list2.body.data.find(b => b.taskId === add2.body.data.taskId && b.status === 'active');
    if (ownerless && !ownerless.ownerId) fails(await api('hr/onboarding/blocker/notify-owner', A, { blockerId: ownerless.blockerId }), 'ownerless blocker cannot notify');
    // Clear both so the case can reach ready later.
    await api('hr/onboarding/task/unblock', A, { taskId: notifyTaskId });
    await api('hr/onboarding/task/complete', A, { taskId: notifyTaskId });
    await api('hr/onboarding/task/unblock', A, { taskId: add2.body.data.taskId });
    await api('hr/onboarding/task/complete', A, { taskId: add2.body.data.taskId });
  });

  await test('blocker/notify-owner unauthorized (employee) → denied', async () => {
    const add = await api('hr/onboarding/task/add', A, { caseId: ctx.mCaseId, taskTitle: `${TAG} notify-authz`, ownerRole: 'hr', assignedTo: ctx.empId, isBlocking: true });
    await api('hr/onboarding/task/block', A, { taskId: add.body.data.taskId, reason: 'e2e' });
    const list = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    const b = list.body.data.find(x => x.taskId === add.body.data.taskId && x.status === 'active');
    fails(await api('hr/onboarding/blocker/notify-owner', ctx.empTok, { blockerId: b.blockerId }), 'employee cannot notify');
    await api('hr/onboarding/task/unblock', A, { taskId: add.body.data.taskId });
    await api('hr/onboarding/task/complete', A, { taskId: add.body.data.taskId });
  });

  await test('task/add (admin) → blocking task + case re-blocked', async () => {
    const r = await api('hr/onboarding/task/add', A, { caseId: ctx.mCaseId, taskTitle: `${TAG} extra gate`, ownerRole: 'hr', isBlocking: true });
    ok(r, 'task/add'); ctx.addedTaskId = r.body.data.taskId;
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.task.added').eq('source_entity_id', ctx.mCaseId).limit(1);
    expect(ev && ev.length >= 1, 'task.added event');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', ctx.mCaseId).maybeSingle();
    expect(kase && kase.status === 'blocked', 'open blocking task → case blocked');
  });

  await test('ready while a blocking task is open → fails', async () => {
    const r = await api('hr/onboarding/ready', A, { caseId: ctx.mCaseId });
    fails(r, 'cannot mark ready with blocking work open');
  });

  await test('ready after clearing blocking work → ready_for_activation', async () => {
    await api('hr/onboarding/task/complete', A, { taskId: ctx.addedTaskId });   // clear the blocking task
    const r = await api('hr/onboarding/ready', A, { caseId: ctx.mCaseId });
    ok(r, 'ready'); expect(r.body.data.status === 'ready_for_activation', 'ready_for_activation');
  });

  await test('complete case while open tasks remain → fails', async () => {
    const r = await api('hr/onboarding/complete', A, { caseId: ctx.mCaseId });
    fails(r, 'complete blocked by open tasks');
  });

  await test('audit (admin) → case audit trail populated', async () => {
    const r = await api('hr/onboarding/audit', A, { caseId: ctx.mCaseId });
    ok(r, 'audit');
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'audit rows');
    expect(r.body.data.every(a => !!a.action && !!a.createdAt), 'audit shape');
  });

  // access control — management writes
  await test('task/block unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/task/block', ctx.empTok, { taskId: ctx.mTaskIds[0] }), 'employee cannot block');
  });
  await test('pause unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/pause', ctx.empTok, { caseId: ctx.mCaseId }), 'employee cannot pause');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 2 — management reads
  // ════════════════════════════════════════════════════════════════════════════
  await test('dashboard-stats (admin) → KPI shape', async () => {
    const r = await api('hr/onboarding/dashboard-stats', A, {});
    ok(r, 'dashboard-stats');
    const d = r.body.data;
    expect(d.activeCases && typeof d.activeCases.total === 'number', 'activeCases.total');
    expect(d.blockingTasks && d.dueThisWeek && d.activationReadiness, 'all KPI groups present');

    // Activation Readiness Summary — the three-way split the Overview renders.
    const ar = d.activationReadiness;
    for (const k of ['readyCases', 'inProgressCases', 'notStartedCases']) {
      expect(typeof ar[k] === 'number' && ar[k] >= 0, `activationReadiness.${k} is a non-negative number`);
    }
    // The buckets are defined to be mutually exclusive and exhaustive over the
    // ACTIVE case set, so they must reconcile exactly. A drift here means a case
    // was double-counted or silently dropped from the summary.
    expect(ar.readyCases + ar.inProgressCases + ar.notStartedCases === d.activeCases.total,
      `readiness buckets reconcile with activeCases.total — ${ar.readyCases}+${ar.inProgressCases}+${ar.notStartedCases} vs ${d.activeCases.total}`);
    // readyPercent is derived from the same ready set, so it must agree with the count.
    const expectedPct = d.activeCases.total ? Math.round((ar.readyCases / d.activeCases.total) * 100) : 0;
    expect(ar.readyPercent === expectedPct,
      `readyPercent agrees with readyCases — got ${ar.readyPercent}, expected ${expectedPct}`);
  });

  await test('list (admin) → case M present with computed fields', async () => {
    const r = await api('hr/onboarding/list', A, { statuses: ['ready_for_activation', 'in_progress', 'blocked'] });
    ok(r, 'list');
    const row = (r.body.data.rows ?? []).find(x => x.caseId === ctx.mCaseId);
    expect(!!row, 'case M in list');
    expect(typeof row.progressPercent === 'number' && typeof row.openTasks === 'number', 'computed fields');
  });

  await test('tasks/list (caseId M) → tasks for the case', async () => {
    const r = await api('hr/onboarding/tasks/list', A, { caseId: ctx.mCaseId });
    ok(r, 'tasks/list');
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'tasks returned');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Tasks Workspace — task/get + notes + evidence (+ the settings evidence gate)
  // ════════════════════════════════════════════════════════════════════════════
  await test('tasks/list packageKeys filter → only that package\'s tasks', async () => {
    const r = await api('hr/onboarding/tasks/list', A, { packageKeys: ['supervisor_manager'] });
    ok(r, 'tasks/list packageKeys');
    expect(r.body.data.length > 0 && r.body.data.every(t => t.packageKey === 'supervisor_manager'), 'rows scoped to package');
  });

  await test('task/add-note (admin) + task/get returns it with actor name', async () => {
    const r = await api('hr/onboarding/task/add-note', A, { taskId: ctx.mTaskIds[0], note: `${TAG} first note` });
    ok(r, 'add-note');
    expect(!!r.body.data.noteId, 'noteId returned');
    const g = await api('hr/onboarding/task/get', A, { taskId: ctx.mTaskIds[0] });
    ok(g, 'task/get');
    expect(Array.isArray(g.body.data.notes) && g.body.data.notes.some(n => n.note === `${TAG} first note`), 'note in detail');
    expect(Array.isArray(g.body.data.evidence), 'evidence array present');
    expect(g.body.data.caseNo && typeof g.body.data.completedAt !== 'undefined', 'detail shape (caseNo + completedAt)');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.task.note_added').eq('source_entity_id', ctx.mCaseId).limit(1);
    expect(ev && ev.length >= 1, 'note_added event');
  });

  await test('task/add-note by ASSIGNED employee → allowed; unassigned → denied', async () => {
    ok(await api('hr/onboarding/task/reassign', A, { taskId: ctx.mTaskIds[0], assignedTo: ctx.empId }), 'assign to employee');
    ok(await api('hr/onboarding/task/add-note', ctx.empTok, { taskId: ctx.mTaskIds[0], note: `${TAG} own-task note` }), 'assignee can note own task');
    fails(await api('hr/onboarding/task/add-note', ctx.empTok, { taskId: ctx.mTaskIds[1], note: 'x' }), 'unassigned employee denied');
  });

  await test('task/attach-evidence records the file reference + audit', async () => {
    const r = await api('hr/onboarding/task/attach-evidence', A, {
      taskId: ctx.mTaskIds[0], fileName: `${TAG}.pdf`, filePath: `onboarding-evidence/${TAG}.pdf`, mimeType: 'application/pdf', fileSize: 1234,
    });
    ok(r, 'attach-evidence');
    const g = await api('hr/onboarding/task/get', A, { taskId: ctx.mTaskIds[0] });
    expect(g.body.data.evidence.some(e => e.fileName === `${TAG}.pdf`), 'evidence in detail');
    const { data: au } = await sb.from('hr_audit_log').select('id').eq('record_id', ctx.mCaseId).eq('action', 'hr.onboarding.task_evidence_attached').limit(1);
    expect(au && au.length >= 1, 'evidence audit row');
  });

  await test('evidence gate: requires_evidence task cannot complete until evidence is approved — 7b', async () => {
    const gateKey = 'hr_onboarding.task_completion_requires_evidence';
    ctx.settingKeys.push(gateKey);
    const add = await api('hr/onboarding/task/add', A, { caseId: ctx.mCaseId, taskTitle: `${TAG} evidence-gated`, requiresEvidence: true });
    ok(add, 'add gated task'); const gatedId = add.body.data.taskId;
    ok(await api('settings/values/set', A, { settingKey: gateKey, scopeType: 'global', scopeId: null, value: true }), 'gate on');
    fails(await api('hr/onboarding/task/complete', A, { taskId: gatedId }), 'complete blocked without evidence');
    const attached = await api('hr/onboarding/task/attach-evidence', A, { taskId: gatedId, fileName: `${TAG}-gate.pdf`, filePath: `onboarding-evidence/${TAG}-gate.pdf` });
    ok(attached, 'attach evidence');
    fails(await api('hr/onboarding/task/complete', A, { taskId: gatedId }), 'pending evidence does not satisfy the gate');
    ok(await api('hr/onboarding/task/review-evidence', A, { evidenceId: attached.body.data.evidenceId, decision: 'approved' }), 'approve evidence');
    ok(await api('hr/onboarding/task/complete', A, { taskId: gatedId }), 'complete allowed with approved evidence');
    ok(await api('settings/values/set', A, { settingKey: gateKey, scopeType: 'global', scopeId: null, value: false }), 'gate off');
  });

  await test('timeline reuse (orchestration) gated to hr.onboarding.view', async () => {
    const r = await api('orchestration/timeline/get', A, { module: 'hr', recordType: 'onboarding_case', recordId: ctx.mCaseId });
    ok(r, 'timeline');
    expect(Array.isArray(r.body.data), 'timeline items array');
    const denied = await api('orchestration/timeline/get', ctx.empTok, { module: 'hr', recordType: 'onboarding_case', recordId: ctx.mCaseId });
    fails(denied, 'employee cannot view onboarding timeline');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 5 — Custom Onboarding Actions (dedicated case C, package standard_employee)
  // ════════════════════════════════════════════════════════════════════════════
  await test('start case C (admin) → for custom-action tests', async () => {
    // Case M is still active on ctx.empId (deliberately never completed, to exercise the
    // "complete blocked by open tasks" gate above) — close it first so the new one-active-
    // case-per-employee gate doesn't reject this start.
    await closeActiveCasesFor(ctx.empId);
    const r = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'standard_employee' });
    ok(r, 'start C'); ctx.cCaseId = r.body.data.caseId;
  });

  await test('actions/templates/create (admin) → package custom-action template', async () => {
    const r = await api('hr/onboarding/actions/templates/create', A, { packageKey: ctx.packageKey, actionName: ctx.tplName, actionType: 'custom_task', instructions: 'tagged e2e template' });
    ok(r, 'template create'); ctx.templateId = r.body.data.templateId;
    const list = await api('hr/onboarding/actions/templates/list', A, { packageKey: ctx.packageKey });
    expect(list.body.data.some(t => t.id === ctx.templateId), 'template listed');
  });

  await test('actions/case/add from template → instantiates a real task', async () => {
    const r = await api('hr/onboarding/actions/case/add', A, { caseId: ctx.cCaseId, sourceTemplateId: ctx.templateId });
    ok(r, 'case add from template');
    expect(!!r.body.data.linkedTaskId, 'task created'); ctx.caTaskActionId = r.body.data.caseActionId; ctx.caTaskId = r.body.data.linkedTaskId;
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.custom_action.instantiated').eq('source_entity_id', ctx.cCaseId).limit(1);
    expect(ev && ev.length >= 1, 'instantiated event');
  });

  await test('actions/case/add one-off document_request → task + pending handoff', async () => {
    const r = await api('hr/onboarding/actions/case/add', A, { caseId: ctx.cCaseId, actionName: `${TAG} doc`, actionType: 'custom_document_request', requiresEvidence: true });
    ok(r, 'doc request'); ctx.caDocActionId = r.body.data.caseActionId; ctx.caDocHandoffId = r.body.data.linkedHandoffId;
    expect(!!r.body.data.linkedTaskId && !!r.body.data.linkedHandoffId, 'task + handoff created');
    const { data: ho } = await sb.from('hr_onboarding_handoffs').select('target_module, status').eq('id', ctx.caDocHandoffId).maybeSingle();
    expect(ho && ho.target_module === 'documents' && ho.status === 'pending', 'pending documents handoff (not faked)');
  });

  await test('actions/case/add custom_approval without workflow template → fails', async () => {
    const r = await api('hr/onboarding/actions/case/add', A, { caseId: ctx.cCaseId, actionName: `${TAG} appr`, actionType: 'custom_approval' });
    fails(r, 'approval needs a workflow template');
  });

  await test('actions/case/list → lists the case actions', async () => {
    const r = await api('hr/onboarding/actions/case/list', A, { caseId: ctx.cCaseId });
    ok(r, 'case action list');
    expect(r.body.data.length >= 2, 'two case actions');
  });

  await test('actions/case/complete → completes action + linked task', async () => {
    const r = await api('hr/onboarding/actions/case/complete', A, { id: ctx.caTaskActionId });
    ok(r, 'complete'); expect(r.body.data.status === 'completed', 'action completed');
    const { data: tk } = await sb.from('hr_onboarding_tasks').select('status').eq('id', ctx.caTaskId).maybeSingle();
    expect(tk && tk.status === 'completed', 'linked task completed');
  });

  await test('actions/case/cancel → cancels action + linked handoff', async () => {
    const r = await api('hr/onboarding/actions/case/cancel', A, { id: ctx.caDocActionId, reason: 'e2e' });
    ok(r, 'cancel'); expect(r.body.data.status === 'cancelled', 'action cancelled');
    const { data: ho } = await sb.from('hr_onboarding_handoffs').select('status').eq('id', ctx.caDocHandoffId).maybeSingle();
    expect(ho && ho.status === 'cancelled', 'linked handoff cancelled');
  });

  await test('handoffs/list (caseId C) → includes the custom handoff + payload/failureReason shape', async () => {
    const r = await api('hr/onboarding/handoffs/list', A, { caseId: ctx.cCaseId });
    ok(r, 'handoffs/list');
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'handoffs returned');
    const row = r.body.data[0];
    expect(typeof row.payload === 'object' && 'failureReason' in row, 'row exposes payload + failureReason');
    // Pick a still-PENDING handoff for the lifecycle chain below (the custom
    // document_request handoff on this case was already cancelled earlier).
    const pending = r.body.data.find(h => h.status === 'pending');
    expect(!!pending, 'a pending handoff exists on case C');
    ctx.handoffId = pending.handoffId;
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 3 — handoff lifecycle control center (FSM: retry / accept / complete / cancel)
  // ════════════════════════════════════════════════════════════════════════════
  await test('handoff/accept (pending → accepted) + event + case audit', async () => {
    const r = await api('hr/onboarding/handoff/accept', A, { handoffId: ctx.handoffId });
    ok(r, 'accept'); expect(r.body.data.status === 'accepted', 'accepted');
    const { data: ho } = await sb.from('hr_onboarding_handoffs').select('status, accepted_at, last_event_at').eq('id', ctx.handoffId).maybeSingle();
    expect(ho && ho.status === 'accepted' && !!ho.accepted_at && !!ho.last_event_at, 'timestamps stamped');
    // Event is emitted fire-and-forget (void emitAppEvent) — poll to avoid a load-timing race.
    const sawEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.handoff.accepted').eq('source_entity_id', ctx.cCaseId).limit(1);
      return !!(data && data.length);
    });
    expect(sawEvent, 'accepted event');
  });

  await test('handoff/complete (accepted → completed)', async () => {
    const r = await api('hr/onboarding/handoff/complete', A, { handoffId: ctx.handoffId });
    ok(r, 'complete'); expect(r.body.data.status === 'completed', 'completed');
    const { data: ho } = await sb.from('hr_onboarding_handoffs').select('status, completed_at').eq('id', ctx.handoffId).maybeSingle();
    expect(ho && ho.status === 'completed' && !!ho.completed_at, 'completed_at stamped');
  });

  await test('handoff illegal transition (completed → accepted) → fails (FSM)', async () => {
    fails(await api('hr/onboarding/handoff/accept', A, { handoffId: ctx.handoffId }), 'terminal handoff cannot transition');
  });

  await test('handoff retry: fail a fresh handoff then retry (failed → pending)', async () => {
    // Create a fresh case with handoffs, drive one to failed via the DB, then retry over HTTP.
    // Uses empId2 (not ctx.empId) — case C is still active on ctx.empId (needed by later
    // tests through the documents-gate test below), and this case must coexist with it.
    const start = await api('hr/onboarding/start', A, { employeeId: ctx.empId2 ?? ctx.empId, packageKey: 'safety_critical_employee' });
    ok(start, 'start case for handoff retry'); ctx.hoCaseId = start.body.data.caseId;
    const { data: hos } = await sb.from('hr_onboarding_handoffs').select('id').eq('case_id', ctx.hoCaseId).limit(1);
    expect(hos && hos.length === 1, 'handoff present'); const hid = hos[0].id;
    await sb.from('hr_onboarding_handoffs').update({ status: 'failed', failure_reason: 'e2e forced' }).eq('id', hid);
    const r = await api('hr/onboarding/handoff/retry', A, { handoffId: hid });
    ok(r, 'retry'); expect(r.body.data.status === 'pending', 're-queued to pending');
    const { data: ho } = await sb.from('hr_onboarding_handoffs').select('status, failure_reason').eq('id', hid).maybeSingle();
    expect(ho && ho.status === 'pending' && ho.failure_reason === null, 'retry clears failure_reason');
  });

  await test('handoff/cancel (pending → cancelled)', async () => {
    const { data: hos } = await sb.from('hr_onboarding_handoffs').select('id').eq('case_id', ctx.hoCaseId).eq('status', 'pending').limit(1);
    const r = await api('hr/onboarding/handoff/cancel', A, { handoffId: hos[0].id, reason: 'e2e cancel' });
    ok(r, 'cancel'); expect(r.body.data.status === 'cancelled', 'cancelled');
  });

  await test('handoff action unauthorized (employee) → denied', async () => {
    const { data: hos } = await sb.from('hr_onboarding_handoffs').select('id').eq('case_id', ctx.hoCaseId).limit(1);
    fails(await api('hr/onboarding/handoff/accept', ctx.empTok, { handoffId: hos[0].id }), 'employee cannot act on handoffs');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 5 — case communications (log + real in-app delivery)
  // ════════════════════════════════════════════════════════════════════════════
  await test('communications/preview (owner_reminder) resolves the case owner', async () => {
    const r = await api('hr/onboarding/communications/preview', A, { caseId: ctx.cCaseId, communicationType: 'owner_reminder' });
    ok(r, 'preview'); expect(!!r.body.data.recipientUserId && !!r.body.data.subject && !!r.body.data.body, 'resolved recipient + rendered subject/body');
  });

  await test('communications/send (employee_welcome, in_app) → row + notification + audit', async () => {
    const r = await api('hr/onboarding/communications/send', A, { caseId: ctx.cCaseId, communicationType: 'employee_welcome' });
    ok(r, 'send'); expect(r.body.data.status === 'sent' && r.body.data.recipientUserId === ctx.empId, 'sent to the employee');
    const list = await api('hr/onboarding/communications/list', A, { caseId: ctx.cCaseId });
    ok(list, 'list'); const row = list.body.data.find(c => c.communicationType === 'employee_welcome');
    expect(!!row && row.status === 'sent' && row.channel === 'in_app', 'logged as sent/in_app');
    ctx.commId = row.id;
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.communication.sent').eq('source_entity_id', ctx.cCaseId).limit(1);
    expect(ev && ev.length >= 1, 'communication.sent event');
    const { data: au } = await sb.from('hr_audit_log').select('id').eq('record_id', ctx.cCaseId).eq('action', 'hr.onboarding.communication_sent').limit(1);
    expect(au && au.length >= 1, 'communication audit row');
  });

  await test('communications/send (manual channel) records only, no delivery', async () => {
    const r = await api('hr/onboarding/communications/send', A, { caseId: ctx.cCaseId, communicationType: 'manual_message', channel: 'manual', recipientUserId: ctx.empId, subject: `${TAG} call`, body: 'Called to confirm start date.' });
    ok(r, 'manual send'); expect(r.body.data.status === 'sent', 'manual logged as sent');
  });

  await test('communications/resend re-delivers the sent message', async () => {
    const r = await api('hr/onboarding/communications/resend', A, { id: ctx.commId });
    ok(r, 'resend'); expect(r.body.data.status === 'sent', 'resent');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.communication.resent').eq('source_entity_id', ctx.cCaseId).limit(1);
    expect(ev && ev.length >= 1, 'communication.resent event');
  });

  await test('communications send unauthorized (employee) → denied; list allowed to viewers', async () => {
    fails(await api('hr/onboarding/communications/send', ctx.empTok, { caseId: ctx.cCaseId, communicationType: 'owner_reminder' }), 'employee cannot send');
    // (list is gated by hr.onboarding.view — the employee lacks it, so it's denied too; that's correct.)
    fails(await api('hr/onboarding/communications/list', ctx.empTok, { caseId: ctx.cCaseId }), 'employee lacks onboarding.view');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 6 — reports (9 report types + audited export)
  // ════════════════════════════════════════════════════════════════════════════
  await test('reports/list returns the 9-report catalogue', async () => {
    const r = await api('hr/onboarding/reports/list', A);
    ok(r, 'reports/list'); expect(Array.isArray(r.body.data) && r.body.data.length === 9, 'nine reports');
    expect(r.body.data.every(m => m.key && m.title && ('chartType' in m)), 'catalogue shape');
  });

  for (const key of ['cycle_time', 'blocked_cases', 'task_owner_performance', 'handoff_completion', 'package_effectiveness', 'activation_readiness', 'overdue_tasks', 'contractor_onboarding', 'safety_critical_onboarding']) {
    await test(`reports/run (${key}) returns the result contract`, async () => {
      const r = await api('hr/onboarding/reports/run', A, { reportKey: key });
      ok(r, `run ${key}`);
      const d = r.body.data;
      expect(d.reportKey === key && Array.isArray(d.summary) && Array.isArray(d.columns) && Array.isArray(d.rows) && typeof d.totalRows === 'number', 'result shape');
    });
  }

  await test('reports/run honors the package filter', async () => {
    const r = await api('hr/onboarding/reports/run', A, { reportKey: 'package_effectiveness', scope: 'all', packageKeys: ['standard_employee'] });
    ok(r, 'filtered run');
    expect(r.body.data.rows.every(row => row.package), 'rows scoped');
  });

  await test('reports use the shared onboarding scope contract', async () => {
    const mine = await api('hr/onboarding/reports/run', A, { reportKey: 'activation_readiness', scope: 'my' });
    const all = await api('hr/onboarding/reports/run', A, { reportKey: 'activation_readiness', scope: 'all' });
    ok(mine, 'my-scope report'); ok(all, 'all-scope report');
    expect(all.body.data.totalRows >= mine.body.data.totalRows, 'wider scope cannot report fewer visible rows');
    fails(await api('hr/onboarding/reports/run', A, { reportKey: 'cycle_time', scope: 'invalid' }), 'invalid scope rejected');
  });

  await test('reports/export writes an audit row (data egress)', async () => {
    const r = await api('hr/onboarding/reports/export', A, { reportKey: 'cycle_time', scope: 'all' });
    ok(r, 'export'); expect(r.body.data.reportKey === 'cycle_time', 'returns the report for client CSV');
    const { data: au } = await sb.from('hr_audit_log').select('id').eq('action', 'hr.onboarding.report_exported').order('created_at', { ascending: false }).limit(1);
    expect(au && au.length >= 1, 'export audit row written');
    ctx.exportAuditId = au[0].id;
  });

  await test('reports unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/reports/list', ctx.empTok), 'employee lacks reports.view');
    fails(await api('hr/onboarding/reports/run', ctx.empTok, { reportKey: 'cycle_time' }), 'employee cannot run reports');
  });

  await test('actions/templates update → retire (admin)', async () => {
    ok(await api('hr/onboarding/actions/templates/update', A, { id: ctx.templateId, displayOrder: 5 }), 'update');
    ok(await api('hr/onboarding/actions/templates/retire', A, { id: ctx.templateId }), 'retire');
    const active = await api('hr/onboarding/actions/templates/list', A, { packageKey: ctx.packageKey });
    expect(!active.body.data.some(t => t.id === ctx.templateId), 'retired template hidden by default');
    const all = await api('hr/onboarding/actions/templates/list', A, { packageKey: ctx.packageKey, includeInactive: true });
    expect(all.body.data.some(t => t.id === ctx.templateId), 'retired template shown with includeInactive');
  });

  // access control — custom actions
  await test('actions/templates/create unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/actions/templates/create', ctx.empTok, { packageKey: ctx.packageKey, actionName: 'x', actionType: 'custom_task' }), 'employee cannot create template');
  });

  await test('publishing freezes the package definition', async () => {
    ok(await api('hr/onboarding/packages/set-status', A, { id: ctx.packageId, status: 'active' }), 'publish');
    fails(await api('hr/onboarding/packages/update', A, { id: ctx.packageId, label: 'Must not change' }), 'published package details are immutable');
    fails(await api('hr/onboarding/packages/task-templates/update', A, { id: ctx.packageTaskId, taskTitle: 'Must not change' }), 'published task template is immutable');
    fails(await api('hr/onboarding/packages/handoff-templates/update', A, { id: ctx.packageHandoffId, handoffType: 'must_not_change' }), 'published handoff template is immutable');
    fails(await api('hr/onboarding/actions/templates/create', A, { packageKey: ctx.packageKey, actionName: 'Must not add', actionType: 'custom_task' }), 'published action template is immutable');
  });
  await test('actions/case/add unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/actions/case/add', ctx.empTok, { caseId: ctx.cCaseId, actionName: 'x', actionType: 'custom_task' }), 'employee cannot add case action');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 7b — settings-gated behaviour (drives real settings, then reverts)
  // ════════════════════════════════════════════════════════════════════════════
  await test('activation gate (documents) blocks ready — 7b', async () => {
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.block_activation_until_documents_complete', scopeType: 'global', scopeId: null, value: true }), 'documents gate on');
    fails(await api('hr/onboarding/ready', A, { caseId: ctx.cCaseId }), 'ready blocked while documents incomplete');
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.block_activation_until_documents_complete', scopeType: 'global', scopeId: null, value: false }), 'documents gate off');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Probation wiring — starting a case with a package that has probation_days
  // must persist probation_end_date on the worker's app_users row.
  // ════════════════════════════════════════════════════════════════════════════
  await test('start case with probation package → probation_end_date written to app_users', async () => {
    // Uses empId2 (not ctx.empId): ctx.empId already has a completed (employeeId,
    // standard_employee) idempotency key from "start case C" above — reusing it here would
    // short-circuit to case C's cached result instead of actually running this start.
    // It must NOT be ctx.contractorEmpId either: standard_employee is an employee-only
    // package, so a contractor target is refused by the eligibility gate before probation
    // is ever derived (that direction is already covered as a negative path above).
    const probEmpId = ctx.empId2 ?? ctx.empId;
    if (!probEmpId) return; // no real employee available — skip gracefully
    // The handoff-retry case above is still active on empId2 — close it first.
    await closeActiveCasesFor(probEmpId);
    // Ensure the standard_employee package has a probation_days value (90 days default from migration).
    const { data: pkg } = await sb.from('hr_onboarding_packages')
      .select('probation_days').eq('package_key', 'standard_employee').maybeSingle();
    const probDays = pkg?.probation_days ?? null;
    if (!probDays) { console.log('[probation] standard_employee has no probation_days — skipping assertion'); return; }

    const targetStartDate = '2027-01-01';
    const r = await api('hr/onboarding/start', A, {
      requestId: crypto.randomUUID(),
      employeeId: probEmpId,
      packageKey: 'standard_employee',
      targetStartDate,
    });
    ok(r, 'start with probation package succeeds');
    const probationCaseId = r.body.data.caseId;
    // Track for cleanup
    ctx.probationCaseId = probationCaseId;

    // Verify the worker's probation_end_date was written correctly.
    const expectedEnd = (() => {
      const d = new Date(targetStartDate);
      d.setDate(d.getDate() + probDays);
      return d.toISOString().slice(0, 10);
    })();
    const { data: worker } = await sb.from('app_users')
      .select('probation_end_date').eq('id', probEmpId).maybeSingle();
    expect(worker?.probation_end_date === expectedEnd,
      `probation_end_date = ${worker?.probation_end_date ?? 'NULL'}, expected ${expectedEnd}`);

    // Verify the audit row records the probationEndDate.
    const { data: audit } = await sb.from('hr_audit_log')
      .select('new_state').eq('record_id', probationCaseId).eq('action', 'hr.onboarding.started')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    expect(audit?.new_state?.probationEndDate === expectedEnd,
      `audit new_state.probationEndDate = ${audit?.new_state?.probationEndDate ?? 'missing'}`);
  });

  await test('start case with contractor package → probation_end_date NOT written', async () => {
    // Must be the CONTRACTOR target: contractor_worker is a contractor-only package, so
    // pairing it with an employee is refused by the eligibility gate before probation is
    // ever derived. That means this can't reuse the probation test's worker — the two
    // packages are mutually exclusive per worker type by design — so the assertion is
    // "probation_end_date is never written", not "isn't overwritten".
    const probEmpId = ctx.contractorEmpId;
    if (!probEmpId) return;
    // The contractor case from the start tests is still active — close it before the next one.
    await closeActiveCasesFor(probEmpId);
    // contractor_worker has probation_days = NULL → probation_end_date must stay untouched.
    const { data: worker_before } = await sb.from('app_users')
      .select('probation_end_date').eq('id', probEmpId).maybeSingle();
    const prevDate = worker_before?.probation_end_date ?? null;

    const r = await api('hr/onboarding/start', A, {
      requestId: crypto.randomUUID(),
      employeeId: probEmpId,
      packageKey: 'contractor_worker',
      targetStartDate: '2027-02-01',
    });
    ok(r, 'start with contractor package succeeds');
    ctx.contractorProbCaseId = r.body.data.caseId;

    const { data: worker_after } = await sb.from('app_users')
      .select('probation_end_date').eq('id', probEmpId).maybeSingle();
    const after = worker_after?.probation_end_date ?? null;
    // A package with no probation_days must leave the column exactly as it found it.
    expect(after === prevDate,
      `probation_end_date changed from ${prevDate ?? 'NULL'} to ${after ?? 'NULL'} on a no-probation package`);
  });


  await test('require_owner_on_start: a start with no explicit owner defaults to the actor — 7b', async () => {
    // Policy (Option 2): admins/HR managers shouldn't have to hand-pick an owner on every
    // case. With require_owner_on_start = true, an ownerless start still SUCCEEDS and the
    // case owner defaults to the creating actor (the gate only blocks a genuinely ownerless
    // start, which never happens because the actor is the fallback owner).
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.require_owner_on_start', scopeType: 'global', scopeId: null, value: true }), 'require owner on');
    // Case C is still active on ctx.empId (last used by the documents-gate test above) — close
    // it first so the one-active-case-per-employee gate doesn't reject this start.
    await closeActiveCasesFor(ctx.empId);
    const r = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'safety_critical_employee' });
    ok(r, 'ownerless start succeeds (owner defaults to the actor)');
    ctx.ownerCaseId = r.body.data.caseId;
    const { data: kase } = await sb.from('hr_onboarding_cases').select('owner_id').eq('id', ctx.ownerCaseId).maybeSingle();
    expect(kase && !!kase.owner_id, 'case has an owner (the actor) even with require_owner_on_start = true');
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.require_owner_on_start', scopeType: 'global', scopeId: null, value: false }), 'require owner off');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Atomic launch contract (hr_onboarding_launch_tx, migration 20260804024501).
  // The migration states three operator checks; the replay one is proven above by
  // "start retry with the same request id returns the same frozen case". These two
  // cover the other two — rollback and the frozen snapshot — and they drive the RPC
  // through the service-role client because it is service-role-only by grant, so
  // there is no HTTP path that can inject a deliberately invalid child row.
  // ════════════════════════════════════════════════════════════════════════════
  h.section('Onboarding › Atomic launch contract');

  await test('forced child failure rolls the entire launch back — no orphan rows', async () => {
    const requestId = crypto.randomUUID();
    const caseId = crypto.randomUUID();
    const employeeId = `ONB-ATOMIC-${TAG}`;
    // A worker of its own: the RPC aborts early if the employee already has an active
    // case, and that would abort for the WRONG reason and fake a pass.
    const { error: empErr } = await sb.from('app_users').insert({
      id: employeeId, username: `${TAG}_onb_atomic`, full_name: 'Onboarding E2E Atomic',
      role: 'employee', status: 'active', employment_type: 'employee', contractor_flag: false,
    });
    expect(!empErr, `seed atomic-launch employee: ${empErr?.message ?? ''}`);
    ctx.createdEmpIds.push(employeeId);

    const { data: pkg } = await sb.from('hr_onboarding_packages')
      .select('id, package_key, version_no').eq('package_key', 'standard_employee').maybeSingle();
    expect(!!pkg, 'standard_employee package must exist');

    const { error } = await sb.rpc('hr_onboarding_launch_tx', {
      p_request_id: requestId,
      p_actor_id: admin.id,
      p_case: {
        id: caseId, caseNo: `ONB-ATOMIC-${TAG}`, employeeId, workerType: 'employee',
        packageKey: pkg.package_key, packageId: pkg.id, packageVersionNo: pkg.version_no ?? 1,
        launchSnapshot: { schemaVersion: 1, probe: 'atomic-rollback' }, ownerId: admin.id,
        targetStartDate: '2027-03-01',
      },
      p_tasks: [{ id: crypto.randomUUID(), taskKey: 'e2e_atomic_task', taskTitle: 'Atomic probe task', ownerRole: 'hr' }],
      // The handoff loop also writes handoff_outbox + an app_events row, so a rollback
      // that only covered the case table would still leave these two behind.
      p_handoffs: [{ id: crypto.randomUUID(), handoffKey: 'e2e_atomic_handoff', targetModule: 'it', handoffType: 'account_setup', payload: {} }],
      // FORCED FAILURE — requirement_id is FK'd to hr_document_requirements, so a random
      // uuid raises 23503 only AFTER the case, task, handoff, outbox row and handoff event
      // have already been inserted in this transaction.
      p_documents: [{
        id: crypto.randomUUID(), requirementId: crypto.randomUUID(), documentType: 'id_card',
        label: 'Atomic probe document', status: 'pending',
      }],
      p_actions: [],
      p_notifications: [{ userId: admin.id, title: 'Atomic probe', body: 'should never exist' }],
      p_probation_end_date: null,
    });
    expect(!!error, 'the RPC must reject the invalid child row');
    // Pin WHERE it failed. If a future change makes the launch abort earlier (e.g. at the
    // case insert), the rollback assertions below become vacuous — this keeps them honest.
    expect(error?.code === '23503' && /hr_onboarding_document_requests/.test(error?.message ?? ''),
      `expected the FK violation on hr_onboarding_document_requests (i.e. AFTER the case/task/handoff writes), got ${error?.code ?? '?'}: ${error?.message ?? ''}`);

    // Nothing whatsoever may survive for this request/case — every table the RPC touches.
    const countWhere = async (table, col, val, op = 'eq') => {
      const q = sb.from(table).select('*', { count: 'exact', head: true });
      const { count } = await (op === 'like' ? q.like(col, val) : q.eq(col, val));
      return count ?? 0;
    };
    const survivors = [];
    const check = async (label, table, col, val, op) => {
      const n = await countWhere(table, col, val, op);
      if (n > 0) survivors.push(`${label} (${n})`);
    };
    await check('case', 'hr_onboarding_cases', 'launch_request_id', requestId);
    await check('task', 'hr_onboarding_tasks', 'case_id', caseId);
    await check('handoff', 'hr_onboarding_handoffs', 'case_id', caseId);
    await check('document request', 'hr_onboarding_document_requests', 'case_id', caseId);
    await check('case action', 'hr_onboarding_case_actions', 'case_id', caseId);
    await check('handoff outbox', 'handoff_outbox', 'source_entity_id', caseId);
    await check('app event', 'app_events', 'dedupe_key', `hr.onboarding.launch:${requestId}%`, 'like');
    await check('audit log', 'audit_logs', 'record_id', caseId);
    await check('hr audit log', 'hr_audit_log', 'record_id', caseId);
    await check('notification', 'notifications', 'source_id', caseId);
    expect(survivors.length === 0, `rollback leaked rows: ${survivors.join(', ')}`);

    // The employee's probation column must be untouched too (the RPC writes it inline).
    const { data: worker } = await sb.from('app_users').select('probation_end_date').eq('id', employeeId).maybeSingle();
    expect((worker?.probation_end_date ?? null) === null, 'rolled-back launch wrote probation_end_date');
  });

  await test('launch_snapshot is written at launch and frozen against later package change', async () => {
    // ctx.ownerCaseId was launched from safety_critical_employee just above.
    expect(!!ctx.ownerCaseId, 'need a launched case to inspect');
    const { data: before } = await sb.from('hr_onboarding_cases')
      .select('launch_snapshot, package_id, package_version_no').eq('id', ctx.ownerCaseId).maybeSingle();
    const snap = before?.launch_snapshot ?? null;
    expect(!!snap && snap.schemaVersion === 1, `launch_snapshot missing or unversioned: ${JSON.stringify(snap)}`);
    expect(snap.package?.id === before.package_id && snap.package?.versionNo === before.package_version_no,
      'snapshot package identity does not match the frozen columns');
    expect(Array.isArray(snap.tasks) && snap.tasks.length > 0, 'snapshot did not freeze the task plan');
    const frozen = JSON.stringify(snap);

    // Mutate the world the snapshot was generated from: bump the package's version by
    // retiring it, and complete a task on the case. Neither may rewrite the snapshot.
    await sb.from('hr_onboarding_packages').update({ status: 'retired' }).eq('id', before.package_id);
    const { data: firstTask } = await sb.from('hr_onboarding_tasks').select('id').eq('case_id', ctx.ownerCaseId).limit(1).maybeSingle();
    if (firstTask) await api('hr/onboarding/task/complete', A, { taskId: firstTask.id });

    const { data: after } = await sb.from('hr_onboarding_cases')
      .select('launch_snapshot, package_id, package_version_no').eq('id', ctx.ownerCaseId).maybeSingle();
    expect(JSON.stringify(after?.launch_snapshot) === frozen, 'launch_snapshot changed after the package/case was mutated');
    expect(after?.package_version_no === before.package_version_no, 'package_version_no drifted after launch');

    // Restore the seeded package so the suite leaves the roster as it found it.
    await sb.from('hr_onboarding_packages').update({ status: 'active' }).eq('id', before.package_id);
  });
}
