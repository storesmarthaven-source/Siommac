/**
 * scripts/e2e/suites/ptw.mjs
 *
 * Comprehensive E2E test suite for the HSE Permit-to-Work (PTW) module.
 * Follows the reference implementation (communications.mjs / riskjsa.mjs).
 *
 * Backend route: hsePtw.ts, mounted at /api/hse/. Covers:
 *   ptw/permit-types/list
 *   ptw/permits/{list,get,create,update,save-draft,stats}
 *   ptw/permits/{submit,approve,reject,request-changes,activate,suspend,
 *                revalidate,request-extension,approve-extension,
 *                reject-extension,close,cancel,archive}
 *   ptw/permits/isolations/{list,create,apply,verify,reject,remove}
 *   ptw/permits/simops/{list,check,resolve,approve-override}
 *   ptw/permits/approvals/{list,decide}
 *   ptw/permit-templates/{list,create,update,duplicate,deactivate}
 *
 * Permissions: hse.ptw.view · hse.ptw.create · hse.ptw.approve ·
 *              hse.ptw.activate · hse.ptw.manage
 *
 * Gas Testing has been REMOVED — this suite asserts the gas-test endpoints are
 * gone and the permit detail no longer carries a gas_tests key.
 *
 * The /advance endpoint walks the review chain (submitted → risk_review →
 * [isolation_pending] → awaiting_approval) so approvals are reachable purely via
 * the API; the lifecycle tests exercise it end-to-end.
 */

