export const title = 'Finance Payroll Setup - Pay Policies Phase A';

const uuid = () => crypto.randomUUID();
const exactKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort().join(',');
  const expected = [...keys].sort().join(',');
  if (actual !== expected) throw new Error(`${label} keys mismatch: ${actual}`);
};

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const ids = { policy: null, version: null, workflow: null, group: null, assignment: null };
  const users = {
    preparer: `PPS-PREP-${TAG}`, hr: `PPS-HR-${TAG}`, approver: `PPS-FIN-${TAG}`, employee: `PPS-EE-${TAG}`,
  };
  const code = `PPS-${TAG.slice(-8).toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  let T = {};
  let componentId;

  h.onCleanup(async () => {
    // Workflow cleanup: delete instances first — cascades to decisions, audit_log,
    // tasks, transitions, source_receipts, and outbox in the correct FK order.
    // Explicit tasks-before-instances fails silently because workflow_transitions
    // references tasks via ON DELETE RESTRICT; instances→cascade removes transitions
    // first, then tasks can be dropped without FK conflicts.
    if (ids.workflow) {
      await h.mustDelete('workflow_instances', q => q.eq('id', ids.workflow));
    }
    if (ids.policy) {
      const entityIds = [ids.policy, ids.version, ids.assignment].filter(Boolean);
      // notifications must precede app_events (event_id FK to app_events)
      await h.mustDelete('notifications', q => q.in('source_id', entityIds));
      await h.mustDelete('handoff_outbox', q => q.eq('source_module', 'finance_pay_policy').in('source_entity_id', entityIds));
      await h.mustDelete('app_events', q => q.eq('source_module', 'finance_pay_policy').in('source_entity_id', entityIds));
      await h.mustDelete('hr_audit_log', q => q.eq('submodule_key', 'finance_pay_policy').in('record_id', entityIds));
      await h.mustDelete('finance_pay_policy_command_receipts', q => q.eq('policy_id', ids.policy));
      // assignments reference versions via ON DELETE RESTRICT — must precede policies delete
      await h.mustDelete('finance_pay_group_policy_assignments', q => q.eq('policy_id', ids.policy));
      // policies cascade to versions → components/source_rules/costing_rules
      await h.mustDelete('finance_pay_policies', q => q.eq('id', ids.policy));
    }
    if (ids.group) await h.mustDelete('finance_pay_groups', q => q.eq('id', ids.group));
    await h.mustDelete('app_users', q => q.in('id', Object.values(users)));
  });

  const draft = () => ({
    code, name: `Monthly Salary ${TAG}`, description: 'Local T&T salaried employee policy.',
    policyType: 'standard_salary', ownerId: users.preparer, effectiveFrom: '2026-01-05', effectiveTo: null,
    changeSummary: 'Initial governed policy', dayBoundary: 'calendar_day',
    components: [{
      componentId, calculationBasis: 'salary_period', rateSource: 'employee_contract',
      eligibilitySource: 'approved_compensation', ruleParameters: { proration: 'working_days' },
      required: true, sortOrder: 0,
    }],
    sourceRules: [
      { sourceType: 'approved_compensation', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
      { sourceType: 'approved_leave', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_period', lateInputPolicy: 'correction_candidate', conflictSeverity: 'warning', conflictOutcome: 'create_review_finding' },
      { sourceType: 'statutory_profile', ownerRole: 'finance_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
      { sourceType: 'payment_destination', ownerRole: 'finance_staff', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'blocker', conflictOutcome: 'block_input_lock' },
    ],
  });

  h.section('Pay Policies - Setup and security');
  await test('provision real roles and canonical dependencies', async () => {
    const { error } = await sb.from('app_users').insert([
      { id: users.preparer, username: `${TAG}_pps_p`, full_name: 'PPS Preparer (E2E)', role: 'finance_staff', status: 'active', employment_type: 'employee' },
      { id: users.hr, username: `${TAG}_pps_h`, full_name: 'PPS HR Reviewer (E2E)', role: 'hr_manager', status: 'active', employment_type: 'employee' },
      { id: users.approver, username: `${TAG}_pps_f`, full_name: 'PPS Finance Approver (E2E)', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: users.employee, username: `${TAG}_pps_e`, full_name: 'PPS Employee (E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
    ]);
    expect(!error, `user setup failed: ${error?.message}`);
    T = {
      preparer: mint({ id: users.preparer, username: `${TAG}_pps_p`, role: 'finance_staff', department_id: null }),
      hr: mint({ id: users.hr, username: `${TAG}_pps_h`, role: 'hr_manager', department_id: null }),
      approver: mint({ id: users.approver, username: `${TAG}_pps_f`, role: 'finance_manager', department_id: null }),
      employee: mint({ id: users.employee, username: `${TAG}_pps_e`, role: 'employee', department_id: null }),
    };
    const component = await sb.from('finance_pay_components').select('id').eq('code', 'basic').eq('is_active', true).single();
    expect(!component.error, `basic component unavailable: ${component.error?.message}`);
    componentId = component.data.id;
    const group = await sb.from('finance_pay_groups').insert({
      code: `PPSG-${TAG.slice(-6)}`, name: `PPS Group ${TAG}`, frequency: 'monthly',
    }).select('id').single();
    expect(!group.error, `group setup failed: ${group.error?.message}`);
    ids.group = group.data.id;
  });

  const paths = [
    'list', 'get', 'create-draft', 'update-draft', 'copy-version', 'preflight', 'submit', 'activate', 'reject', 'retire',
    'versions/list', 'versions/get', 'versions/compare', 'pay-groups/list', 'pay-groups/assign', 'pay-groups/end-assignment',
  ];
  await test('all 16 endpoints require authentication and deny a real employee', async () => {
    for (const path of paths) {
      const unauth = await api(`finance/payroll/policies/${path}`, null, {});
      expect(unauth.status === 401, `${path}: expected 401, got ${unauth.status}`);
      const denied = await api(`finance/payroll/policies/${path}`, T.employee, {});
      expect(denied.status === 403, `${path}: expected 403 before validation, got ${denied.status}`);
    }
  });

  h.section('Pay Policies - Draft, validation and idempotency');
  const createKey = `${TAG}:pps:create`;
  await test('strict create rejects unknown fields and unsupported Phase B type', async () => {
    const unknown = await api('finance/payroll/policies/create-draft', T.preparer, { ...draft(), idempotencyKey: uuid(), ignored: true });
    fails(unknown, 'unknown field must fail'); expect(unknown.status === 400, 'unknown field must be 400');
    const crew = await api('finance/payroll/policies/create-draft', T.preparer, { ...draft(), policyType: 'offshore_rotation', idempotencyKey: uuid() });
    fails(crew, 'Phase B policy type must fail'); expect(crew.status === 400, 'Phase B type must be 400');
  });
  await test('create draft returns exact shape and exact business side effects', async () => {
    const r = await api('finance/payroll/policies/create-draft', T.preparer, { ...draft(), idempotencyKey: createKey });
    ok(r, `create failed: ${r.body.message}`);
    exactKeys(r.body.data, ['policyId', 'versionId', 'lockVersion', 'status'], 'create');
    ids.policy = r.body.data.policyId; ids.version = r.body.data.versionId;
    const [events, audits] = await Promise.all([
      sb.from('app_events').select('id').eq('dedupe_key', `finance.pay_policy.create:${createKey}`),
      sb.from('hr_audit_log').select('id').eq('submodule_key', 'finance_pay_policy').eq('record_id', ids.policy).eq('action', 'pay_policy.draft_created'),
    ]);
    expect(events.data.length === 1, 'create must emit exactly one business event');
    expect(audits.data.length === 1, 'create must write exactly one audit row');
  });
  await test('same key/same payload returns original; changed payload conflicts with no duplicate effects', async () => {
    const same = await api('finance/payroll/policies/create-draft', T.preparer, { ...draft(), idempotencyKey: createKey });
    ok(same); expect(same.body.data.policyId === ids.policy, 'retry must return original policy');
    const changed = await api('finance/payroll/policies/create-draft', T.preparer, { ...draft(), name: `Changed ${TAG}`, idempotencyKey: createKey });
    fails(changed); expect(changed.status === 409, `changed retry expected 409, got ${changed.status}`);
    const { count } = await sb.from('finance_pay_policies').select('*', { count: 'exact', head: true }).eq('code', code);
    expect(count === 1, 'idempotency must create one policy');
  });
  await test('update enforces optimistic concurrency and typed rule compatibility', async () => {
    const good = await api('finance/payroll/policies/update-draft', T.preparer, {
      ...draft(), policyId: ids.policy, versionId: ids.version, expectedLockVersion: 1,
      description: 'Updated local T&T salaried employee policy.', idempotencyKey: `${TAG}:pps:update`,
    });
    ok(good); expect(good.body.data.lockVersion === 2, 'lock version must increment');
    const stale = await api('finance/payroll/policies/update-draft', T.preparer, {
      ...draft(), policyId: ids.policy, versionId: ids.version, expectedLockVersion: 1, idempotencyKey: uuid(),
    });
    fails(stale); expect(stale.status === 409, 'stale update must be 409');
    const badRule = draft(); badRule.components[0] = { ...badRule.components[0], calculationBasis: 'approved_hours', eligibilitySource: 'approved_compensation', ruleParameters: {} };
    const invalid = await api('finance/payroll/policies/update-draft', T.preparer, {
      ...badRule, policyId: ids.policy, versionId: ids.version, expectedLockVersion: 2, idempotencyKey: uuid(),
    });
    fails(invalid); expect(invalid.status === 400, 'invalid typed rule must be 400');
  });

  h.section('Pay Policies - Reads, preflight and workflow');
  await test('list/get/version/assignment reads return exact frontend contracts', async () => {
    const list = await api('finance/payroll/policies/list', T.preparer, { search: code, limit: 25 });
    ok(list); exactKeys(list.body.data, ['items', 'total', 'nextCursor'], 'list');
    expect(list.body.data.items.length === 1, 'search should find the policy');
    const get = await api('finance/payroll/policies/get', T.preparer, { policyId: ids.policy });
    ok(get); exactKeys(get.body.data, ['policy', 'version', 'components', 'sourceRules', 'versions', 'assignments', 'audit'], 'workspace');
    ok(await api('finance/payroll/policies/versions/list', T.preparer, { policyId: ids.policy }));
    ok(await api('finance/payroll/policies/versions/get', T.preparer, { policyId: ids.policy, versionId: ids.version }));
    ok(await api('finance/payroll/policies/versions/compare', T.preparer, { policyId: ids.policy, fromVersionId: ids.version, toVersionId: ids.version }));
    ok(await api('finance/payroll/policies/pay-groups/list', T.preparer, { policyId: ids.policy }));
  });
  await test('preflight returns exact proof and submit creates one central workflow', async () => {
    const pf = await api('finance/payroll/policies/preflight', T.preparer, { versionId: ids.version });
    ok(pf); exactKeys(pf.body.data, ['ready', 'blockers', 'warnings', 'checksum', 'statutoryVersionId', 'counts'], 'preflight');
    expect(pf.body.data.ready === true && pf.body.data.checksum.length === 64, 'preflight must be ready with SHA-256');
    const submitKey = `${TAG}:pps:submit`;
    const submitted = await api('finance/payroll/policies/submit', T.preparer, {
      versionId: ids.version, idempotencyKey: submitKey,
      certifications: { rulesReviewed: true, sourcesOwned: true, statutoryPaymentReady: true },
    });
    ok(submitted, submitted.body.message); ids.workflow = submitted.body.data.workflowId;
    const tasks = await sb.from('workflow_tasks').select('id,assigned_role,status').eq('workflow_id', ids.workflow);
    expect(tasks.data.length === 1 && tasks.data[0].assigned_role === 'hr_manager', 'submit must create one HR source-review task');
    const event = await sb.from('app_events').select('id').eq('dedupe_key', `finance.pay_policy.submit:${submitKey}`);
    expect(event.data.length === 1, 'submit business event must be exactly one');
  });
  await test('non-assignee is denied; HR then Finance approve the two workflow steps', async () => {
    let tasks = await sb.from('workflow_tasks').select('id,status,assigned_role').eq('workflow_id', ids.workflow).in('status', ['open', 'pending', 'in_progress']);
    const first = tasks.data[0];
    const denied = await api('workflow-engine/decide', T.approver, { workflowId: ids.workflow, taskId: first.id, decision: 'approved' });
    fails(denied); expect(denied.status === 403, 'non-assigned Finance actor must not approve HR step');
    ok(await api('workflow-engine/decide', T.hr, { workflowId: ids.workflow, taskId: first.id, decision: 'approved' }), 'HR review failed');
    tasks = await sb.from('workflow_tasks').select('id,status,assigned_role').eq('workflow_id', ids.workflow).in('status', ['open', 'pending', 'in_progress']);
    expect(tasks.data.length === 1 && tasks.data[0].assigned_role === 'finance_manager', 'second task must be Finance statutory review');
    ok(await api('workflow-engine/decide', T.approver, { workflowId: ids.workflow, taskId: tasks.data[0].id, decision: 'approved' }), 'Finance review failed');
    const version = await sb.from('finance_pay_policy_versions').select('status').eq('id', ids.version).single();
    expect(version.data.status === 'approved', `workflow source status expected approved, got ${version.data.status}`);
  });

  h.section('Pay Policies - Activation, assignment and retirement');
  await test('preparer cannot activate; independent activation writes exact side effects', async () => {
    const denied = await api('finance/payroll/policies/activate', T.preparer, { policyId: ids.policy, versionId: ids.version, idempotencyKey: uuid() });
    fails(denied); expect(denied.status === 403, 'finance staff lacks activate permission');
    const activationKey = `${TAG}:pps:activate`;
    const active = await api('finance/payroll/policies/activate', T.approver, { policyId: ids.policy, versionId: ids.version, idempotencyKey: activationKey });
    ok(active, active.body.message); expect(active.body.data.status === 'active', 'activation status');
    const [events, audits, notes, handoffs] = await Promise.all([
      sb.from('app_events').select('id').eq('dedupe_key', `finance.pay_policy.activate:${activationKey}`),
      sb.from('hr_audit_log').select('id').eq('record_id', ids.version).eq('action', 'pay_policy.activated'),
      sb.from('notifications').select('id').eq('source_id', ids.policy).eq('type', 'finance.payroll.policy.activated'),
      sb.from('handoff_outbox').select('id').eq('source_module', 'finance_pay_policy').eq('source_entity_id', ids.version),
    ]);
    expect(events.data.length === 1 && audits.data.length === 1 && notes.data.length === 1 && handoffs.data.length === 1,
      'activation requires exactly one event, audit, notification and handoff');
  });
  await test('new version is an atomic governed copy with exact idempotent effects', async () => {
    const copyKey = `${TAG}:pps:copy`;
    const copied = await api('finance/payroll/policies/copy-version', T.preparer, {
      policyId: ids.policy, sourceVersionId: ids.version, effectiveFrom: '2027-01-01',
      changeSummary: 'Annual policy review', idempotencyKey: copyKey,
    });
    ok(copied, copied.body.message);
    exactKeys(copied.body.data, ['policyId', 'versionId', 'versionNo', 'lockVersion', 'status'], 'copy version');
    const copiedVersionId = copied.body.data.versionId;
    const retry = await api('finance/payroll/policies/copy-version', T.preparer, {
      policyId: ids.policy, sourceVersionId: ids.version, effectiveFrom: '2027-01-01',
      changeSummary: 'Annual policy review', idempotencyKey: copyKey,
    });
    ok(retry); expect(retry.body.data.versionId === copiedVersionId, 'copy retry must return the original version');
    const [versions, components, sources, events, audits] = await Promise.all([
      sb.from('finance_pay_policy_versions').select('id,status,version_no').eq('id', copiedVersionId),
      sb.from('finance_pay_policy_components').select('id').eq('policy_version_id', copiedVersionId),
      sb.from('finance_pay_policy_source_rules').select('id').eq('policy_version_id', copiedVersionId),
      sb.from('app_events').select('id').eq('dedupe_key', `finance.pay_policy.copy_version:${copyKey}`),
      sb.from('hr_audit_log').select('id').eq('record_id', copiedVersionId).eq('action', 'pay_policy.version_created'),
    ]);
    expect(versions.data.length === 1 && versions.data[0].status === 'draft', 'copy must create one draft version');
    expect(components.data.length === draft().components.length, 'copy must preserve component bindings');
    expect(sources.data.length === draft().sourceRules.length, 'copy must preserve source rules');
    expect(events.data.length === 1 && audits.data.length === 1, 'copy requires exactly one event and audit');
    const compared = await api('finance/payroll/policies/versions/compare', T.preparer, {
      policyId: ids.policy, fromVersionId: ids.version, toVersionId: copiedVersionId,
    });
    ok(compared); expect(compared.body.data.changes.some(change => change.field === 'effectiveFrom'), 'comparison must expose effective-date change');

    // Remove the tested unpublished version so the same policy can exercise retirement.
    await sb.from('finance_pay_policy_command_receipts').delete().eq('request_key', copyKey);
    await sb.from('app_events').delete().eq('dedupe_key', `finance.pay_policy.copy_version:${copyKey}`);
    await sb.from('hr_audit_log').delete().eq('record_id', copiedVersionId).eq('action', 'pay_policy.version_created');
    await sb.from('finance_pay_policy_versions').delete().eq('id', copiedVersionId);
  });
  await test('assignment is effective-dated, idempotent, overlap-safe and endable', async () => {
    const assignmentKey = `${TAG}:pps:assign`;
    const assigned = await api('finance/payroll/policies/pay-groups/assign', T.approver, {
      policyId: ids.policy, versionId: ids.version, payGroupId: ids.group, effectiveFrom: '2026-01-05', idempotencyKey: assignmentKey,
    });
    ok(assigned, assigned.body.message); ids.assignment = assigned.body.data.assignmentId;
    const retry = await api('finance/payroll/policies/pay-groups/assign', T.approver, {
      policyId: ids.policy, versionId: ids.version, payGroupId: ids.group, effectiveFrom: '2026-01-05', idempotencyKey: assignmentKey,
    });
    ok(retry); expect(retry.body.data.assignmentId === ids.assignment, 'assignment retry must return original');
    const overlap = await api('finance/payroll/policies/pay-groups/assign', T.approver, {
      policyId: ids.policy, versionId: ids.version, payGroupId: ids.group, effectiveFrom: '2026-06-01', idempotencyKey: uuid(),
    });
    fails(overlap); expect(overlap.status === 409, 'overlap must be 409');
    const ended = await api('finance/payroll/policies/pay-groups/end-assignment', T.approver, {
      policyId: ids.policy, assignmentId: ids.assignment, effectiveTo: '2026-12-31', reason: 'E2E policy reassignment', idempotencyKey: uuid(),
    });
    ok(ended); expect(ended.body.data.status === 'ended', 'assignment must end');
  });
  await test('retirement closes future use and is exactly once', async () => {
    const retired = await api('finance/payroll/policies/retire', T.approver, {
      policyId: ids.policy, effectiveTo: '2026-12-31', reason: 'E2E controlled retirement', idempotencyKey: `${TAG}:pps:retire`,
    });
    ok(retired); expect(retired.body.data.status === 'retired', 'policy must retire');
    const illegal = await api('finance/payroll/policies/activate', T.approver, {
      policyId: ids.policy, versionId: ids.version, idempotencyKey: uuid(),
    });
    fails(illegal); expect(illegal.status === 409, 'retired version cannot reactivate');
  });
}
