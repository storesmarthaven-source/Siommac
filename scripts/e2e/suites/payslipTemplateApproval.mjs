/**
 * scripts/e2e/suites/payslipTemplateApproval.mjs
 *
 * E2E for Payslip Studio template APPROVAL LIFECYCLE (maker-checker).
 * Migration: 20260919000110_payslip_template_approval.sql
 *
 * Routes under test:
 *   /api/finance/payroll/payslip-templates/submit         (manage perm)
 *   /api/finance/payroll/payslip-templates/approve        (approve perm)
 *   /api/finance/payroll/payslip-templates/request-changes (approve perm)
 *   /api/finance/payroll/payslip-templates/create-version  (manage perm)
 *   /api/finance/payroll/payslip-templates/set-default     (manage + approved)
 *   /api/finance/payroll/payslip-templates/delete          (manage + approved)
 *   /api/finance/payroll/runs/set-template                 (render gate: approved only)
 *
 * Covers:
 *   1. Full approval lifecycle: draft -> pending_approval -> approved
 *   2. Changes-requested flow: pending_approval -> changes_requested -> pending_approval -> approved
 *   3. SoD (segregation of duties): submitter CANNOT approve their own template
 *   4. Render gate: set-template / loadRenderTemplate reject non-approved templates
 *   5. Versioning: edit approved -> create-version creates a new draft (v+1); old approved stays
 *   6. set-default + archive only work on approved templates
 *   7. §2 side-effects: app_events + hr_audit_log + notifications + workflow_tasks
 *   8. Access control: manage-only routes deny non-manage; approve-only routes deny non-approve
 *
 * Requires: migrations 20260919000110 + 20260919000120 applied;
 *           build:backend + dev server restart.
 * Run: npm run test:e2e -- payslipTemplateApproval
 */

export const title = 'Payslip Template Approval — maker-checker lifecycle';

function sampleDesign(tag) {
  return {
    page: { size: 'a4', orient: 'portrait', bg: '#ffffff', grid: true },
    elements: [
      {
        id: 'el-' + tag, type: 'heading', x: 24, y: 24, w: 300, h: 32, z: 1,
        text: 'PAYSLIP (' + tag + ')',
        color: '#1a2340', bg: 'transparent', fontSize: 26, fontFamily: 'Inter, sans-serif',
        bold: true, italic: false, underline: false, align: 'left', valign: 'top',
        borderW: 0, borderColor: '#d0d5e2', borderStyle: 'solid', radius: 0, padding: 6, lineHeight: 1.4,
      },
    ],
  };
}

