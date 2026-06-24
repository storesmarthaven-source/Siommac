/**
 * scripts/e2e/suites/inspections.mjs
 *
 * Comprehensive E2E suite for the HSE Inspections module.
 * Backend route: hseInspections.ts, mounted at /api/hse/. Covers:
 *   inspections/{list,get,create,update,start,submit,review,reschedule,cancel,stats,dashboard}
 *   inspections/responses/{save,create-finding}
 *   inspections/evidence/add
 *   inspection-findings/{list,get,create,assign-action,actions/update,close,reopen,escalate}
 *   inspection-templates/{list,get,create,update,archive}
 *
 * Permissions: hse.inspections.view · .create · .manage · .review
 *
 * §2 side-effects asserted via the service-role client: app_events rows and
 * hse_inspection_audit_events timeline entries after each mutation.
 */

export const title = 'HSE Inspections';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  const ctx = { inspectionIds: [], inspectionRefs: [], findingIds: [], findingRefs: [], templateIds: [] };
  let seq = 0;
  const trackInsp = (id, ref) => { if (id) ctx.inspectionIds.push(id); if (ref) ctx.inspectionRefs.push(ref); };

  const mkInspection = (over = {}) => ({
    title:          `${TAG} Inspection ${++seq}`,
    description:    'E2E inspection',
    inspectionType: 'housekeeping',
    priority:       'medium',
    siteId:         'E2E Site',
    area:           'Bay 3',
    dueAt:          new Date(Date.now() + 3 * 86400e3).toISOString(),
    ...over,
  });

  const createInspection = async (over = {}) => {
    const r = await api('hse/inspections/create', T.admin, mkInspection(over));
    ok(r, 'inspection create failed');
    trackInsp(r.body.data?.id, r.body.data?.inspectionNo);
    return r.body.data;
  };

  const waitFor = async (check, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await check()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };
  const status  = async (id) => (await sb.from('hse_inspections').select('status').eq('id', id).single()).data?.status;
  const fStatus = async (id) => (await sb.from('hse_inspection_findings').select('status').eq('id', id).single()).data?.status;

  h.onCleanup(async () => {
    const refs = [...ctx.inspectionRefs, ...ctx.findingRefs];
    try { if (refs.length) await sb.from('app_events').delete().in('source_entity_id', refs); } catch {}
    try { await sb.from('notifications').delete().ilike('title', `%${TAG}%`); } catch {}
    // Tag-based sweep (belt-and-suspenders): catches any row not tracked by id —
    // every test inspection/finding title carries the TAG. Findings first (FK).
    try { await sb.from('hse_inspection_findings').delete().ilike('title', `%${TAG}%`); } catch {}
    try { await sb.from('hse_inspections').delete().ilike('title', `%${TAG}%`); } catch {}
    try { await sb.from('hse_inspection_templates').delete().ilike('name', `%${TAG}%`); } catch {}
  });

  // ── Templates ───────────────────────────────────────────────────────────────
  h.section('Inspections › Templates');

  let tplId, criticalItemId;
  await test('inspection-templates/create with items', async () => {
    const r = await api('hse/inspection-templates/create', T.admin, {
      name: `${TAG} Housekeeping Checklist`, inspectionType: 'housekeeping',
      description: 'E2E template',
      items: [
        { question: 'Walkways clear of obstructions?', responseType: 'pass_fail_na', isRequired: true, isCritical: false },
        { question: 'Emergency exits unobstructed?', responseType: 'pass_fail_na', isRequired: true, isCritical: true, autoCreateFindingOnFail: true },
      ],
    });
    ok(r);
    tplId = r.body.data?.id;
    expect(tplId, 'no template id');
    ctx.templateIds.push(tplId);
  });
  await test('inspection-templates/get returns sections + items', async () => {
    const r = await api('hse/inspection-templates/get', T.admin, { templateId: tplId });
    ok(r);
    expect(r.body.data?.template, 'template missing');
    expect(Array.isArray(r.body.data?.items), 'items not array');
    expect((r.body.data.items || []).length === 2, 'expected 2 items');
    const crit = (r.body.data.items || []).find(i => i.is_critical);
    expect(crit, 'critical item missing');
    criticalItemId = crit.id;
  });
  await test('inspection-templates/list contains the created template', async () => {
    const r = await api('hse/inspection-templates/list', T.admin, { inspectionType: 'housekeeping' });
    ok(r);
    expect((r.body.data || []).some(t => t.id === tplId), 'template not listed');
  });
  await test('inspection-templates/update edits name', async () => {
    ok(await api('hse/inspection-templates/update', T.admin, { templateId: tplId, name: `${TAG} Edited Checklist` }));
    const { data } = await sb.from('hse_inspection_templates').select('name').eq('id', tplId).single();
    expect((data?.name ?? '').includes('Edited'), 'name not updated');
  });
  await test('ACCESS: templates/list denied without auth', async () => {
    fails(await api('hse/inspection-templates/list', null));
  });

  // ── Inspections — create validation ───────────────────────────────────────────
  h.section('Inspections › Create validation');

  await test('VALIDATION: empty title → rejected', async () => {
    fails(await api('hse/inspections/create', T.admin, mkInspection({ title: '' })));
  });
  await test('VALIDATION: missing inspectionType → rejected', async () => {
    fails(await api('hse/inspections/create', T.admin, mkInspection({ inspectionType: '' })));
  });
  await test('VALIDATION: invalid priority enum → rejected', async () => {
    fails(await api('hse/inspections/create', T.admin, mkInspection({ priority: 'urgent' })));
  });
  await test('VALIDATION: missing dueAt → rejected', async () => {
    fails(await api('hse/inspections/create', T.admin, mkInspection({ dueAt: '' })));
  });
  await test('ACCESS: create denied without auth', async () => {
    fails(await api('hse/inspections/create', null, mkInspection()));
  });

  // ── Inspections — create happy path + side-effects ────────────────────────────
  h.section('Inspections › Create happy path');

  let created;
  await test('create inspection returns id / inspectionNo (scheduled)', async () => {
    created = await createInspection();
    expect(created?.id, 'no id');
    expect(created?.inspectionNo, 'no inspectionNo');
    expect(await status(created.id) === 'scheduled', `expected scheduled, got ${await status(created.id)}`);
  });
  await test('SIDE-EFFECT: hse.inspection.created app_event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'hse.inspection.created')
        .order('created_at', { ascending: false }).limit(10);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.inspection.created event not emitted');
  });
  await test('SIDE-EFFECT: audit "created" row written', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('hse_inspection_audit_events').select('id')
        .eq('entity_type', 'inspection').eq('entity_id', created.id).eq('action', 'created').limit(1);
      return (data ?? []).length > 0;
    });
    expect(found, 'created audit event not written');
  });
  await test('create as draft (scheduleImmediately=false)', async () => {
    const d = await createInspection({ scheduleImmediately: false });
    expect(await status(d.id) === 'draft', `expected draft, got ${await status(d.id)}`);
  });

  // ── Inspections — list & get ──────────────────────────────────────────────────
  h.section('Inspections › List & Get');

  await test('inspections/list response shape (FE contract)', async () => {
    const r = await api('hse/inspections/list', T.admin, { limit: 200 });
    ok(r);
    const row = (r.body.data || []).find(x => x.id === created.id);
    expect(row, 'created inspection not in list');
    for (const f of ['id', 'inspection_no', 'title', 'inspection_type', 'priority', 'status', 'site_id', 'due_at', 'created_at']) {
      expect(f in row, `list row missing field: ${f}`);
    }
  });
  await test('inspections/list filters by status', async () => {
    const r = await api('hse/inspections/list', T.admin, { status: 'scheduled', limit: 50 });
    ok(r);
    expect((r.body.data || []).every(x => x.status === 'scheduled'), 'status filter leaked');
  });
  await test('inspections/get returns inspection + arrays', async () => {
    const r = await api('hse/inspections/get', T.admin, { inspectionId: created.id });
    ok(r);
    const d = r.body.data;
    expect(d?.inspection, 'inspection missing');
    for (const f of ['checklist', 'responses', 'findings', 'evidence', 'audit']) {
      expect(Array.isArray(d?.[f]), `${f} not an array`);
    }
  });
  await test('inspections/get non-existent → failure', async () => {
    fails(await api('hse/inspections/get', T.admin, { inspectionId: '00000000-0000-0000-0000-000000000000' }));
  });

  // ── Inspections — update ──────────────────────────────────────────────────────
  h.section('Inspections › Update');

  await test('inspections/update edits title + priority', async () => {
    ok(await api('hse/inspections/update', T.admin, { inspectionId: created.id, title: `${TAG} Updated`, priority: 'high' }));
    const { data } = await sb.from('hse_inspections').select('title, priority').eq('id', created.id).single();
    expect((data?.title ?? '').includes('Updated'), 'title not updated');
    expect(data?.priority === 'high', 'priority not updated');
  });

  // ── Checklist execution + auto-finding ────────────────────────────────────────
  h.section('Inspections › Checklist execution');

  let checkInsp;
  await test('start a templated inspection (scheduled → in_progress)', async () => {
    checkInsp = await createInspection({ templateId: tplId });
    ok(await api('hse/inspections/start', T.admin, { inspectionId: checkInsp.id }));
    expect(await status(checkInsp.id) === 'in_progress', 'not in_progress');
  });
  await test('responses/save: failed critical item auto-creates a finding', async () => {
    const r = await api('hse/inspections/responses/save', T.admin, {
      inspectionId: checkInsp.id, templateItemId: criticalItemId, responseStatus: 'failed', comment: 'exit blocked by pallets',
    });
    ok(r);
    expect(r.body.data?.findingId, 'no auto-finding created for failed critical item');
    ctx.findingIds.push(r.body.data.findingId);
    const { data } = await sb.from('hse_inspection_findings').select('finding_no, severity').eq('id', r.body.data.findingId).single();
    if (data?.finding_no) ctx.findingRefs.push(data.finding_no);
    expect(data?.severity === 'critical', `expected critical severity, got ${data?.severity}`);
  });
  await test('GATE: submit blocked while required item unanswered', async () => {
    // The non-critical required item is still unanswered → submit should fail
    fails(await api('hse/inspections/submit', T.admin, { inspectionId: checkInsp.id }), 'submit should require all required items answered');
  });
  await test('answer remaining required item then submit succeeds', async () => {
    const items = await api('hse/inspections/get', T.admin, { inspectionId: checkInsp.id });
    const otherItem = (items.body.data.checklist || []).find(i => i.id !== criticalItemId);
    ok(await api('hse/inspections/responses/save', T.admin, { inspectionId: checkInsp.id, templateItemId: otherItem.id, responseStatus: 'passed' }));
    ok(await api('hse/inspections/submit', T.admin, { inspectionId: checkInsp.id }));
    expect(await status(checkInsp.id) === 'submitted', 'not submitted');
  });
  await test('review completes the inspection (submitted → completed)', async () => {
    ok(await api('hse/inspections/review', T.admin, { inspectionId: checkInsp.id }));
    expect(await status(checkInsp.id) === 'completed', 'not completed');
  });

  // ── Inspection lifecycle (no template) ────────────────────────────────────────
  h.section('Inspections › Lifecycle');

  await test('lifecycle: start → submit → review for a template-less inspection', async () => {
    const d = await createInspection();
    ok(await api('hse/inspections/start', T.admin, { inspectionId: d.id }));
    expect(await status(d.id) === 'in_progress', 'not in_progress');
    ok(await api('hse/inspections/submit', T.admin, { inspectionId: d.id }));
    expect(await status(d.id) === 'submitted', 'not submitted');
    ok(await api('hse/inspections/review', T.admin, { inspectionId: d.id }));
    expect(await status(d.id) === 'completed', 'not completed');
  });
  await test('GATE: illegal transition rejected (completed → start)', async () => {
    const d = await createInspection();
    await sb.from('hse_inspections').update({ status: 'completed' }).eq('id', d.id);
    fails(await api('hse/inspections/start', T.admin, { inspectionId: d.id }), 'completed is terminal for start');
  });
  await test('reschedule sets a new due date and status scheduled', async () => {
    const d = await createInspection();
    await sb.from('hse_inspections').update({ status: 'overdue' }).eq('id', d.id);
    const newDue = new Date(Date.now() + 10 * 86400e3).toISOString();
    ok(await api('hse/inspections/reschedule', T.admin, { inspectionId: d.id, newDueAt: newDue, reason: 'inspector unavailable' }));
    const { data } = await sb.from('hse_inspections').select('status').eq('id', d.id).single();
    expect(data?.status === 'scheduled', 'not rescheduled to scheduled');
  });
  await test('cancel a scheduled inspection', async () => {
    const d = await createInspection();
    ok(await api('hse/inspections/cancel', T.admin, { inspectionId: d.id, note: 'duplicate' }));
    expect(await status(d.id) === 'cancelled', 'not cancelled');
  });
  await test('SIDE-EFFECT: hse.inspection.completed app_event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'hse.inspection.completed')
        .order('created_at', { ascending: false }).limit(10);
      return (data ?? []).length > 0;
    });
    expect(found, 'completed event not emitted');
  });

  // ── Findings ──────────────────────────────────────────────────────────────────
  h.section('Inspections › Findings');

  let finding;
  await test('responses/create-finding (manual) returns id', async () => {
    const r = await api('hse/inspections/responses/create-finding', T.admin, {
      inspectionId: created.id, title: `${TAG} Spill not cleaned`, severity: 'high', area: 'Bay 3',
    });
    ok(r);
    finding = r.body.data?.id;
    expect(finding, 'no finding id');
    ctx.findingIds.push(finding);
    const { data } = await sb.from('hse_inspection_findings').select('finding_no').eq('id', finding).single();
    if (data?.finding_no) ctx.findingRefs.push(data.finding_no);
  });
  await test('SIDE-EFFECT: hse.inspection_finding.created app_event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'hse.inspection_finding.created')
        .order('created_at', { ascending: false }).limit(10);
      return (data ?? []).length > 0;
    });
    expect(found, 'finding created event not emitted');
  });
  await test('inspection-findings/list filters by inspection', async () => {
    const r = await api('hse/inspection-findings/list', T.admin, { inspectionId: created.id });
    ok(r);
    expect((r.body.data || []).some(f => f.id === finding), 'finding not listed');
  });
  await test('inspection-findings/get returns finding + actions/evidence/audit', async () => {
    const r = await api('hse/inspection-findings/get', T.admin, { findingId: finding });
    ok(r);
    expect(r.body.data?.finding, 'finding missing');
    for (const f of ['actions', 'evidence', 'audit']) expect(Array.isArray(r.body.data?.[f]), `${f} not array`);
  });
  await test('assign-action moves finding to assigned + creates action', async () => {
    const r = await api('hse/inspection-findings/assign-action', T.admin, {
      findingId: finding, actionDescription: 'Clean the spill and barrier the area', ownerId: b.id,
      dueAt: new Date(Date.now() + 2 * 86400e3).toISOString(),
    });
    ok(r);
    expect(r.body.data?.id, 'no action id');
    expect(await fStatus(finding) === 'assigned', 'finding not assigned');
  });
  await test('actions/update marks the action completed', async () => {
    const got = await api('hse/inspection-findings/get', T.admin, { findingId: finding });
    const actionId = got.body.data.actions[0].id;
    ok(await api('hse/inspection-findings/actions/update', T.admin, { actionId, status: 'completed' }));
    const { data } = await sb.from('hse_inspection_finding_actions').select('status').eq('id', actionId).single();
    expect(data?.status === 'completed', 'action not completed');
  });
  await test('close finding (→ closed via awaiting_review)', async () => {
    ok(await api('hse/inspection-findings/close', T.admin, { findingId: finding, note: 'verified clean' }));
    expect(await fStatus(finding) === 'closed', 'finding not closed');
  });
  await test('reopen finding (closed → reopened)', async () => {
    ok(await api('hse/inspection-findings/reopen', T.admin, { findingId: finding, note: 'recurred' }));
    expect(await fStatus(finding) === 'reopened', 'finding not reopened');
  });
  await test('escalate finding bumps severity to critical', async () => {
    const d = await api('hse/inspections/responses/create-finding', T.admin, { inspectionId: created.id, title: `${TAG} Minor`, severity: 'low' });
    ok(d); ctx.findingIds.push(d.body.data.id);
    ok(await api('hse/inspection-findings/escalate', T.admin, { findingId: d.body.data.id, note: 'risk higher than first assessed' }));
    const { data } = await sb.from('hse_inspection_findings').select('severity').eq('id', d.body.data.id).single();
    expect(data?.severity === 'critical', 'not escalated to critical');
  });

  // ── Evidence ──────────────────────────────────────────────────────────────────
  h.section('Inspections › Evidence');

  await test('evidence/add records a metadata row on a finding', async () => {
    const r = await api('hse/inspections/evidence/add', T.admin, {
      findingId: finding, fileName: 'spill.jpg', filePath: `inspections/${finding}/spill.jpg`, evidenceType: 'photo',
    });
    ok(r);
    expect(r.body.data?.id, 'no evidence id');
  });
  await test('VALIDATION: evidence without inspection or finding → rejected', async () => {
    fails(await api('hse/inspections/evidence/add', T.admin, { fileName: 'x.pdf', filePath: 'x.pdf' }));
  });

  // ── Stats / dashboard ─────────────────────────────────────────────────────────
  h.section('Inspections › Stats');

  await test('inspections/stats returns the card contract', async () => {
    const r = await api('hse/inspections/stats', T.admin);
    ok(r);
    const d = r.body.data;
    for (const f of ['scheduledThisMonth', 'overdue', 'dueThisWeek', 'completedYtd', 'completionRate', 'openFindings', 'criticalFindings', 'closedFindingsYtd', 'closureRate']) {
      expect(typeof d?.[f] === 'number', `stats.${f} missing/not a number`);
    }
  });
  await test('inspections/dashboard returns the same contract', async () => {
    const r = await api('hse/inspections/dashboard', T.admin);
    ok(r);
    expect(typeof r.body.data?.completionRate === 'number', 'dashboard.completionRate missing');
  });

  // ── Access control (negative paths) ───────────────────────────────────────────
  h.section('Inspections › Access control');

  await test('ACCESS: core endpoints deny without auth', async () => {
    for (const p of ['hse/inspections/list', 'hse/inspections/stats', 'hse/inspection-findings/list', 'hse/inspection-templates/list']) {
      fails(await api(p, null, {}), `${p} should deny without auth`);
    }
  });
  await test('ACCESS: non-privileged user B denied on review + manage actions', async () => {
    fails(await api('hse/inspections/review', T.b, { inspectionId: created.id }), 'B should not review');
    fails(await api('hse/inspection-findings/close', T.b, { findingId: finding }), 'B should not close findings');
  });
}
