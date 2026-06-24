/**
 * scripts/e2e/suites/riskjsa.mjs
 *
 * Comprehensive E2E test suite for the HSE Risk & JSA module.
 * Follows the reference implementation (communications.mjs) exactly.
 *
 * Modules under test (backend route: hseRiskJsa.ts, mounted at /api/hse/):
 *   risk-jsa/summary
 *   risk-jsa/hazards/{list,create,detail,update,submit}
 *   risk-jsa/assessments/{list,create,detail,update,submit}
 *   risk-jsa/jsa/{list,create,detail,update,submit,acknowledge,from-assessment}
 *   risk-jsa/controls/{create,verify}
 *   risk-jsa/{approve,reject,request-changes,activate,close,archive}
 *   risk-jsa/review  (legacy)
 *   risk-jsa/queue
 *   risk-jsa/library/{hazards,controls}
 *   risk-jsa/templates/{list,duplicate}
 *   risk-jsa/attachments/{upload-url,create,list,delete}
 *
 * Permissions:
 *   hse.risk.view, hse.risk.manage, hse.risk.approve, hse.risk.library.manage
 *
 * VALIDATION FINDINGS documented inline with FINDING: comments.
 */

export const title = 'HSE Risk & JSA';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };

  const ctx = {
    hazardIds:     [],
    assessmentIds: [],
    jsaIds:        [],
    controlIds:    [],
    attachmentIds: [],
    templateIds:   [],
    crewIds:       [],
    hazardId:      null,
    hazardRef:     null,
    assessmentId:  null,
    assessmentRef: null,
    jsaId:         null,
    jsaRef:        null,
  };

  h.onCleanup(async () => {
    if (ctx.attachmentIds.length)
      await sb.from('attachments').delete().in('id', ctx.attachmentIds);
    if (ctx.controlIds.length)
      await sb.from('hse_controls').delete().in('id', ctx.controlIds);
    if (ctx.templateIds.length)
      await sb.from('workflow_templates').delete().in('id', ctx.templateIds);
    if (ctx.crewIds.length)
      await sb.from('hse_jsa_crew_acknowledgements').delete().in('id', ctx.crewIds);
    if (ctx.jsaIds.length) {
      await sb.from('hse_jsa_step_controls').delete().in(
        'step_hazard_id',
        (await sb.from('hse_jsa_step_hazards').select('id').in(
          'step_id', (await sb.from('hse_jsa_steps').select('id').in('jsa_id', ctx.jsaIds)).data?.map(s => s.id) ?? []
        )).data?.map(h => h.id) ?? []
      ).catch(() => {});
      await sb.from('hse_jsa_step_hazards').delete().in(
        'step_id', (await sb.from('hse_jsa_steps').select('id').in('jsa_id', ctx.jsaIds)).data?.map(s => s.id) ?? []
      ).catch(() => {});
      await sb.from('hse_jsa_steps').delete().in('jsa_id', ctx.jsaIds);
      await sb.from('hse_ppe_requirements').delete().eq('source_type', 'jsa').in('source_id', ctx.jsaIds);
      await sb.from('hse_training_links').delete().eq('source_type', 'jsa').in('source_id', ctx.jsaIds);
      await sb.from('hse_jsa_crew_acknowledgements').delete().in('jsa_id', ctx.jsaIds);
      await sb.from('hse_risk_jsa_links').delete().in('source_id', ctx.jsaIds);
      await sb.from('hse_jsa').delete().in('id', ctx.jsaIds);
    }
    if (ctx.assessmentIds.length) {
      await sb.from('hse_risk_assessment_hazards').delete().in('assessment_id', ctx.assessmentIds);
      await sb.from('hse_controls').delete().eq('source_type','assessment').in('source_id', ctx.assessmentIds);
      await sb.from('hse_ppe_requirements').delete().eq('source_type','assessment').in('source_id', ctx.assessmentIds);
      await sb.from('hse_training_links').delete().eq('source_type','assessment').in('source_id', ctx.assessmentIds);
      await sb.from('hse_risk_assessments').delete().in('id', ctx.assessmentIds);
    }
    if (ctx.hazardIds.length) {
      await sb.from('hse_controls').delete().eq('source_type','hazard').in('source_id', ctx.hazardIds);
      await sb.from('hse_hazards').delete().in('id', ctx.hazardIds);
    }
    await sb.from('notifications').delete().ilike('title', `%${TAG}%`);
  });

  const baseHazard = () => ({
    title:              `${TAG} Falling Object`,
    description:        'Integration test hazard',
    category:           'physical',
    initialLikelihood:  2,
    initialSeverity:    3,
    status:             'registered',
    controls:           [],
  });

  const waitFor = async (check, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await check()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };

  // ── Summary ─────────────────────────────────────────────────────────────────
  h.section('Risk & JSA › Summary');

  await test('risk-jsa/summary returns all required fields', async () => {
    const r = await api('hse/risk-jsa/summary', T.admin);
    ok(r);
    const d = r.body.data;
    for (const f of ['totalHazards','highCriticalHazards','openAssessments','pendingReview','overdueAssessments','openJsa','riskReductionPct']) {
      expect(typeof d?.[f] === 'number', `missing numeric field: ${f}`);
    }
    expect(Array.isArray(d?.highRiskQueue), 'highRiskQueue not array');
    expect(Array.isArray(d?.recentHighRisk), 'recentHighRisk not array');
    expect(Array.isArray(d?.overdueAssessmentsDetail), 'overdueAssessmentsDetail not array');
  });
  await test('ACCESS: summary denied without auth', async () => {
    fails(await api('hse/risk-jsa/summary', null));
  });

  // ── Hazards › List ──────────────────────────────────────────────────────────
  h.section('Risk & JSA › Hazards — List');

  await test('hazards/list returns array', async () => {
    const r = await api('hse/risk-jsa/hazards/list', T.admin, { limit: 10 });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('hazards/list filters by category', async () => {
    const r = await api('hse/risk-jsa/hazards/list', T.admin, { category: 'chemical', limit: 10 });
    ok(r);
    expect((r.body.data || []).every(h => h.category === 'chemical'), 'category filter leaked other categories');
  });
  await test('hazards/list filters by riskLevel', async () => {
    const r = await api('hse/risk-jsa/hazards/list', T.admin, { riskLevel: 'critical', limit: 10 });
    ok(r);
    expect((r.body.data || []).every(h => h.risk_level === 'critical'), 'riskLevel filter leaked wrong risk levels');
  });
  await test('hazards/list response shape', async () => {
    const r = await api('hse/risk-jsa/hazards/list', T.admin, { limit: 50 });
    ok(r);
    if ((r.body.data || []).length > 0) {
      const row = r.body.data[0];
      for (const f of ['id','ref','title','category','initial_score','risk_level','status','created_at']) {
        expect(row[f] !== undefined, `list row missing field: ${f}`);
      }
    }
  });
  await test('ACCESS: hazards/list denied without auth', async () => {
    fails(await api('hse/risk-jsa/hazards/list', null));
  });

  // ── Hazards › Create (validation) ──────────────────────────────────────────
  h.section('Risk & JSA › Hazards — Create validation');

  await test('VALIDATION: empty title → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), title: '' }));
  });
  await test('VALIDATION: empty category → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), category: '' }));
  });
  await test('VALIDATION: initialLikelihood < 1 → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), initialLikelihood: 0 }));
  });
  await test('VALIDATION: initialLikelihood > 5 → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), initialLikelihood: 6 }));
  });
  await test('VALIDATION: initialSeverity < 1 → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), initialSeverity: 0 }));
  });
  await test('VALIDATION: initialSeverity > 5 → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), initialSeverity: 6 }));
  });
  await test('VALIDATION: invalid status enum → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), status: 'flying' }));
  });
  await test('VALIDATION: title > 300 chars → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/create', T.admin, { ...baseHazard(), title: 'x'.repeat(301) }));
  });
  await test('FINDING: category is free-form string (no enum validation)', async () => {
    // category is z.string().min(1) — any non-empty string accepted. Extensible by design.
    const r = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(), title: `${TAG} CustomCat`, category: 'custom_unconstrained_category',
    });
    if (r.body.success) {
      ctx.hazardIds.push(r.body.data?.id);
      console.warn('\n      FINDING: hazard category accepts any string — no enum constraint');
    }
  });

  // ── Hazards › Create (happy path + side-effects) ────────────────────────────
  h.section('Risk & JSA › Hazards — Create happy path');

  await test('create low-risk hazard (score=6, medium)', async () => {
    const r = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(), title: `${TAG} Medium Hazard`, initialLikelihood: 2, initialSeverity: 3,
    });
    ok(r);
    expect(r.body.data?.id,        'no id');
    expect(r.body.data?.ref,       'no ref');
    expect(r.body.data?.riskLevel, 'no riskLevel in response');
    expect(r.body.data?.score,     'no score in response');
    ctx.hazardId  = r.body.data.id;
    ctx.hazardRef = r.body.data.ref;
    ctx.hazardIds.push(ctx.hazardId);
  });
  await test('risk level computed correctly: 2×3=6 → medium', async () => {
    expect(ctx.hazardId, 'prerequisite: hazardId required');
    const { data } = await sb.from('hse_hazards').select('risk_level,status').eq('id', ctx.hazardId).single();
    expect(data?.risk_level === 'medium', `expected medium, got ${data?.risk_level}`);
  });
  await test('SIDE-EFFECT: hse.hazard.registered event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.hazard.registered')
        .order('created_at',{ascending:false}).limit(10);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.hazard.registered event not emitted');
  });
  await test('create HIGH-risk hazard (4×4=16) → workflow created, status=assessment_required', async () => {
    const r = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(),
      title:             `${TAG} High Hazard`,
      initialLikelihood: 4,
      initialSeverity:   4,
    });
    ok(r);
    expect(r.body.data?.riskLevel === 'high', `expected high riskLevel, got ${r.body.data?.riskLevel}`);
    ctx.hazardIds.push(r.body.data.id);
    const { data } = await sb.from('hse_hazards').select('risk_level,status').eq('id', r.body.data.id).single();
    expect(['high','critical'].includes(data?.risk_level ?? ''), 'expected high/critical risk level in DB');
    // Workflow may be created if hse_hazard_review template is seeded.
    if (r.body.data?.workflowId) {
      expect(data?.status === 'assessment_required', `expected assessment_required, got ${data?.status}`);
    }
  });
  await test('create CRITICAL hazard (5×5=25)', async () => {
    const r = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(),
      title:             `${TAG} Critical Hazard`,
      initialLikelihood: 5,
      initialSeverity:   5,
    });
    ok(r);
    expect(r.body.data?.riskLevel === 'critical', `expected critical, got ${r.body.data?.riskLevel}`);
    ctx.hazardIds.push(r.body.data.id);
  });
  await test('create hazard with inline controls → controls row created', async () => {
    const r = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(),
      title:    `${TAG} Hazard With Controls`,
      controls: [
        { description: 'Wear hard hat', controlType: 'ppe' },
        { description: 'Install barrier', controlType: 'engineering' },
      ],
    });
    ok(r);
    ctx.hazardIds.push(r.body.data.id);
    const { data } = await sb.from('hse_controls').select('id,control_type').eq('source_type','hazard').eq('source_id', r.body.data.id);
    expect((data ?? []).length === 2, `expected 2 controls, got ${data?.length}`);
    ctx.controlIds.push(...(data ?? []).map(c => c.id));
  });
  await test('ACCESS: hazards/create denied without auth', async () => {
    fails(await api('hse/risk-jsa/hazards/create', null, baseHazard()));
  });

  // ── Hazards › Detail & Update ────────────────────────────────────────────────
  h.section('Risk & JSA › Hazards — Detail & Update');

  await test('hazards/detail by id returns full payload', async () => {
    expect(ctx.hazardId, 'prerequisite: hazardId required');
    const r = await api('hse/risk-jsa/hazards/detail', T.admin, { hazardId: ctx.hazardId });
    ok(r);
    const d = r.body.data;
    expect(d?.hazard, 'hazard missing in detail');
    expect(Array.isArray(d?.controls),    'controls not array');
    expect(Array.isArray(d?.assessments), 'assessments not array');
    expect(Array.isArray(d?.capa),        'capa not array');
    expect(Array.isArray(d?.timeline),    'timeline not array');
  });
  await test('hazards/detail without args → failure', async () => {
    fails(await api('hse/risk-jsa/hazards/detail', T.admin, {}));
  });
  await test('hazards/detail non-existent → failure', async () => {
    fails(await api('hse/risk-jsa/hazards/detail', T.admin, { hazardId: '00000000-0000-0000-0000-000000000000' }));
  });
  await test('hazards/update: update title and category', async () => {
    ok(await api('hse/risk-jsa/hazards/update', T.admin, {
      hazardId:    ctx.hazardId,
      title:       `${TAG} Updated Hazard`,
      description: `${TAG} updated desc`,
    }));
    const { data } = await sb.from('hse_hazards').select('title').eq('id', ctx.hazardId).single();
    expect((data?.title ?? '').includes('Updated Hazard'), 'title not updated');
  });
  await test('hazards/update: valid status enum accepted', async () => {
    ok(await api('hse/risk-jsa/hazards/update', T.admin, {
      hazardId: ctx.hazardId, status: 'monitoring',
    }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', ctx.hazardId).single();
    expect(data?.status === 'monitoring', `expected monitoring, got ${data?.status}`);
    // Reset to registered.
    await api('hse/risk-jsa/hazards/update', T.admin, { hazardId: ctx.hazardId, status: 'registered' });
  });
  await test('VALIDATION: hazards/update invalid status enum → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/update', T.admin, { hazardId: ctx.hazardId, status: 'flying' }));
  });
  await test('VALIDATION: hazards/update non-UUID hazardId → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/update', T.admin, { hazardId: 'not-a-uuid', status: 'registered' }));
  });
  await test('VALIDATION: hazards/update residualLikelihood out of 1-5 → rejected', async () => {
    fails(await api('hse/risk-jsa/hazards/update', T.admin, { hazardId: ctx.hazardId, residualLikelihood: 0 }));
  });
  await test('hazards/update with version → optimistic concurrency works', async () => {
    const { data: hz } = await sb.from('hse_hazards').select('version').eq('id', ctx.hazardId).single();
    const currentVersion = hz?.version ?? 0;
    ok(await api('hse/risk-jsa/hazards/update', T.admin, {
      hazardId:    ctx.hazardId,
      description: `${TAG} versioned update`,
      version:     currentVersion,
    }));
    const { data: hz2 } = await sb.from('hse_hazards').select('version').eq('id', ctx.hazardId).single();
    expect((hz2?.version ?? 0) === currentVersion + 1, 'version not incremented after versioned update');
  });
  await test('SIDE-EFFECT: hazards/update emits hse.hazard.updated event', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.hazard.updated')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.hazard.updated event not emitted');
  });
  await test('hazards/list reflects the created hazard', async () => {
    const r = await api('hse/risk-jsa/hazards/list', T.admin, { limit: 200 });
    ok(r);
    expect((r.body.data || []).some(h => h.id === ctx.hazardId), 'hazard not in list after create');
  });

  // ── Hazards › Submit & Lifecycle ────────────────────────────────────────────
  h.section('Risk & JSA › Hazards — Submit & lifecycle');

  await test('hazards/submit: move to under_review', async () => {
    ok(await api('hse/risk-jsa/hazards/submit', T.admin, { hazardId: ctx.hazardId, note: 'E2E submit test' }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', ctx.hazardId).single();
    expect(data?.status === 'under_review', `expected under_review, got ${data?.status}`);
  });
  await test('SIDE-EFFECT: hse.hazard.submitted event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.hazard.submitted')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.hazard.submitted event not emitted');
  });
  await test('approve hazard → status=approved', async () => {
    ok(await api('hse/risk-jsa/approve', T.admin, {
      entityType: 'hazard', entityId: ctx.hazardId, note: 'E2E approved',
    }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', ctx.hazardId).single();
    expect(data?.status === 'approved', `expected approved, got ${data?.status}`);
  });
  await test('SIDE-EFFECT: hse.hazard.approved event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.hazard.approved')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.hazard.approved event not emitted');
  });
  await test('activate hazard → status=active', async () => {
    ok(await api('hse/risk-jsa/activate', T.admin, {
      entityType: 'hazard', entityId: ctx.hazardId,
    }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', ctx.hazardId).single();
    expect(data?.status === 'active', `expected active, got ${data?.status}`);
  });
  await test('close hazard → status=closed', async () => {
    ok(await api('hse/risk-jsa/close', T.admin, { entityType: 'hazard', entityId: ctx.hazardId }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', ctx.hazardId).single();
    expect(data?.status === 'closed', `expected closed, got ${data?.status}`);
  });
  await test('archive hazard → status=archived', async () => {
    ok(await api('hse/risk-jsa/archive', T.admin, { entityType: 'hazard', entityId: ctx.hazardId }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', ctx.hazardId).single();
    expect(data?.status === 'archived', `expected archived, got ${data?.status}`);
  });
  await test('VALIDATION: transition from archived → anything → rejected (terminal state)', async () => {
    fails(await api('hse/risk-jsa/approve', T.admin, { entityType: 'hazard', entityId: ctx.hazardId }), 'archived is terminal');
  });
  await test('VALIDATION: approve with non-UUID entityId → rejected', async () => {
    fails(await api('hse/risk-jsa/approve', T.admin, { entityType: 'hazard', entityId: 'not-a-uuid' }));
  });
  await test('VALIDATION: approve with invalid entityType → rejected', async () => {
    fails(await api('hse/risk-jsa/approve', T.admin, { entityType: 'incident', entityId: ctx.hazardId }));
  });

  // ── Controls › Create & Verify ──────────────────────────────────────────────
  h.section('Risk & JSA › Controls — Create & Verify');

  // Use a fresh hazard for control tests (the main one is archived).
  await test('create hazard for control tests', async () => {
    const r = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(), title: `${TAG} Controls Test Hazard`,
    });
    ok(r);
    ctx.ctrlHazardId = r.body.data.id;
    ctx.hazardIds.push(ctx.ctrlHazardId);
  });
  await test('controls/create adds a control to the hazard', async () => {
    const r = await api('hse/risk-jsa/controls/create', T.admin, {
      sourceType:  'hazard',
      sourceId:    ctx.ctrlHazardId,
      description: `${TAG} Control Description`,
      controlType: 'engineering',
      ownerUserId: admin.id,
    });
    ok(r);
    expect(r.body.controlId, 'no controlId in response');
    ctx.controlId = r.body.controlId;
    ctx.controlIds.push(ctx.controlId);
  });
  await test('SIDE-EFFECT: control row in DB with status=planned', async () => {
    const { data } = await sb.from('hse_controls').select('status,control_type').eq('id', ctx.controlId).single();
    expect(data?.status === 'planned', `expected planned, got ${data?.status}`);
    expect(data?.control_type === 'engineering', `control_type mismatch`);
  });
  await test('SIDE-EFFECT: hse.control.added event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.control.added')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.control.added event not emitted');
  });
  await test('VALIDATION: controls/create invalid controlType → rejected', async () => {
    fails(await api('hse/risk-jsa/controls/create', T.admin, {
      sourceType: 'hazard', sourceId: ctx.ctrlHazardId,
      description: 'test', controlType: 'magic',
    }));
  });
  await test('VALIDATION: controls/create invalid sourceType → rejected', async () => {
    fails(await api('hse/risk-jsa/controls/create', T.admin, {
      sourceType: 'invalid_entity', sourceId: ctx.ctrlHazardId,
      description: 'test', controlType: 'administrative',
    }));
  });
  await test('VALIDATION: controls/create empty description → rejected', async () => {
    fails(await api('hse/risk-jsa/controls/create', T.admin, {
      sourceType: 'hazard', sourceId: ctx.ctrlHazardId, description: '', controlType: 'ppe',
    }));
  });
  await test('controls/verify: mark effective', async () => {
    ok(await api('hse/risk-jsa/controls/verify', T.admin, {
      controlId:     ctx.controlId,
      effectiveness: 'effective',
      note:          'E2E verified',
    }));
    const { data } = await sb.from('hse_controls').select('status,effectiveness,verified_by,verified_at').eq('id', ctx.controlId).single();
    expect(data?.status === 'verified', `expected verified, got ${data?.status}`);
    expect(data?.effectiveness === 'effective', 'effectiveness not set');
    expect(data?.verified_by === admin.id, 'verified_by not set');
    expect(data?.verified_at != null, 'verified_at not set');
  });
  await test('controls/verify: ineffective → status=ineffective', async () => {
    // Create a fresh control to test ineffective path.
    const cr = await api('hse/risk-jsa/controls/create', T.admin, {
      sourceType: 'hazard', sourceId: ctx.ctrlHazardId, description: `${TAG} Ineffective Control`, controlType: 'administrative',
    });
    ok(cr); ctx.controlIds.push(cr.body.controlId);
    ok(await api('hse/risk-jsa/controls/verify', T.admin, {
      controlId: cr.body.controlId, effectiveness: 'ineffective',
    }));
    const { data } = await sb.from('hse_controls').select('status').eq('id', cr.body.controlId).single();
    expect(data?.status === 'ineffective', `expected ineffective, got ${data?.status}`);
  });
  await test('VALIDATION: controls/verify invalid effectiveness → rejected', async () => {
    fails(await api('hse/risk-jsa/controls/verify', T.admin, { controlId: ctx.controlId, effectiveness: 'sort-of' }));
  });
  await test('SIDE-EFFECT: controls/verify emits hse.control.verified event', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.control.verified')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.control.verified event not emitted');
  });

  // ── Risk Assessments ────────────────────────────────────────────────────────
  h.section('Risk & JSA › Risk Assessments — CRUD');

  await test('assessments/list returns array', async () => {
    const r = await api('hse/risk-jsa/assessments/list', T.admin, { limit: 10 });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('assessments/list response shape', async () => {
    const r = await api('hse/risk-jsa/assessments/list', T.admin, { limit: 5 });
    ok(r);
    if ((r.body.data || []).length > 0) {
      const row = r.body.data[0];
      for (const f of ['id','ref','assessment_type','title','status','created_at']) {
        expect(row[f] !== undefined, `list row missing: ${f}`);
      }
    }
  });
  await test('VALIDATION: assessments/create empty title → rejected', async () => {
    fails(await api('hse/risk-jsa/assessments/create', T.admin, { title: '', assessmentType: 'general' }));
  });
  await test('VALIDATION: assessments/create invalid assessmentType → rejected', async () => {
    fails(await api('hse/risk-jsa/assessments/create', T.admin, { title: `${TAG} RA`, assessmentType: 'invalid_type' }));
  });
  await test('VALIDATION: assessments/create invalid reviewCycle → rejected', async () => {
    fails(await api('hse/risk-jsa/assessments/create', T.admin, {
      title: `${TAG} RA`, assessmentType: 'general', reviewCycle: 'never',
    }));
  });
  await test('VALIDATION: hazard in assessment with likelihood < 1 → rejected', async () => {
    fails(await api('hse/risk-jsa/assessments/create', T.admin, {
      title: `${TAG} RA`, assessmentType: 'general',
      hazards: [{ initialLikelihood: 0, initialSeverity: 3 }],
    }));
  });
  await test('assessments/create happy path with hazards', async () => {
    const r = await api('hse/risk-jsa/assessments/create', T.admin, {
      assessmentType: 'general',
      title:          `${TAG} Risk Assessment`,
      description:    'Integration test RA',
      ownerUserId:    admin.id,
      reviewCycle:    'annual',
      hazards: [
        { initialLikelihood: 3, initialSeverity: 3, hazardDescription: 'Electrical hazard', category: 'electrical' },
        { initialLikelihood: 2, initialSeverity: 2, hazardDescription: 'Slip hazard', category: 'physical' },
      ],
    });
    ok(r);
    expect(r.body.data?.id,  'no id');
    expect(r.body.data?.ref, 'no ref');
    ctx.assessmentId  = r.body.data.id;
    ctx.assessmentRef = r.body.data.ref;
    ctx.assessmentIds.push(ctx.assessmentId);
  });
  await test('SIDE-EFFECT: assessment row in DB status=draft', async () => {
    const { data } = await sb.from('hse_risk_assessments').select('status,initial_score').eq('id', ctx.assessmentId).single();
    expect(data?.status === 'draft', `expected draft, got ${data?.status}`);
    expect(data?.initial_score != null, 'initial_score not computed');
  });
  await test('SIDE-EFFECT: hazard rows written to hse_risk_assessment_hazards', async () => {
    const { data } = await sb.from('hse_risk_assessment_hazards').select('id').eq('assessment_id', ctx.assessmentId);
    expect((data ?? []).length === 2, `expected 2 hazards, got ${data?.length}`);
  });
  await test('SIDE-EFFECT: hse.risk_assessment.created event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.risk_assessment.created')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.risk_assessment.created event not emitted');
  });
  await test('assessments/detail returns full payload', async () => {
    const r = await api('hse/risk-jsa/assessments/detail', T.admin, { assessmentId: ctx.assessmentId });
    ok(r);
    const d = r.body.data;
    expect(d?.assessment, 'assessment missing in detail');
    for (const f of ['hazards','controls','ppe','training','timeline']) {
      expect(Array.isArray(d?.[f]), `${f} not an array`);
    }
  });
  await test('assessments/detail without args → failure', async () => {
    fails(await api('hse/risk-jsa/assessments/detail', T.admin, {}));
  });
  await test('assessments/update: update title', async () => {
    ok(await api('hse/risk-jsa/assessments/update', T.admin, {
      assessmentId: ctx.assessmentId, title: `${TAG} Updated RA`,
    }));
    const { data } = await sb.from('hse_risk_assessments').select('title').eq('id', ctx.assessmentId).single();
    expect((data?.title ?? '').includes('Updated RA'), 'title not updated');
  });
  await test('VALIDATION: assessments/update non-UUID assessmentId → rejected', async () => {
    fails(await api('hse/risk-jsa/assessments/update', T.admin, { assessmentId: 'not-a-uuid' }));
  });
  await test('assessments/submit: draft → submitted', async () => {
    ok(await api('hse/risk-jsa/assessments/submit', T.admin, { assessmentId: ctx.assessmentId, note: 'E2E submit' }));
    const { data } = await sb.from('hse_risk_assessments').select('status').eq('id', ctx.assessmentId).single();
    expect(data?.status === 'submitted', `expected submitted, got ${data?.status}`);
  });
  await test('SIDE-EFFECT: hse.risk_assessment.submitted event + notification', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.risk_assessment.submitted')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.risk_assessment.submitted event not emitted');
  });
  await test('approve assessment → status=approved', async () => {
    ok(await api('hse/risk-jsa/approve', T.admin, {
      entityType: 'assessment', entityId: ctx.assessmentId,
    }));
    const { data } = await sb.from('hse_risk_assessments').select('status').eq('id', ctx.assessmentId).single();
    expect(data?.status === 'approved', `expected approved, got ${data?.status}`);
  });
  await test('reject: submit a second RA and reject it', async () => {
    const ra = await api('hse/risk-jsa/assessments/create', T.admin, {
      assessmentType: 'task', title: `${TAG} RA Reject`,
    });
    ok(ra); const raId = ra.body.data.id; ctx.assessmentIds.push(raId);
    ok(await api('hse/risk-jsa/assessments/submit', T.admin, { assessmentId: raId }));
    ok(await api('hse/risk-jsa/reject', T.admin, { entityType: 'assessment', entityId: raId, note: 'does not meet requirements' }));
    const { data } = await sb.from('hse_risk_assessments').select('status').eq('id', raId).single();
    expect(data?.status === 'rejected', `expected rejected, got ${data?.status}`);
  });
  await test('SIDE-EFFECT: hse.assessment.rejected event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.assessment.rejected')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.assessment.rejected event not emitted');
  });
  await test('request-changes: submit a third RA and request changes', async () => {
    const ra = await api('hse/risk-jsa/assessments/create', T.admin, {
      assessmentType: 'general', title: `${TAG} RA Changes`,
    });
    ok(ra); const raId = ra.body.data.id; ctx.assessmentIds.push(raId);
    ok(await api('hse/risk-jsa/assessments/submit', T.admin, { assessmentId: raId }));
    ok(await api('hse/risk-jsa/request-changes', T.admin, { entityType: 'assessment', entityId: raId, note: 'need more hazards' }));
    const { data } = await sb.from('hse_risk_assessments').select('status').eq('id', raId).single();
    expect(data?.status === 'changes_requested', `expected changes_requested, got ${data?.status}`);
  });

  // ── JSA ──────────────────────────────────────────────────────────────────────
  h.section('Risk & JSA › JSA — CRUD');

  await test('jsa/list returns array', async () => {
    const r = await api('hse/risk-jsa/jsa/list', T.admin, { limit: 10 });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('jsa/list response shape', async () => {
    const r = await api('hse/risk-jsa/jsa/list', T.admin, { limit: 5 });
    ok(r);
    if ((r.body.data || []).length > 0) {
      const row = r.body.data[0];
      for (const f of ['id','ref','title','status','risk_level','created_at','stepCount']) {
        expect(row[f] !== undefined, `list row missing: ${f}`);
      }
    }
  });
  await test('VALIDATION: jsa/create empty title → rejected', async () => {
    fails(await api('hse/risk-jsa/jsa/create', T.admin, { title: '' }));
  });
  await test('VALIDATION: jsa/create step with invalid stepNumber (0) → rejected', async () => {
    fails(await api('hse/risk-jsa/jsa/create', T.admin, {
      title: `${TAG} JSA`,
      steps: [{ stepNumber: 0, taskStep: 'Do something' }],
    }));
  });
  await test('VALIDATION: jsa/create step with empty taskStep → rejected', async () => {
    fails(await api('hse/risk-jsa/jsa/create', T.admin, {
      title: `${TAG} JSA`,
      steps: [{ stepNumber: 1, taskStep: '' }],
    }));
  });
  await test('jsa/create happy path with steps, hazards, ppe, crew', async () => {
    const r = await api('hse/risk-jsa/jsa/create', T.admin, {
      title:        `${TAG} JSA Full`,
      description:  'Integration test JSA',
      ownerUserId:  admin.id,
      steps: [
        {
          stepNumber: 1,
          taskStep:   'Inspect work area',
          hazardDescription: 'Uneven surfaces',
          initialLikelihood: 3,
          initialSeverity:   3,
          hazards: [
            {
              description: 'Electrical hazard near equipment',
              category:    'electrical',
              initialLikelihood: 2,
              initialSeverity:   4,
              controls: [
                { description: 'Lockout tagout procedure', controlType: 'administrative' },
              ],
            },
          ],
        },
        { stepNumber: 2, taskStep: 'Perform work' },
      ],
      ppeItems: [
        { ppeItem: 'Hard Hat', required: true },
        { ppeItem: 'Safety Glasses', required: true },
      ],
      trainingLinks: [
        { requirementDescription: 'JSA Awareness Training', certificationRequired: false, competencyVerification: true },
      ],
      crewMembers: [
        { crewName: `${TAG} Crew A`, roleTitle: 'Lead Technician', required: true, competencyVerified: true },
        { crewName: `${TAG} Crew B`, roleTitle: 'Support',         required: true, competencyVerified: false },
      ],
    });
    ok(r);
    expect(r.body.data?.id,  'no id');
    expect(r.body.data?.ref, 'no ref');
    ctx.jsaId  = r.body.data.id;
    ctx.jsaRef = r.body.data.ref;
    ctx.jsaIds.push(ctx.jsaId);
  });
  await test('SIDE-EFFECT: JSA row in DB status=draft', async () => {
    const { data } = await sb.from('hse_jsa').select('status,risk_level').eq('id', ctx.jsaId).single();
    expect(data?.status === 'draft', `expected draft, got ${data?.status}`);
    expect(data?.risk_level, 'risk_level not set');
  });
  await test('SIDE-EFFECT: JSA steps written to hse_jsa_steps', async () => {
    const { data } = await sb.from('hse_jsa_steps').select('id').eq('jsa_id', ctx.jsaId);
    expect((data ?? []).length === 2, `expected 2 steps, got ${data?.length}`);
  });
  await test('SIDE-EFFECT: JSA PPE items written to hse_ppe_requirements', async () => {
    const { data } = await sb.from('hse_ppe_requirements').select('id').eq('source_type','jsa').eq('source_id', ctx.jsaId);
    expect((data ?? []).length === 2, `expected 2 PPE items, got ${data?.length}`);
  });
  await test('SIDE-EFFECT: JSA crew written to hse_jsa_crew_acknowledgements', async () => {
    const { data } = await sb.from('hse_jsa_crew_acknowledgements').select('id,crew_name').eq('jsa_id', ctx.jsaId);
    expect((data ?? []).length === 2, `expected 2 crew members, got ${data?.length}`);
    ctx.crewIds.push(...(data ?? []).map(c => c.id));
  });
  await test('SIDE-EFFECT: hse.jsa.created event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.jsa.created')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.jsa.created event not emitted');
  });
  await test('jsa/detail returns full payload with nested step hazards', async () => {
    const r = await api('hse/risk-jsa/jsa/detail', T.admin, { jsaId: ctx.jsaId });
    ok(r);
    const d = r.body.data;
    expect(d?.jsa, 'jsa missing in detail');
    for (const f of ['steps','ppe','training','crew','timeline']) {
      expect(Array.isArray(d?.[f]), `${f} not an array`);
    }
    expect(d?.steps.length === 2, `expected 2 steps, got ${d?.steps.length}`);
    // Step 1 should have nested hazards from create.
    const step1 = d?.steps.find(s => s.step_number === 1);
    expect(step1, 'step 1 not found');
    expect(Array.isArray(step1?.hazards), 'step1.hazards not array');
    expect(step1?.hazards?.length === 1, `expected 1 nested hazard on step 1, got ${step1?.hazards?.length}`);
  });
  await test('jsa/detail without args → failure', async () => {
    fails(await api('hse/risk-jsa/jsa/detail', T.admin, {}));
  });
  await test('jsa/update: update title', async () => {
    ok(await api('hse/risk-jsa/jsa/update', T.admin, { jsaId: ctx.jsaId, title: `${TAG} Updated JSA` }));
    const { data } = await sb.from('hse_jsa').select('title').eq('id', ctx.jsaId).single();
    expect((data?.title ?? '').includes('Updated JSA'), 'title not updated');
  });
  await test('VALIDATION: jsa/update non-UUID jsaId → rejected', async () => {
    fails(await api('hse/risk-jsa/jsa/update', T.admin, { jsaId: 'not-a-uuid' }));
  });

  // ── JSA crew acknowledge & activation gate ──────────────────────────────────
  h.section('Risk & JSA › JSA — Crew acknowledge & activation gate');

  await test('jsa/acknowledge: crew A acknowledges + competency=true', async () => {
    // Pick crew A (the required+verified one).
    const { data: crew } = await sb.from('hse_jsa_crew_acknowledgements').select('id').eq('jsa_id', ctx.jsaId).limit(2);
    expect((crew ?? []).length >= 1, 'no crew rows');
    ctx.crewAId = crew?.[0]?.id;
    ok(await api('hse/risk-jsa/jsa/acknowledge', T.admin, {
      jsaId: ctx.jsaId, crewId: ctx.crewAId, competencyVerified: true,
    }));
    const { data } = await sb.from('hse_jsa_crew_acknowledgements').select('acknowledged').eq('id', ctx.crewAId).single();
    expect(data?.acknowledged === true, 'crew A not acknowledged');
  });
  await test('jsa/acknowledge: crew B acknowledges', async () => {
    const { data: crew } = await sb.from('hse_jsa_crew_acknowledgements').select('id')
      .eq('jsa_id', ctx.jsaId).neq('id', ctx.crewAId).limit(1);
    if (crew && crew.length > 0) {
      ok(await api('hse/risk-jsa/jsa/acknowledge', T.admin, {
        jsaId: ctx.jsaId, crewId: crew[0].id, competencyVerified: true,
      }));
    }
  });

  // Submit before activate.
  await test('jsa/submit: draft → submitted', async () => {
    ok(await api('hse/risk-jsa/jsa/submit', T.admin, { jsaId: ctx.jsaId, note: 'E2E submit' }));
    const { data } = await sb.from('hse_jsa').select('status').eq('id', ctx.jsaId).single();
    expect(data?.status === 'submitted', `expected submitted, got ${data?.status}`);
  });
  await test('SIDE-EFFECT: hse.jsa.submitted event + notification emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.jsa.submitted')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.jsa.submitted event not emitted');
  });
  await test('approve JSA → status=approved', async () => {
    ok(await api('hse/risk-jsa/approve', T.admin, { entityType: 'jsa', entityId: ctx.jsaId }));
    const { data } = await sb.from('hse_jsa').select('status').eq('id', ctx.jsaId).single();
    expect(data?.status === 'approved', `expected approved, got ${data?.status}`);
  });
  await test('activate JSA → status=active (gate: all crew acknowledged)', async () => {
    ok(await api('hse/risk-jsa/activate', T.admin, { entityType: 'jsa', entityId: ctx.jsaId }));
    const { data } = await sb.from('hse_jsa').select('status').eq('id', ctx.jsaId).single();
    expect(data?.status === 'active', `expected active, got ${data?.status}`);
  });
  await test('create a JSA where a required crew member has not acknowledged → activation blocked', async () => {
    const r = await api('hse/risk-jsa/jsa/create', T.admin, {
      title:       `${TAG} JSA UnAcked`,
      crewMembers: [{ crewName: `${TAG} Unacked Crew`, required: true, competencyVerified: false }],
    });
    ok(r); const unackId = r.body.data.id; ctx.jsaIds.push(unackId);
    // Submit and approve so we can attempt activation.
    ok(await api('hse/risk-jsa/jsa/submit', T.admin, { jsaId: unackId }));
    ok(await api('hse/risk-jsa/approve', T.admin, { entityType: 'jsa', entityId: unackId }));
    // Activation should be blocked: crew has not acknowledged.
    const actR = await api('hse/risk-jsa/activate', T.admin, { entityType: 'jsa', entityId: unackId, override: false });
    fails(actR, 'activation should be blocked when required crew has not acknowledged');
  });

  // ── JSA from-assessment ─────────────────────────────────────────────────────
  h.section('Risk & JSA › JSA from-assessment');

  await test('jsa/from-assessment: prefill draft from existing RA', async () => {
    const r = await api('hse/risk-jsa/jsa/from-assessment', T.admin, { assessmentId: ctx.assessmentId });
    ok(r);
    const d = r.body.data;
    expect(d?.title, 'no title in prefill');
    expect(d?.linkedRiskAssessmentId === ctx.assessmentId, 'linkedRiskAssessmentId mismatch');
    expect(Array.isArray(d?.suggestedHazards), 'suggestedHazards not array');
    expect(d?.sourceRef, 'sourceRef missing');
  });
  await test('jsa/from-assessment non-existent RA → failure', async () => {
    fails(await api('hse/risk-jsa/jsa/from-assessment', T.admin, { assessmentId: '00000000-0000-0000-0000-000000000000' }));
  });
  await test('jsa/from-assessment without assessmentId → failure', async () => {
    fails(await api('hse/risk-jsa/jsa/from-assessment', T.admin, {}));
  });

  // ── Queue ───────────────────────────────────────────────────────────────────
  h.section('Risk & JSA › Queue');

  await test('queue (pending scope) returns mixed entity types with entityType tag', async () => {
    const r = await api('hse/risk-jsa/queue', T.admin, { scope: 'pending' });
    ok(r);
    expect(Array.isArray(r.body.data), 'data not array');
    // Each row must have entityType.
    const rows = r.body.data || [];
    if (rows.length > 0) {
      expect(rows.every(row => ['hazard','assessment','jsa'].includes(row.entityType)), 'some rows missing entityType');
    }
  });
  await test('queue (archived scope) returns only archived entities', async () => {
    const r = await api('hse/risk-jsa/queue', T.admin, { scope: 'archived' });
    ok(r);
    expect(Array.isArray(r.body.data), 'data not array');
    expect((r.body.data || []).every(row => row.status === 'archived'), 'archived scope returned non-archived rows');
  });
  await test('VALIDATION: queue invalid scope → rejected', async () => {
    fails(await api('hse/risk-jsa/queue', T.admin, { scope: 'invalid_scope' }));
  });

  // ── Library ─────────────────────────────────────────────────────────────────
  h.section('Risk & JSA › Library');

  await test('library/hazards returns array', async () => {
    const r = await api('hse/risk-jsa/library/hazards', T.admin, {});
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('library/hazards: category filter', async () => {
    const r = await api('hse/risk-jsa/library/hazards', T.admin, { category: 'chemical' });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('library/controls returns array', async () => {
    const r = await api('hse/risk-jsa/library/controls', T.admin, {});
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('library/hazards/create (library manage permission)', async () => {
    const r = await api('hse/risk-jsa/library/hazards/create', T.admin, {
      category:           'electrical',
      title:              `${TAG} Library Hazard`,
      description:        'E2E test library entry',
      typicalConsequence: 'Electrocution',
      defaultLikelihood:  3,
      defaultSeverity:    5,
      workTypes:          ['electrical_work', 'maintenance'],
    });
    ok(r);
    expect(r.body.data?.id,   'no id');
    expect(r.body.data?.code, 'no code');
    ctx.libHazardId = r.body.data.id;
    // Cleanup: remove the library entry.
    h.onCleanup(async () => {
      if (ctx.libHazardId) await sb.from('hse_hazard_library').delete().eq('id', ctx.libHazardId).catch(() => {});
    });
  });
  await test('VALIDATION: library hazard empty category → rejected', async () => {
    fails(await api('hse/risk-jsa/library/hazards/create', T.admin, {
      category: '', title: `${TAG} lib`, description: 'test',
    }));
  });
  await test('VALIDATION: library hazard defaultLikelihood out of 1-5 → rejected', async () => {
    fails(await api('hse/risk-jsa/library/hazards/create', T.admin, {
      category: 'physical', title: `${TAG} lib2`, defaultLikelihood: 6, defaultSeverity: 3,
    }));
  });
  await test('library hazard appears in library/hazards search', async () => {
    if (!ctx.libHazardId) return; // skip if create failed
    const r = await api('hse/risk-jsa/library/hazards', T.admin, { search: TAG });
    ok(r);
    expect((r.body.data || []).some(h => h.id === ctx.libHazardId || (h.title || '').includes(TAG)), 'created library hazard not found in search');
  });

  // ── Templates ───────────────────────────────────────────────────────────────
  h.section('Risk & JSA › Templates');

  await test('templates/list returns HSE workflow templates', async () => {
    const r = await api('hse/risk-jsa/templates/list', T.admin);
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('templates/duplicate creates a copy of existing template', async () => {
    const listR = await api('hse/risk-jsa/templates/list', T.admin);
    ok(listR);
    if ((listR.body.data || []).length === 0) {
      console.warn('\n      WARN: no HSE workflow templates found — skipping template duplicate test');
      return;
    }
    const templateId = listR.body.data[0].id;
    const r = await api('hse/risk-jsa/templates/duplicate', T.admin, {
      templateId, newName: `${TAG} Duplicate Template`,
    });
    ok(r);
    expect(r.body.data?.id, 'no id');
    expect(r.body.data?.key, 'no key');
    ctx.templateIds.push(r.body.data.id);
  });
  await test('VALIDATION: templates/duplicate non-existent template → failure', async () => {
    fails(await api('hse/risk-jsa/templates/duplicate', T.admin, { templateId: '00000000-0000-0000-0000-000000000000' }));
  });

  // ── Attachments ─────────────────────────────────────────────────────────────
  h.section('Risk & JSA › Attachments');

  await test('attachments/upload-url returns presigned URL and path', async () => {
    const r = await api('hse/risk-jsa/attachments/upload-url', T.admin, {
      fileName: `${TAG}-test.pdf`, mimeType: 'application/pdf',
    });
    ok(r);
    expect(r.body.uploadUrl, 'no uploadUrl');
    expect(r.body.path,      'no path');
  });
  await test('VALIDATION: attachments/upload-url empty fileName → rejected', async () => {
    fails(await api('hse/risk-jsa/attachments/upload-url', T.admin, { fileName: '', mimeType: 'image/png' }));
  });
  await test('attachments/list returns array for entity', async () => {
    // Use the assessment we created.
    const r = await api('hse/risk-jsa/attachments/list', T.admin, {
      entityType: 'assessment', entityId: ctx.assessmentId,
    });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('VALIDATION: attachments/list invalid entityType → rejected', async () => {
    fails(await api('hse/risk-jsa/attachments/list', T.admin, { entityType: 'incident', entityId: ctx.assessmentId }));
  });

  // ── Review (legacy endpoint) ────────────────────────────────────────────────
  h.section('Risk & JSA › Legacy Review endpoint');

  await test('review (legacy): approve outcome delegates to applyTransition', async () => {
    // Create a fresh hazard to review via legacy endpoint.
    const hz = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(), title: `${TAG} Legacy Review`,
    });
    ok(hz); ctx.hazardIds.push(hz.body.data.id);
    ok(await api('hse/risk-jsa/hazards/submit', T.admin, { hazardId: hz.body.data.id }));
    ok(await api('hse/risk-jsa/review', T.admin, {
      entityType: 'hazard', entityId: hz.body.data.id, outcome: 'approve',
    }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', hz.body.data.id).single();
    expect(data?.status === 'approved', `expected approved, got ${data?.status}`);
  });
  await test('review (legacy): return outcome → returned', async () => {
    const hz = await api('hse/risk-jsa/hazards/create', T.admin, {
      ...baseHazard(), title: `${TAG} Legacy Return`,
    });
    ok(hz); ctx.hazardIds.push(hz.body.data.id);
    ok(await api('hse/risk-jsa/hazards/submit', T.admin, { hazardId: hz.body.data.id }));
    ok(await api('hse/risk-jsa/review', T.admin, {
      entityType: 'hazard', entityId: hz.body.data.id, outcome: 'return', note: 'needs more detail',
    }));
    const { data } = await sb.from('hse_hazards').select('status').eq('id', hz.body.data.id).single();
    expect(data?.status === 'returned', `expected returned, got ${data?.status}`);
  });
  await test('VALIDATION: review invalid outcome → rejected', async () => {
    fails(await api('hse/risk-jsa/review', T.admin, { entityType: 'hazard', entityId: ctx.hazardId, outcome: 'delete' }));
  });

  // ── Access control cross-role ────────────────────────────────────────────────
  h.section('Risk & JSA › Access control (negative paths)');

  await test('ACCESS: all risk endpoints deny without auth', async () => {
    const paths = [
      'hse/risk-jsa/hazards/list',
      'hse/risk-jsa/assessments/list',
      'hse/risk-jsa/jsa/list',
      'hse/risk-jsa/queue',
    ];
    for (const p of paths) {
      const r = await api(p, null, {});
      fails(r, `${p} should deny without auth`);
    }
  });
  await test('ACCESS: user B (view permission only) denied on manage/approve actions', async () => {
    // B has hse.risk.view but not manage. Approve requires hse.risk.approve.
    const denied = await api('hse/risk-jsa/approve', T.b, {
      entityType: 'hazard', entityId: ctx.hazardId,
    });
    fails(denied, 'B should not be able to approve hazards');
  });
}