export const title = 'HSE Permit-to-Work (PTW)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  const ctx = { permitIds: [], permitRefs: [], templateIds: [] };
  let seq = 0;
  const track = (id, ref) => { if (id) ctx.permitIds.push(id); if (ref) ctx.permitRefs.push(ref); };

  const mkPermit = (over = {}) => ({
    permitType:       'general_work',
    title:            `${TAG} Permit ${++seq}`,
    description:      'E2E permit',
    siteId:           'E2E Site',
    riskLevel:        'low',
    startDatetime:    new Date(Date.now() + 3600e3).toISOString(),
    endDatetime:      new Date(Date.now() + 6 * 3600e3).toISOString(),
    ...over,
  });

  const createPermit = async (over = {}) => {
    const r = await api('hse/ptw/permits/create', T.admin, mkPermit(over));
    ok(r, 'permit create failed');
    track(r.body.data?.id, r.body.data?.permitNo);
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
  const status = async (id) => (await sb.from('hse_permits').select('status').eq('id', id).single()).data?.status;

  h.onCleanup(async () => {
    // NOTE: supabase-js query builders are thenables, NOT real Promises — they have
    // no `.catch()`. Use h.mustDelete (surfaces the error) instead of `.catch(()=>{})`.
    if (ctx.templateIds.length) await h.mustDelete('hse_permit_templates', q => q.in('id', ctx.templateIds));
    if (ctx.permitIds.length) {
      const routes = ctx.permitIds.map(id => `hse/permits/${id}`);
      await h.mustDelete('notifications', q => q.in('action_route', routes));
      if (ctx.permitRefs.length) await h.mustDelete('app_events', q => q.in('source_entity_id', ctx.permitRefs));
      // children cascade from hse_permits (on delete cascade)
      await h.mustDelete('hse_permits', q => q.in('id', ctx.permitIds));
    }
  });

  // ── Permit types ──────────────────────────────────────────────────────────────
  h.section('PTW › Permit types');

  await test('permit-types/list returns active types with flags', async () => {
    const r = await api('hse/ptw/permit-types/list', T.admin);
    ok(r);
    expect(Array.isArray(r.body.data), 'data not array');
    expect((r.body.data || []).length > 0, 'no permit types seeded');
    const row = r.body.data[0];
    for (const f of ['permit_type', 'display_name', 'requires_jsa', 'requires_isolation', 'max_duration_hours']) {
      expect(row[f] !== undefined, `type row missing: ${f}`);
    }
  });
  await test('REMOVED: permit type no longer exposes requires_gas_test', async () => {
    const r = await api('hse/ptw/permit-types/list', T.admin);
    ok(r);
    expect((r.body.data || []).every(t => !('requires_gas_test' in t)), 'requires_gas_test still present on type config');
  });
  await test('ACCESS: permit-types/list denied without auth', async () => {
    fails(await api('hse/ptw/permit-types/list', null));
  });

  // ── Permits — list & shape ──────────────────────────────────────────────────
  h.section('PTW › Permits — List');

  await test('permits/list returns array', async () => {
    const r = await api('hse/ptw/permits/list', T.admin, { limit: 10 });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('permits/list response shape (contract the FE consumes)', async () => {
    await createPermit();
    const r = await api('hse/ptw/permits/list', T.admin, { limit: 200 });
    ok(r);
    const row = (r.body.data || [])[0];
    expect(row, 'no rows after create');
    for (const f of ['id', 'permit_number', 'title', 'permit_type', 'risk_level', 'status',
                     'site_id', 'specific_location', 'requester_id', 'start_datetime', 'end_datetime', 'created_at']) {
      expect(f in row, `list row missing field: ${f}`);
    }
  });
  await test('permits/list filters by status', async () => {
    const r = await api('hse/ptw/permits/list', T.admin, { status: 'draft', limit: 50 });
    ok(r);
    expect((r.body.data || []).every(p => p.status === 'draft'), 'status filter leaked other statuses');
  });
  await test('permits/list filters by permitType', async () => {
    const r = await api('hse/ptw/permits/list', T.admin, { permitType: 'general_work', limit: 50 });
    ok(r);
    expect((r.body.data || []).every(p => p.permit_type === 'general_work'), 'permitType filter leaked');
  });
  await test('ACCESS: permits/list denied without auth', async () => {
    fails(await api('hse/ptw/permits/list', null));
  });

  // ── Permits — create validation ─────────────────────────────────────────────
  h.section('PTW › Permits — Create validation');

  await test('VALIDATION: empty title → rejected', async () => {
    fails(await api('hse/ptw/permits/create', T.admin, mkPermit({ title: '' })));
  });
  await test('VALIDATION: missing permitType → rejected', async () => {
    fails(await api('hse/ptw/permits/create', T.admin, mkPermit({ permitType: '' })));
  });
  await test('VALIDATION: unknown permitType → rejected', async () => {
    fails(await api('hse/ptw/permits/create', T.admin, mkPermit({ permitType: 'not_a_real_type' })));
  });
  await test('VALIDATION: invalid riskLevel enum → rejected', async () => {
    fails(await api('hse/ptw/permits/create', T.admin, mkPermit({ riskLevel: 'extreme' })));
  });
  await test('VALIDATION: title > 300 chars → rejected', async () => {
    fails(await api('hse/ptw/permits/create', T.admin, mkPermit({ title: 'x'.repeat(301) })));
  });
  await test('ACCESS: permits/create denied without auth', async () => {
    fails(await api('hse/ptw/permits/create', null, mkPermit()));
  });

  // ── Permits — create happy path + side-effects ──────────────────────────────
  h.section('PTW › Permits — Create happy path');

  let created;
  await test('create permit (draft) returns id / permitNo / status', async () => {
    created = await createPermit();
    expect(created?.id, 'no id');
    expect(created?.permitNo, 'no permitNo');
    expect(created?.status === 'draft', `expected draft, got ${created?.status}`);
  });
  await test('SIDE-EFFECT: permit row in DB with requires_* sourced from type config', async () => {
    const { data } = await sb.from('hse_permits').select('status, requires_jsa, requires_isolation').eq('id', created.id).single();
    expect(data?.status === 'draft', 'row not draft');
    expect(typeof data?.requires_jsa === 'boolean', 'requires_jsa not set');
  });
  await test('SIDE-EFFECT: hse.permit.created app_event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'hse.permit.created')
        .order('created_at', { ascending: false }).limit(10);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.permit.created event not emitted');
  });
  await test('SIDE-EFFECT: hse_permit_audit_events has a "created" row', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('hse_permit_audit_events').select('id').eq('permit_id', created.id).eq('action', 'created').limit(1);
      return (data ?? []).length > 0;
    });
    expect(found, 'created audit event not written');
  });
  await test('create with submitImmediately → status submitted', async () => {
    const d = await createPermit({ submitImmediately: true });
    expect(d?.status === 'submitted', `expected submitted, got ${d?.status}`);
  });

  // ── Permits — get / detail ──────────────────────────────────────────────────
  h.section('PTW › Permits — Get / detail');

  await test('permits/get returns full payload with sub-register arrays', async () => {
    const r = await api('hse/ptw/permits/get', T.admin, { permitId: created.id });
    ok(r);
    const d = r.body.data;
    expect(d?.permit, 'permit missing');
    for (const f of ['hazards', 'controls', 'approvals', 'isolations', 'simops', 'extensions', 'suspensions', 'attachments', 'timeline']) {
      expect(Array.isArray(d?.[f]), `${f} not an array`);
    }
    expect(d?.permitRef, 'permitRef missing');
  });
  await test('REMOVED: permit detail no longer carries a gas_tests key', async () => {
    const r = await api('hse/ptw/permits/get', T.admin, { permitId: created.id });
    ok(r);
    expect(!('gas_tests' in (r.body.data || {})), 'gas_tests key still present in permit detail');
  });
  await test('permits/get without args → failure', async () => {
    fails(await api('hse/ptw/permits/get', T.admin, {}));
  });
  await test('permits/get non-existent → failure', async () => {
    fails(await api('hse/ptw/permits/get', T.admin, { permitId: '00000000-0000-0000-0000-000000000000' }));
  });

  // ── Permits — update ────────────────────────────────────────────────────────
  h.section('PTW › Permits — Update');

  await test('permits/update edits a draft', async () => {
    ok(await api('hse/ptw/permits/update', T.admin, { permitId: created.id, title: `${TAG} Updated Title` }));
    const { data } = await sb.from('hse_permits').select('title').eq('id', created.id).single();
    expect((data?.title ?? '').includes('Updated Title'), 'title not updated');
  });
  await test('VALIDATION: update non-UUID permitId → rejected', async () => {
    fails(await api('hse/ptw/permits/update', T.admin, { permitId: 'not-a-uuid', title: 'x' }));
  });
  await test('GATE: update rejected once permit leaves draft/changes_requested', async () => {
    const d = await createPermit();
    await sb.from('hse_permits').update({ status: 'active' }).eq('id', d.id);
    fails(await api('hse/ptw/permits/update', T.admin, { permitId: d.id, title: 'nope' }), 'active permit should not be editable');
  });

  // ── Permits — lifecycle ─────────────────────────────────────────────────────
  h.section('PTW › Permits — Lifecycle (full chain)');

  let life;
  await test('lifecycle: submit (draft → submitted)', async () => {
    life = await createPermit();
    ok(await api('hse/ptw/permits/submit', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'submitted', 'not submitted');
  });
  await test('SIDE-EFFECT: "submitted" audit event written', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('hse_permit_audit_events').select('id').eq('permit_id', life.id).eq('action', 'submitted').limit(1);
      return (data ?? []).length > 0;
    });
    expect(found, 'submitted audit event missing');
  });
  await test('lifecycle: advance (submitted → risk_review → awaiting_approval)', async () => {
    ok(await api('hse/ptw/permits/advance', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'risk_review', `expected risk_review, got ${await status(life.id)}`);
    ok(await api('hse/ptw/permits/advance', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'awaiting_approval', `expected awaiting_approval, got ${await status(life.id)}`);
  });
  await test('lifecycle: approve (awaiting_approval → approved)', async () => {
    ok(await api('hse/ptw/permits/approve', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'approved', 'not approved');
  });
  await test('lifecycle: activate (approved → active) passes the gate', async () => {
    ok(await api('hse/ptw/permits/activate', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'active', 'not active');
  });
  await test('lifecycle: suspend (active → suspended)', async () => {
    ok(await api('hse/ptw/permits/suspend', T.admin, { permitId: life.id, note: 'E2E suspend' }));
    expect(await status(life.id) === 'suspended', 'not suspended');
  });
  await test('lifecycle: revalidate (suspended → active)', async () => {
    ok(await api('hse/ptw/permits/revalidate', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'active', 'not re-activated');
  });
  await test('lifecycle: close (active → closed)', async () => {
    ok(await api('hse/ptw/permits/close', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'closed', 'not closed');
  });
  await test('lifecycle: archive (closed → archived)', async () => {
    ok(await api('hse/ptw/permits/archive', T.admin, { permitId: life.id }));
    expect(await status(life.id) === 'archived', 'not archived');
  });
  await test('GATE: illegal transition rejected (archived → approve)', async () => {
    fails(await api('hse/ptw/permits/approve', T.admin, { permitId: life.id }), 'archived is terminal');
  });

  await test('lifecycle: reject from awaiting_approval (reached via advance)', async () => {
    const d = await createPermit({ submitImmediately: true });
    ok(await api('hse/ptw/permits/advance', T.admin, { permitId: d.id }));
    ok(await api('hse/ptw/permits/advance', T.admin, { permitId: d.id }));
    expect(await status(d.id) === 'awaiting_approval', 'advance did not reach awaiting_approval');
    ok(await api('hse/ptw/permits/reject', T.admin, { permitId: d.id, note: 'insufficient controls' }));
    expect(await status(d.id) === 'rejected', 'not rejected');
  });
  await test('lifecycle: request-changes from awaiting_approval (reached via advance)', async () => {
    const d = await createPermit({ submitImmediately: true });
    ok(await api('hse/ptw/permits/advance', T.admin, { permitId: d.id }));
    ok(await api('hse/ptw/permits/advance', T.admin, { permitId: d.id }));
    ok(await api('hse/ptw/permits/request-changes', T.admin, { permitId: d.id, note: 'add isolation plan' }));
    expect(await status(d.id) === 'changes_requested', 'not changes_requested');
  });
  await test('GATE: advance from draft → rejected', async () => {
    const d = await createPermit();
    fails(await api('hse/ptw/permits/advance', T.admin, { permitId: d.id }), 'cannot advance a draft');
  });
  await test('lifecycle: cancel a draft', async () => {
    const d = await createPermit();
    ok(await api('hse/ptw/permits/cancel', T.admin, { permitId: d.id, note: 'no longer needed' }));
    expect(await status(d.id) === 'cancelled', 'not cancelled');
  });
  await test('extension: request-extension (active → extension_requested)', async () => {
    const d = await createPermit();
    await sb.from('hse_permits').update({ status: 'active' }).eq('id', d.id);
    const r = await api('hse/ptw/permits/request-extension', T.admin, {
      permitId: d.id, newEnd: new Date(Date.now() + 24 * 3600e3).toISOString(), reason: 'work overran',
    });
    ok(r);
    expect(await status(d.id) === 'extension_requested', 'not extension_requested');
    ok(await api('hse/ptw/permits/approve-extension', T.admin, { permitId: d.id }));
    expect(await status(d.id) === 'active', 'extension not approved back to active');
  });

  // ── Isolations sub-register ─────────────────────────────────────────────────
  h.section('PTW › Isolations sub-register');

  let isoPermit, isoId;
  await test('isolations/create inserts a pending point', async () => {
    isoPermit = await createPermit({ permitType: 'electrical_work' });
    const r = await api('hse/ptw/permits/isolations/create', T.admin, {
      permitId: isoPermit.id, isolationType: 'loto', isolationPoint: `${TAG} Breaker A`, tagNumber: 'LO-E2E',
    });
    ok(r);
    isoId = r.body.data?.id;
    expect(isoId, 'no isolation id');
    const { data } = await sb.from('hse_permit_isolations').select('status').eq('id', isoId).single();
    expect(data?.status === 'pending', `expected pending, got ${data?.status}`);
  });
  await test('isolations/list returns the created point', async () => {
    const r = await api('hse/ptw/permits/isolations/list', T.admin, { permitId: isoPermit.id });
    ok(r);
    expect((r.body.data || []).some(i => i.id === isoId), 'isolation not listed');
  });
  await test('isolations/apply (pending → applied)', async () => {
    ok(await api('hse/ptw/permits/isolations/apply', T.admin, { isolationId: isoId }));
    const { data } = await sb.from('hse_permit_isolations').select('status').eq('id', isoId).single();
    expect(data?.status === 'applied', `expected applied, got ${data?.status}`);
  });
  await test('GATE: same person cannot verify what they applied', async () => {
    fails(await api('hse/ptw/permits/isolations/verify', T.admin, { isolationId: isoId }), 'applier must not be the verifier');
  });
  await test('GATE: cannot apply an already-applied isolation', async () => {
    fails(await api('hse/ptw/permits/isolations/apply', T.admin, { isolationId: isoId }), 'apply twice should fail');
  });

  // ── SIMOPS sub-register ─────────────────────────────────────────────────────
  h.section('PTW › SIMOPS sub-register');

  await test('simops/check runs and returns a conflict count', async () => {
    const r = await api('hse/ptw/permits/simops/check', T.admin, { permitId: isoPermit.id });
    ok(r);
    expect(typeof r.body.data?.conflictsFound === 'number', 'no conflictsFound count');
  });
  await test('simops/list returns array', async () => {
    const r = await api('hse/ptw/permits/simops/list', T.admin, { permitId: isoPermit.id });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });

  // ── Approvals sub-register ──────────────────────────────────────────────────
  h.section('PTW › Approvals sub-register');

  await test('approvals/list returns array', async () => {
    const r = await api('hse/ptw/permits/approvals/list', T.admin, { permitId: created.id });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('approvals/decide records a decision', async () => {
    const ap = await createPermit();
    const { data: row } = await sb.from('hse_permit_approvals')
      .insert({ permit_id: ap.id, step_order: 0, role_required: 'Area Authority', status: 'pending' })
      .select('id').single();
    expect(row?.id, 'could not seed approval row');
    ok(await api('hse/ptw/permits/approvals/decide', T.admin, { approvalId: row.id, decision: 'approved', comments: 'looks good' }));
    const { data } = await sb.from('hse_permit_approvals').select('status').eq('id', row.id).single();
    expect(data?.status === 'approved', `expected approved, got ${data?.status}`);
  });
  await test('VALIDATION: approvals/decide invalid decision enum → rejected', async () => {
    fails(await api('hse/ptw/permits/approvals/decide', T.admin, { approvalId: '00000000-0000-0000-0000-000000000000', decision: 'maybe' }));
  });

  // ── Stats ───────────────────────────────────────────────────────────────────
  h.section('PTW › Stats');

  await test('permits/stats returns the exact card contract', async () => {
    const r = await api('hse/ptw/permits/stats', T.admin);
    ok(r);
    const d = r.body.data;
    expect(typeof d?.activePermits?.total === 'number', 'activePermits.total missing');
    expect(typeof d?.activePermits?.highRisk === 'number', 'activePermits.highRisk missing');
    expect(Array.isArray(d?.activePermits?.byType), 'activePermits.byType not array');
    expect(typeof d?.expiringSoon?.total === 'number', 'expiringSoon.total missing');
    expect(typeof d?.expiringSoon?.withinTwoHours === 'number', 'expiringSoon.withinTwoHours missing');
    expect(Array.isArray(d?.expiringSoon?.buckets), 'expiringSoon.buckets not array');
    expect(typeof d?.isolationReadiness?.percentage === 'number', 'isolationReadiness.percentage missing');
    expect(typeof d?.approvalBottlenecks?.total === 'number', 'approvalBottlenecks.total missing');
    expect(Array.isArray(d?.approvalBottlenecks?.byStage), 'approvalBottlenecks.byStage not array');
  });
  await test('ACCESS: stats denied without auth', async () => {
    fails(await api('hse/ptw/permits/stats', null));
  });

  // ── Templates ───────────────────────────────────────────────────────────────
  h.section('PTW › Templates');

  let tplId;
  await test('permit-templates/create', async () => {
    const r = await api('hse/ptw/permit-templates/create', T.admin, {
      name: `${TAG} Template`, permitType: 'hot_work', riskLevel: 'high', requiresJsa: true, requiresIsolation: true,
    });
    ok(r);
    tplId = r.body.data?.id;
    expect(tplId, 'no template id');
    ctx.templateIds.push(tplId);
  });
  await test('REMOVED: template create ignores requiresGasTest (no column)', async () => {
    const r = await api('hse/ptw/permit-templates/create', T.admin, {
      name: `${TAG} Template NoGas`, permitType: 'general_work', requiresGasTest: true,
    });
    ok(r, 'create should still succeed, extra field ignored');
    if (r.body.data?.id) ctx.templateIds.push(r.body.data.id);
    const { data } = await sb.from('hse_permit_templates').select('*').eq('id', r.body.data.id).single();
    expect(!('requires_gas_test' in (data || {})), 'requires_gas_test column still exists on templates');
  });
  await test('permit-templates/list contains the created template', async () => {
    const r = await api('hse/ptw/permit-templates/list', T.admin);
    ok(r);
    expect((r.body.data || []).some(t => t.id === tplId), 'template not listed');
    expect((r.body.data || []).every(t => !('requires_gas_test' in t)), 'list still exposes requires_gas_test');
  });
  await test('permit-templates/update edits a field', async () => {
    ok(await api('hse/ptw/permit-templates/update', T.admin, { templateId: tplId, name: `${TAG} Template Edited` }));
    const { data } = await sb.from('hse_permit_templates').select('name').eq('id', tplId).single();
    expect((data?.name ?? '').includes('Edited'), 'template name not updated');
  });
  await test('permit-templates/duplicate copies the row', async () => {
    const r = await api('hse/ptw/permit-templates/duplicate', T.admin, { templateId: tplId });
    ok(r);
    expect(r.body.data?.id, 'no duplicate id');
    ctx.templateIds.push(r.body.data.id);
  });
  await test('permit-templates/deactivate flips active', async () => {
    ok(await api('hse/ptw/permit-templates/deactivate', T.admin, { templateId: tplId, active: false }));
    const { data } = await sb.from('hse_permit_templates').select('active').eq('id', tplId).single();
    expect(data?.active === false, 'template not deactivated');
  });

  // ── Gas Testing removal — endpoints gone ────────────────────────────────────
  h.section('PTW › Gas Testing removed');

  await test('gas-tests/list endpoint is gone', async () => {
    fails(await api('hse/ptw/permits/gas-tests/list', T.admin, { permitId: created.id }), 'gas-tests/list should not exist');
  });
  await test('gas-tests/create endpoint is gone', async () => {
    fails(await api('hse/ptw/permits/gas-tests/create', T.admin, { permitId: created.id, testLocation: 'x', result: 'pass' }), 'gas-tests/create should not exist');
  });

  // ── Access control (negative paths) ─────────────────────────────────────────
  h.section('PTW › Access control (negative paths)');

  await test('ACCESS: core endpoints deny without auth', async () => {
    for (const p of ['hse/ptw/permits/list', 'hse/ptw/permits/stats', 'hse/ptw/permit-types/list', 'hse/ptw/permit-templates/list']) {
      fails(await api(p, null, {}), `${p} should deny without auth`);
    }
  });
  await test('ACCESS: non-privileged user B denied on create + approve', async () => {
    fails(await api('hse/ptw/permits/create', T.b, mkPermit()), 'B should not create permits');
    fails(await api('hse/ptw/permits/approve', T.b, { permitId: created.id }), 'B should not approve permits');
  });
}