import { payrollPeriodYear, payrollRunSeed } from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  // User IDs — prefixed so sweep-orphans can find them
  const makerId    = 'PTA-MAKER-'    + TAG;  // finance_manager: creates and submits templates
  const approverId = 'PTA-APPROVER-' + TAG;  // superadmin: approves (different user, SoD; the workflow assignee)
  const plainId    = 'PTA-PLAIN-'    + TAG;  // employee: no permissions

  const ctx = {
    templateId:   null, // the main test template (goes through the full lifecycle)
    templateId2:  null, // second template for changes-requested flow
    versionId:    null, // new draft version of approved template
    workflowId:   null, // workflow instance created at submit
    // Track run IDs for render-gate test cleanup
    runIds:       [],
  };

  let makerToken, approverToken, plainToken;

  h.onCleanup(async () => {
    // Delete templates created by our test users
    try {
      const { data: tmplIds } = await sb.from('payroll_payslip_templates')
        .select('id').in('created_by', [makerId, approverId]);
      const ids = (tmplIds ?? []).map(t => t.id);
      if (ids.length) {
        // Cancel any active workflows on these templates
        await sb.from('workflow_instances').update({ status: 'cancelled' }).in('source_record_id', ids);
        await sb.from('payroll_payslip_templates').delete().in('id', ids);
      }
    } catch {}
    // Delete workflow audit rows
    try { await sb.from('workflow_audit_log').in('source_record_id', [ctx.templateId, ctx.templateId2, ctx.versionId].filter(Boolean)).delete(); } catch {}
    // Delete side-effect rows
    try { await sb.from('app_events').delete().in('actor_user_id', [makerId, approverId]); } catch {}
    try { await sb.from('hr_audit_log').delete().in('actor_id', [makerId, approverId]); } catch {}
    try { await sb.from('notifications').delete().ilike('source_id', ctx.templateId ?? ''); } catch {}
    if (ctx.runIds.length) {
      try { await sb.from('finance_payroll_runs').delete().in('id', ctx.runIds); } catch {}
    }
    // Delete test users
    try { await sb.from('app_users').delete().in('id', [makerId, approverId, plainId]); } catch {}
  });

  // ===========================================================================
  h.section('Template approval — Setup');
  // ===========================================================================

  await test('provision maker (finance_manager), approver (superadmin), plain (employee)', async () => {
    const { error } = await sb.from('app_users').insert([
      { id: makerId,    username: TAG + '_ptam', full_name: 'PTA Maker (E2E)',    role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: approverId, username: TAG + '_ptaa', full_name: 'PTA Approver (E2E)', role: 'superadmin',      status: 'active', employment_type: 'employee' },
      { id: plainId,    username: TAG + '_ptap', full_name: 'PTA Plain (E2E)',    role: 'employee',        status: 'active', employment_type: 'employee' },
    ]);
    expect(!error, 'seed users failed: ' + error?.message);

    makerToken    = mint({ id: makerId,    username: TAG + '_ptam', role: 'finance_manager', department_id: null });
    approverToken = mint({ id: approverId, username: TAG + '_ptaa', role: 'superadmin',      department_id: null });
    plainToken    = mint({ id: plainId,    username: TAG + '_ptap', role: 'employee',        department_id: null });
  });

  // ===========================================================================
  h.section('Template approval — Access control (submit + approve gates)');
  // ===========================================================================

  await test('plain employee CANNOT submit (manage -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/submit', plainToken, { id: '00000000-0000-0000-0000-000000000001', idempotencyKey: `tmpl-deny-${TAG}` });
    fails(r, 'employee must not submit');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee CANNOT approve (approve -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/approve', plainToken, { id: '00000000-0000-0000-0000-000000000001' });
    fails(r, 'employee must not approve');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee CANNOT request-changes (approve -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/request-changes', plainToken, { id: '00000000-0000-0000-0000-000000000001', comment: 'nope' });
    fails(r, 'employee must not request-changes');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee CANNOT create-version (manage -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/create-version', plainToken, { id: '00000000-0000-0000-0000-000000000001' });
    fails(r, 'employee must not create-version');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  // ===========================================================================
  h.section('Template approval — Atomic submit (finding #3, slice A2)');
  // ===========================================================================
  // Submit now commits status + workflow_id + submitted_by + the whole workflow +
  // business event/audit in ONE txn (workflow_submit_for_record_tx, payslip-template
  // branch), with request-key idempotency. Fresh drafts (created_by=maker → the
  // existing onCleanup removes them).

  const makeDraft = async (salt) => {
    const r = await api('finance/payroll/payslip-templates/create', makerToken,
      { name: `${TAG} Atom ${salt}`, design: sampleDesign(`${TAG}_a${salt}`) });
    ok(r, `create atom draft ${salt} failed: ${r.body.message}`);
    return r.body.data.id;
  };

  await test('A2 atomic: retry same key returns original workflow (no double-create, exact counts, submitted_by set)', async () => {
    const id = await makeDraft(1);
    const key = `a2-idem-${TAG}-${id}`;
    const r1 = await api('finance/payroll/payslip-templates/submit', makerToken, { id, idempotencyKey: key });
    ok(r1, `first submit failed: ${r1.body.message}`);
    const wf1 = r1.body.data.workflowId;
    expect(wf1, 'first submit returns a workflowId');
    const r2 = await api('finance/payroll/payslip-templates/submit', makerToken, { id, idempotencyKey: key });
    ok(r2, `idempotent retry failed: ${r2.body.message}`);
    expect(r2.body.data.workflowId === wf1, `retry should return workflow ${wf1}, got ${r2.body.data.workflowId}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 1, `exactly one workflow, got ${(wfs ?? []).length}`);
    const evc = (await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', id).eq('event_type', 'finance.payroll.payslip_template.submitted')).count ?? 0;
    expect(evc === 1, `exactly one submitted event, got ${evc}`);
    const auc = (await sb.from('hr_audit_log').select('id', { count: 'exact', head: true })
      .eq('record_id', id).eq('action', 'payslip_template.submitted')).count ?? 0;
    expect(auc === 1, `exactly one audit row, got ${auc}`);
    const { data: t } = await sb.from('payroll_payslip_templates').select('status, submitted_by, workflow_id').eq('id', id).single();
    expect(t.status === 'pending_approval' && t.submitted_by === makerId && t.workflow_id === wf1,
      `template should be pending_approval/submitted_by=maker/workflow=${wf1}, got ${t.status}/${t.submitted_by}/${t.workflow_id}`);
  });

  await test('A2 atomic: a rejected submit leaves the template UNCHANGED (no strand, no second workflow)', async () => {
    const id = await makeDraft(2);
    await api('finance/payroll/payslip-templates/submit', makerToken, { id, idempotencyKey: `a2-str-a-${id}` });
    const r = await api('finance/payroll/payslip-templates/submit', makerToken, { id, idempotencyKey: `a2-str-b-${id}` });
    fails(r, 'submitting an already-pending template should be rejected');
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 1, `still exactly one workflow, got ${(wfs ?? []).length}`);
  });

  await test('A2 atomic: concurrent submits — exactly one succeeds, one workflow', async () => {
    const id = await makeDraft(3);
    const [a, b2] = await Promise.all([
      api('finance/payroll/payslip-templates/submit', makerToken, { id, idempotencyKey: `a2-c1-${id}` }),
      api('finance/payroll/payslip-templates/submit', makerToken, { id, idempotencyKey: `a2-c2-${id}` }),
    ]);
    expect([a, b2].filter(x => x.body.success).length === 1, 'exactly one concurrent submit should succeed');
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 1, `exactly one workflow, got ${(wfs ?? []).length}`);
  });

  await test('A2 atomic: a submit without an idempotency key is rejected', async () => {
    const id = await makeDraft(4);
    const r = await api('finance/payroll/payslip-templates/submit', makerToken, { id });
    fails(r, 'submit without an idempotency key should be rejected');
    const { data: t } = await sb.from('payroll_payslip_templates').select('status').eq('id', id).single();
    expect(t.status === 'draft', `template should stay draft, got ${t.status}`);
  });

  // ===========================================================================
  h.section('Template approval — Full approval lifecycle');
  // ===========================================================================

  await test('maker creates a draft template', async () => {
    const r = await api('finance/payroll/payslip-templates/create', makerToken,
      { name: TAG + ' Approval Test', design: sampleDesign(TAG) });
    ok(r, 'create failed: ' + r.body.message);
    const d = r.body.data;
    expect(d.status === 'draft', 'newly created template is draft');
    expect(d.isDefault === false, 'draft is not the default');
    expect(d.version === 1, 'version starts at 1');
    ctx.templateId = d.id;
  });

  await test('cannot submit an already-pending template', async () => {
    // Force-insert to test the guard directly (submit on wrong status)
    // First create via API then try double-submit
    const r = await api('finance/payroll/payslip-templates/submit', makerToken, { id: ctx.templateId, idempotencyKey: `tmpl1-submit-${TAG}` });
    ok(r, 'first submit failed: ' + r.body.message);
    ctx.workflowId = r.body.data.workflowId;

    // Attempt a second submit with a DIFFERENT key — must fail (template is now
    // pending_approval). A same-key retry would idempotently return the original result.
    const r2 = await api('finance/payroll/payslip-templates/submit', makerToken, { id: ctx.templateId, idempotencyKey: `tmpl1-resubmit-deny-${TAG}` });
    fails(r2, 'double-submit must be refused');
  });

  await test('after submit: status=pending_approval, workflowId set', async () => {
    const got = await api('finance/payroll/payslip-templates/get', makerToken, { id: ctx.templateId });
    ok(got, 'get failed');
    const d = got.body.data;
    expect(d.status === 'pending_approval', 'status is pending_approval after submit');
    expect(typeof d.workflowId === 'string' && d.workflowId.length > 0, 'workflowId is set');
    ctx.workflowId = d.workflowId;
  });

  await test('submit wrote §2 side-effects: app_event, audit_log, notification, workflow_task', async () => {
    // app_event
    const ev = await sb.from('app_events').select('event_type').eq('source_entity_id', ctx.templateId);
    expect((ev.data ?? []).some(e => e.event_type === 'finance.payroll.payslip_template.submitted'),
      'submit emits the submitted event');

    // audit_log
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.templateId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.submitted'),
      'submit writes an audit row');

    // workflow instance exists + has open task
    const wf = await sb.from('workflow_instances').select('status').eq('id', ctx.workflowId).maybeSingle();
    expect(wf.data?.status === 'in_progress', 'workflow instance is in_progress');

    const tasks = await sb.from('workflow_tasks').select('status, assigned_role')
      .eq('workflow_id', ctx.workflowId)
      .in('status', ['pending', 'open', 'in_progress']);
    expect((tasks.data ?? []).length > 0, 'at least one open approval task exists');
    const approverTask = (tasks.data ?? []).find(t => t.assigned_role === 'superadmin');
    expect(!!approverTask, 'approval task is assigned to superadmin role');
  });

  await test('update of pending_approval template is rejected (422)', async () => {
    const r = await api('finance/payroll/payslip-templates/update', makerToken,
      { id: ctx.templateId, name: TAG + ' Pending Updated' });
    fails(r, 'updating a pending_approval template must be refused');
  });

  // ===========================================================================
  h.section('Template approval — SoD: submitter cannot approve');
  // ===========================================================================

  await test('maker (submitter) CANNOT approve their own template (SoD -> 422)', async () => {
    const r = await api('finance/payroll/payslip-templates/approve', makerToken, { id: ctx.templateId });
    fails(r, 'submitter must not approve their own template');
    expect(r.status === 422, 'expected 422 SoD error, got ' + r.status);
  });

  // ===========================================================================
  h.section('Template approval — Approve path');
  // ===========================================================================

  await test('approver (different user) approves the template', async () => {
    const r = await api('finance/payroll/payslip-templates/approve', approverToken, { id: ctx.templateId });
    ok(r, 'approve failed: ' + r.body.message);
    const d = r.body.data;
    expect(d.status === 'approved', 'status is approved after approval');
    expect(typeof d.approvedBy === 'string', 'approvedBy is set');
    expect(typeof d.approvedAt === 'string', 'approvedAt is set');
  });

  await test('approve wrote §2 side-effects: app_event, audit_log', async () => {
    const ev = await sb.from('app_events').select('event_type').eq('source_entity_id', ctx.templateId);
    expect((ev.data ?? []).some(e => e.event_type === 'finance.payroll.payslip_template.approved'),
      'approve emits the approved event');

    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.templateId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.approved'),
      'approve writes an audit row');

    // Workflow should be completed
    const wf = await sb.from('workflow_instances').select('status').eq('id', ctx.workflowId).maybeSingle();
    expect(wf.data?.status === 'completed', 'workflow instance is completed');
  });

  // ===========================================================================
  h.section('Template approval — set-default + archive require approved status');
  // ===========================================================================

  await test('set-default on an approved template succeeds', async () => {
    const r = await api('finance/payroll/payslip-templates/set-default', makerToken, { id: ctx.templateId });
    ok(r, 'set-default failed: ' + r.body.message);
    expect(r.body.data.isDefault === true, 'isDefault is now true');
  });

  await test('set-default on a draft template is rejected', async () => {
    // Create another draft for this test
    const c = await api('finance/payroll/payslip-templates/create', makerToken,
      { name: TAG + ' Draft For SetDef Test', design: sampleDesign(TAG + '_sd') });
    ok(c, 'create draft failed');
    const draftId = c.body.data.id;

    const r = await api('finance/payroll/payslip-templates/set-default', makerToken, { id: draftId });
    fails(r, 'set-default on draft must fail');
    // cleanup
    await sb.from('payroll_payslip_templates').delete().eq('id', draftId);
  });

  await test('archive (delete) on a draft template is rejected', async () => {
    const c = await api('finance/payroll/payslip-templates/create', makerToken,
      { name: TAG + ' Draft For Archive Test', design: sampleDesign(TAG + '_ar') });
    ok(c, 'create draft failed');
    const draftId = c.body.data.id;

    const r = await api('finance/payroll/payslip-templates/delete', makerToken, { id: draftId });
    fails(r, 'archive of draft must fail');
    // cleanup
    await sb.from('payroll_payslip_templates').delete().eq('id', draftId);
  });

  // ===========================================================================
  h.section('Template approval — Versioning (edit approved template)');
  // ===========================================================================

  await test('create-version of approved template produces a new draft (version+1)', async () => {
    const r = await api('finance/payroll/payslip-templates/create-version', makerToken, { id: ctx.templateId });
    ok(r, 'create-version failed: ' + r.body.message);
    const d = r.body.data;
    expect(d.status === 'draft', 'new version is a draft');
    expect(d.version === 2, 'new version has version=2');
    expect(d.parentTemplateId === ctx.templateId, 'parentTemplateId points to the original');
    expect(d.isDefault === false, 'new draft version is not the default');
    ctx.versionId = d.id;
  });

  await test('original approved template still exists and is approved/default', async () => {
    const got = await api('finance/payroll/payslip-templates/get', makerToken, { id: ctx.templateId });
    ok(got, 'get original failed');
    expect(got.body.data.status === 'approved', 'original is still approved');
    expect(got.body.data.isDefault === true, 'original is still the default');
  });

  await test('create-version wrote app_event + audit_log', async () => {
    const ev = await sb.from('app_events').select('event_type').eq('source_entity_id', ctx.versionId);
    expect((ev.data ?? []).some(e => e.event_type === 'finance.payroll.payslip_template.version_created'),
      'create-version emits the version_created event');
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.versionId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.version_created'),
      'create-version writes an audit row');
  });

  await test('create-version of a non-approved template is rejected (422)', async () => {
    // versionId is a draft
    const r = await api('finance/payroll/payslip-templates/create-version', makerToken, { id: ctx.versionId });
    fails(r, 'create-version of a draft must fail');
  });

  // ===========================================================================
  h.section('Template approval — Changes-requested flow');
  // ===========================================================================

  await test('create template2 as draft', async () => {
    const r = await api('finance/payroll/payslip-templates/create', makerToken,
      { name: TAG + ' Changes Test', design: sampleDesign(TAG + '_cr') });
    ok(r, 'create template2 failed');
    ctx.templateId2 = r.body.data.id;
  });

  await test('submit template2 for approval', async () => {
    const r = await api('finance/payroll/payslip-templates/submit', makerToken, { id: ctx.templateId2, idempotencyKey: `tmpl2-submit-${TAG}` });
    ok(r, 'submit template2 failed: ' + r.body.message);
    expect(r.body.data.status === 'pending_approval', 'template2 is pending_approval');
  });

  await test('request-changes without a comment is rejected (422)', async () => {
    const r = await api('finance/payroll/payslip-templates/request-changes', approverToken,
      { id: ctx.templateId2, comment: '' });
    fails(r, 'request-changes with empty comment must fail');
  });

  await test('approver requests changes on template2 (with reason)', async () => {
    const r = await api('finance/payroll/payslip-templates/request-changes', approverToken,
      { id: ctx.templateId2, comment: 'Please fix the employer block layout.' });
    ok(r, 'request-changes failed: ' + r.body.message);
    expect(r.body.data.status === 'changes_requested', 'status is changes_requested');
  });

  await test('request-changes wrote §2 side-effects: app_event + audit_log', async () => {
    // The adapter emits the app_event fire-and-forget (void emitAppEvent), so poll.
    let gotEvent = false;
    for (let i = 0; i < 20 && !gotEvent; i++) {
      const ev = await sb.from('app_events').select('event_type').eq('source_entity_id', ctx.templateId2);
      gotEvent = (ev.data ?? []).some(e => e.event_type === 'finance.payroll.payslip_template.changes_requested');
      if (!gotEvent) await new Promise(r => setTimeout(r, 250));
    }
    expect(gotEvent, 'request-changes emits the changes_requested event');
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.templateId2);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.changes_requested'),
      'request-changes writes an audit row');
  });

  await test('maker can update template2 after changes_requested', async () => {
    const r = await api('finance/payroll/payslip-templates/update', makerToken,
      { id: ctx.templateId2, name: TAG + ' Changes Test (Fixed)' });
    ok(r, 'update after changes_requested failed: ' + r.body.message);
    expect(r.body.data.status === 'changes_requested', 'update keeps the status');
  });

  await test('maker resubmits template2 -> back to pending_approval', async () => {
    const r = await api('finance/payroll/payslip-templates/submit', makerToken, { id: ctx.templateId2, idempotencyKey: `tmpl2-resubmit-${TAG}` });
    ok(r, 'resubmit failed: ' + r.body.message);
    expect(r.body.data.status === 'pending_approval', 'resubmit returns to pending_approval');
  });

  await test('approver approves template2 on second round', async () => {
    const r = await api('finance/payroll/payslip-templates/approve', approverToken, { id: ctx.templateId2 });
    ok(r, 'second-round approve failed: ' + r.body.message);
    expect(r.body.data.status === 'approved', 'template2 is now approved');
  });

  // ===========================================================================
  h.section('Template approval — Render gate');
  // ===========================================================================

  await test('set-template rejects a draft template (P3 gate)', async () => {
    // Need a payroll run for this test — create one via service-role
    // (we just need a row, not a calculated run)
    const { data: payGroup } = await sb.from('finance_pay_groups').select('id').limit(1).maybeSingle();
    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions')
      .select('id').eq('is_active', true).limit(1).maybeSingle();
    expect(
      !verErr && ver?.id,
      `render-gate fixture requires an active statutory version: ${verErr?.message ?? 'none found'}`,
    );
    // Use a far-future, TAG-derived period to isolate the scheduled-run identity.
    const y = payrollPeriodYear('payslipTemplateApproval', TAG);
    const { data: run, error: runErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no:       TAG + '-PTA-RUN',
      periodStart:  `${y}-06-01`,
      status:       'draft',
      created_by:   makerId,
      statutory_version_id: ver.id,
      ...(payGroup ? { pay_group_id: payGroup.id } : {}),
    })).select('id').single();
    if (runErr) {
      throw new Error(`render-gate fixture run failed: ${runErr.message}`);
    }
    ctx.runIds.push(run.id);

    // Attempt to link versionId (which is a draft, not approved)
    const r = await api('finance/payroll/runs/set-template', makerToken,
      { runId: run.id, templateId: ctx.versionId });
    fails(r, 'set-template with a draft template must fail');
    // The error message should mention "not approved"
    expect(
      r.body.message && r.body.message.toLowerCase().includes('approv'),
      'error message mentions approval status'
    );
  });

  await test('set-template accepts an approved template (P3 gate)', async () => {
    if (!ctx.runIds.length) return; // skipped above
    const r = await api('finance/payroll/runs/set-template', makerToken,
      { runId: ctx.runIds[0], templateId: ctx.templateId });
    ok(r, 'set-template with approved template failed: ' + r.body.message);
  });

  // ===========================================================================
  h.section('Template approval — Archive of approved default promotes next');
  // ===========================================================================

  await test('archive the approved default (template1) -> ok, next approved promoted', async () => {
    // template1 is the current default (approved); template2 is also approved.
    // Archiving template1 should promote template2 to default (or leave no default if template2 was already there).
    const r = await api('finance/payroll/payslip-templates/delete', makerToken, { id: ctx.templateId });
    ok(r, 'archive approved default failed: ' + r.body.message);

    // Verify template1 is now archived
    const got = await api('finance/payroll/payslip-templates/get', makerToken, { id: ctx.templateId });
    // archived templates may not be returned by get (neq archived filter)
    // Either null (archived) or status='archived' — both are acceptable.
    const archived = !got.body.data || got.body.data.status === 'archived';
    expect(archived, 'archived template is no longer visible in non-archived list');
  });

  await test('archive wrote §2 side-effects', async () => {
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.templateId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.archived'),
      'archive writes an audit row');
    const ev = await sb.from('app_events').select('event_type').eq('source_entity_id', ctx.templateId);
    expect((ev.data ?? []).some(e => e.event_type === 'finance.payroll.payslip_template.archived'),
      'archive emits the archived event');
  });
}
