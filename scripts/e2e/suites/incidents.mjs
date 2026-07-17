/**
 * scripts/e2e/suites/incidents.mjs
 *
 * Comprehensive E2E test suite for the HSE Incidents, Investigations, and CAPA
 * modules. Follows the reference implementation (communications.mjs) exactly.
 *
 * Modules under test (all backend routes mounted at /api/hse/):
 *   hseIncidents.ts      — /incidents/list, /get, /create, /update, /detail, /dashboard/kpis
 *   hseInvestigations.ts — /investigations/list, /get, /create, /update, /addEvidence, /addRootCause
 *   hseCapa.ts           — /capa/list, /get, /create, /update
 *
 * Permissions required by the tested routes:
 *   hse.incidents.view, hse.incidents.create, hse.incidents.manage
 *   hse.investigations.manage
 *   hse.capa.manage
 *   hse.dashboard.view
 *
 * If tests fail with 403, grant these permissions to the admin role via the Console.
 *
 * VALIDATION FINDINGS documented inline with FINDING: comments.
 */

export const title = 'HSE Incidents · Investigations · CAPA';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };

  const ctx = {
    incidentIds:      [],
    investigationIds: [],
    capaIds:          [],
    evidenceIds:      [],
    rootCauseIds:     [],
    incidentId:       null,
    incidentRef:      null,
    investigationId:  null,
    investigationRef: null,
    capaId:           null,
    capaRef:          null,
    evidenceId:       null,
    rootCauseId:      null,
  };

  // Register teardown up-front so partial runs still clean up.
  h.onCleanup(async () => {
    const del = h.mustDelete;
    // Workflow chains for every record this run created (incident deletes only
    // SET NULL their workflow_id — the instances themselves must be removed).
    // Deleting the instance cascades tasks/decisions/events/transitions, but
    // workflow_handoffs.workflow_id has no ON DELETE and blocks it — clear first.
    const recordIds = [...ctx.incidentIds, ...ctx.investigationIds, ...ctx.capaIds];
    if (recordIds.length) {
      // Pending handoff_outbox rows for a deleted record keep retrying and
      // RE-CREATE derived records (incident→investigation/CAPA) — kill them first.
      await del('handoff_outbox', q => q.in('source_entity_id', recordIds));
      await del('handoff_outbox', q => q.in('target_entity_id', recordIds));
      const { data: wfs, error: wfErr } = await sb.from('workflow_instances')
        .select('id').in('source_record_id', recordIds);
      if (wfErr) console.warn(`\n[cleanup] workflow_instances lookup failed — ${wfErr.message}`);
      const wfIds = (wfs ?? []).map(w => w.id);
      if (wfIds.length) {
        await del('workflow_handoffs', q => q.in('workflow_id', wfIds));
        await del('workflow_instances', q => q.in('id', wfIds));
      }
    }
    if (ctx.capaIds.length)          await del('hse_capa_actions', q => q.in('id', ctx.capaIds));
    if (ctx.rootCauseIds.length)     await del('hse_root_causes', q => q.in('id', ctx.rootCauseIds));
    if (ctx.evidenceIds.length)      await del('hse_investigation_evidence', q => q.in('id', ctx.evidenceIds));
    if (ctx.investigationIds.length) await del('hse_investigations', q => q.in('id', ctx.investigationIds));
    if (ctx.incidentIds.length) {
      await del('hse_incident_people', q => q.in('incident_id', ctx.incidentIds));
      await del('hse_incidents', q => q.in('id', ctx.incidentIds));
    }
    await del('notifications', q => q.ilike('title', `%${TAG}%`));
    // Idempotency ledger rows for this run.
    await del('module_mutation_runs', q => q.ilike('idempotency_key', `%${TAG}%`));
  });

  const baseIncident = () => ({
    title:           `${TAG} Slip & Fall`,
    description:     'Integration test incident',
    incidentDate:    new Date().toISOString().slice(0, 10),
    incidentType:    'slip_trip_fall',
    severity:        'moderate',
    lostTime:        false,
    costImpact:      false,
    equipmentDamage: false,
    recordable:      false,
    lostDays:        0,
    people:          [],
  });

  const waitFor = async (check, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await check()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };

  // ── Dashboard KPIs ─────────────────────────────────────────────────────────
  h.section('Incidents › Dashboard KPIs');

  await test('dashboard/kpis returns all KPI fields', async () => {
    const r = await api('hse/dashboard/kpis', T.admin);
    ok(r);
    const d = r.body.data;
    for (const f of ['incidentsMtd','openIncidents','openCapas','overdueCapas','openWorkflows','oshNotificationsOverdue','ltiCasesYtd','totalLostDays']) {
      expect(typeof d?.[f] === 'number', `missing numeric KPI: ${f}`);
    }
    expect(d?.ltiFreeDays === null || typeof d?.ltiFreeDays === 'number', 'ltiFreeDays must be number|null');
  });
  await test('ACCESS: dashboard/kpis denied without auth', async () => {
    fails(await api('hse/dashboard/kpis', null), 'unauthed denied kpis');
  });

  // ── Incidents › List ───────────────────────────────────────────────────────
  h.section('Incidents › List');

  await test('incidents/list returns array', async () => {
    const r = await api('hse/incidents/list', T.admin, { limit: 10 });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('incidents/list honors status filter', async () => {
    const r = await api('hse/incidents/list', T.admin, { status: 'open', limit: 10 });
    ok(r);
    expect((r.body.data || []).every(i => i.status === 'open'), 'status filter leaked non-open rows');
  });
  await test('incidents/list honors severity filter', async () => {
    const r = await api('hse/incidents/list', T.admin, { severity: 'critical', limit: 10 });
    ok(r);
    expect((r.body.data || []).every(i => i.severity === 'critical'), 'severity filter leaked wrong severity');
  });
  await test('incidents/list response shape has required fields', async () => {
    const r = await api('hse/incidents/list', T.admin, { limit: 50 });
    ok(r);
    if ((r.body.data || []).length > 0) {
      const row = r.body.data[0];
      for (const f of ['id','ref','title','incident_date','incident_type','severity','status','created_at']) {
        expect(row[f] !== undefined, `list row missing field: ${f}`);
      }
    }
  });
  await test('ACCESS: incidents/list denied without auth', async () => {
    fails(await api('hse/incidents/list', null, { limit: 5 }), 'unauthed denied list');
  });
  await test('ACCESS: non-admin B sees only own incidents', async () => {
    const r = await api('hse/incidents/list', T.b, { limit: 50 });
    ok(r, 'B can list own incidents');
    const rows = r.body.data || [];
    expect(rows.every(i => i.reported_by === b.id),
      `B sees incidents not reported by them: ${rows.map(i => i.reported_by)}`);
  });
  await test('dateFrom future filter returns 0 rows', async () => {
    const r = await api('hse/incidents/list', T.admin, { dateFrom: '2099-01-01', limit: 10 });
    ok(r);
    expect((r.body.data || []).length === 0, 'dateFrom=2099 should return 0');
  });

  // ── Create validation ──────────────────────────────────────────────────────
  h.section('Incidents › Create — validation');

  await test('VALIDATION: empty title → rejected', async () => {
    fails(await api('hse/incidents/create', T.admin, { ...baseIncident(), title: '' }));
  });
  await test('VALIDATION: missing incidentDate → rejected', async () => {
    const { incidentDate, ...noDate } = baseIncident();
    fails(await api('hse/incidents/create', T.admin, noDate));
  });
  await test('VALIDATION: missing incidentType → rejected', async () => {
    const { incidentType, ...noType } = baseIncident();
    fails(await api('hse/incidents/create', T.admin, noType));
  });
  await test('VALIDATION: invalid severity enum → rejected', async () => {
    fails(await api('hse/incidents/create', T.admin, { ...baseIncident(), severity: 'catastrophic' }));
  });
  await test('VALIDATION: invalid oshClassification enum → rejected', async () => {
    fails(await api('hse/incidents/create', T.admin, { ...baseIncident(), oshClassification: 'not-valid-class' }));
  });
  await test('VALIDATION: lostDays < 0 → rejected', async () => {
    fails(await api('hse/incidents/create', T.admin, { ...baseIncident(), lostDays: -1 }));
  });
  await test('VALIDATION: title > 300 chars → rejected', async () => {
    fails(await api('hse/incidents/create', T.admin, { ...baseIncident(), title: 'x'.repeat(301) }));
  });
  await test('VALIDATION: person invalid personType → rejected', async () => {
    fails(await api('hse/incidents/create', T.admin, {
      ...baseIncident(), people: [{ personType: 'unknown_type', fullName: 'Person' }],
    }));
  });
  await test('VALIDATION: person empty fullName → rejected', async () => {
    fails(await api('hse/incidents/create', T.admin, {
      ...baseIncident(), people: [{ personType: 'witness', fullName: '' }],
    }));
  });
  await test('FINDING: incidentType accepts any string (no enum — extensible)', async () => {
    // incidentType is z.string().min(1). No enum. Custom values are accepted.
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} CustomType`, incidentType: 'CUSTOM_NOT_IN_ANY_LIST',
    });
    if (r.body.success) ctx.incidentIds.push(r.body.data?.id);
    // Documented finding — not a hard failure.
  });
  await test('ACCESS: create incident requires auth', async () => {
    fails(await api('hse/incidents/create', null, baseIncident()));
  });

  // ── Create happy path + side-effects ──────────────────────────────────────
  h.section('Incidents › Create — happy path & side-effects');

  await test('create moderate incident', async () => {
    const r = await api('hse/incidents/create', T.admin, baseIncident());
    ok(r);
    expect(r.body.data?.id,  'no id');
    expect(r.body.data?.ref, 'no ref');
    ctx.incidentId  = r.body.data.id;
    ctx.incidentRef = r.body.data.ref;
    ctx.incidentIds.push(ctx.incidentId);
  });
  await test('SIDE-EFFECT: incident row in DB with expected initial status', async () => {
    const { data } = await sb.from('hse_incidents').select('id,ref,status').eq('id', ctx.incidentId).single();
    expect(data?.id === ctx.incidentId, 'incident not in DB');
    expect(['open','triage'].includes(data?.status ?? ''), `unexpected status: ${data?.status}`);
  });
  await test('SIDE-EFFECT: hse.incident.submitted app_event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.incident.submitted')
        .order('created_at',{ascending:false}).limit(10);
      return (data ?? []).length > 0;
    });
    expect(found, 'no hse.incident.submitted event in app_events');
  });
  await test('SIDE-EFFECT: workflow instance created (if binding seeded)', async () => {
    const { data } = await sb.from('workflow_instances').select('id,module_key')
      .eq('source_record_id', ctx.incidentId).limit(1);
    if (!data || data.length === 0) {
      console.warn('\n      WARN: no workflow for incident — incident_investigation binding may not be seeded');
    } else {
      expect(data[0].module_key === 'hse_incidents', 'workflow module_key != hse_incidents');
    }
  });
  await test('CRITICAL incident → OSH deadlines computed and stored', async () => {
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} Critical`, severity: 'critical', lostTime: true, lostDays: 10,
    });
    ok(r); ctx.incidentIds.push(r.body.data.id);
    const { data } = await sb.from('hse_incidents')
      .select('osh_notification_due,osh_written_due').eq('id', r.body.data.id).single();
    expect(data?.osh_notification_due != null, 'critical: missing osh_notification_due');
    expect(data?.osh_written_due != null,      'critical: missing osh_written_due');
  });
  await test('MINOR incident → no OSH deadlines', async () => {
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} Minor`, severity: 'minor',
    });
    ok(r); ctx.incidentIds.push(r.body.data.id);
    const { data } = await sb.from('hse_incidents')
      .select('osh_notification_due,osh_written_due').eq('id', r.body.data.id).single();
    expect(data?.osh_notification_due == null, 'minor: should not have osh_notification_due');
    expect(data?.osh_written_due == null,      'minor: should not have osh_written_due');
  });
  await test('incident with people records written to hse_incident_people', async () => {
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} With People`,
      people: [
        { personType: 'injured', fullName: `${TAG} Worker`, roleOrCompany: 'Operator', injuryDescription: 'Twisted ankle' },
        { personType: 'witness', fullName: `${TAG} Witness` },
      ],
    });
    ok(r); ctx.incidentIds.push(r.body.data.id);
    const { data } = await sb.from('hse_incident_people').select('person_type').eq('incident_id', r.body.data.id);
    expect((data ?? []).length === 2, `expected 2 people, got ${data?.length}`);
    expect(data?.some(p => p.person_type === 'injured'), 'no injured person row');
    expect(data?.some(p => p.person_type === 'witness'), 'no witness person row');
  });
  await test('HANDOFF: lostTime=true → handoff_outbox row for HR (reason=lost_time_incident)', async () => {
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} LostTime`, lostTime: true, lostDays: 5, severity: 'high',
    });
    ok(r); ctx.incidentIds.push(r.body.data?.id);
    const found = await waitFor(async () => {
      const { data } = await sb.from('handoff_outbox').select('payload').eq('target_module','hr')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).some(h => h.payload?.reason === 'lost_time_incident');
    });
    expect(found, 'HANDOFF MISSING: lost-time incident did not emit handoff_outbox row for HR');
  });
  await test('HANDOFF: costImpact=true → handoff_outbox row for Finance', async () => {
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} CostImpact`, costImpact: true, severity: 'high',
    });
    ok(r); ctx.incidentIds.push(r.body.data?.id);
    const found = await waitFor(async () => {
      const { data } = await sb.from('handoff_outbox').select('payload').eq('target_module','finance')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).some(h => h.payload?.reason === 'incident_cost_impact');
    });
    expect(found, 'HANDOFF MISSING: cost-impact did not emit handoff_outbox row for Finance');
  });
  await test('HANDOFF: equipmentDamage=true → handoff_outbox row for Operations', async () => {
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} EquipDmg`, equipmentDamage: true, severity: 'high',
    });
    ok(r); ctx.incidentIds.push(r.body.data?.id);
    const found = await waitFor(async () => {
      const { data } = await sb.from('handoff_outbox').select('payload').eq('target_module','operations')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).some(h => h.payload?.reason === 'equipment_damage');
    });
    expect(found, 'HANDOFF MISSING: equipment-damage did not emit handoff_outbox row for Operations');
  });

  // ── Get ────────────────────────────────────────────────────────────────────
  h.section('Incidents › Get');

  await test('get by id returns incident + people array', async () => {
    const r = await api('hse/incidents/get', T.admin, { incidentId: ctx.incidentId });
    ok(r);
    expect(r.body.data?.incident?.id === ctx.incidentId, 'id mismatch');
    expect(Array.isArray(r.body.data?.people), 'people not array');
  });
  await test('get by ref returns correct incident', async () => {
    const r = await api('hse/incidents/get', T.admin, { ref: ctx.incidentRef });
    ok(r); expect(r.body.data?.incident?.ref === ctx.incidentRef, 'ref mismatch');
  });
  await test('get without id/ref → failure', async () => {
    fails(await api('hse/incidents/get', T.admin, {}));
  });
  await test('get non-existent → 404 failure', async () => {
    fails(await api('hse/incidents/get', T.admin, { incidentId: '00000000-0000-0000-0000-000000000000' }));
  });

  // ── Detail ─────────────────────────────────────────────────────────────────
  h.section('Incidents › Detail (drawer)');

  await test('detail returns full payload with all required keys', async () => {
    const r = await api('hse/incidents/detail', T.admin, { incidentId: ctx.incidentId });
    ok(r);
    const d = r.body.data;
    expect(d?.incident?.id === ctx.incidentId, 'incident missing in detail');
    for (const f of ['people','evidence','rootCauses','capa','workflowTasks','timeline']) {
      expect(Array.isArray(d?.[f]), `${f} not an array in detail`);
    }
    expect('investigation' in d, 'investigation key missing');
    expect('workflow' in d, 'workflow key missing');
  });
  await test('detail without args → failure', async () => {
    fails(await api('hse/incidents/detail', T.admin, {}));
  });
  await test('detail non-existent → failure', async () => {
    fails(await api('hse/incidents/detail', T.admin, { incidentId: '00000000-0000-0000-0000-000000000000' }));
  });

  // ── Update ─────────────────────────────────────────────────────────────────
  h.section('Incidents › Update');

  await test('update description field', async () => {
    ok(await api('hse/incidents/update', T.admin, { incidentId: ctx.incidentId, description: `${TAG} updated` }));
    const { data } = await sb.from('hse_incidents').select('description').eq('id', ctx.incidentId).single();
    expect((data?.description ?? '').includes(TAG), 'description not updated in DB');
  });
  await test('update status → investigation', async () => {
    ok(await api('hse/incidents/update', T.admin, { incidentId: ctx.incidentId, status: 'investigation' }));
    const { data } = await sb.from('hse_incidents').select('status').eq('id', ctx.incidentId).single();
    expect(data?.status === 'investigation', 'status not updated');
  });
  await test('VALIDATION: invalid status enum → rejected', async () => {
    fails(await api('hse/incidents/update', T.admin, { incidentId: ctx.incidentId, status: 'flying' }));
  });
  await test('VALIDATION: non-UUID incidentId → rejected', async () => {
    fails(await api('hse/incidents/update', T.admin, { incidentId: 'not-a-uuid', status: 'open' }));
  });
  await test('FINDING: update has no from→to transition guard (any valid enum status accepted from any state)', async () => {
    // Documented finding: the update route does not enforce a state machine. Admin can
    // jump directly to any valid enum status (e.g. open → closed, or closed → capa).
    const r = await api('hse/incidents/update', T.admin, { incidentId: ctx.incidentId, status: 'capa' });
    ok(r, 'FINDING: any-to-any status transitions accepted by update endpoint');
    await api('hse/incidents/update', T.admin, { incidentId: ctx.incidentId, status: 'open' });
  });
  await test('SIDE-EFFECT: close → hse.incident.closed event + notification to reporter (B)', async () => {
    const cr = await api('hse/incidents/create', T.b, { ...baseIncident(), title: `${TAG} Close-Me` });
    ok(cr);
    const closeId = cr.body.data.id;
    ctx.incidentIds.push(closeId);

    ok(await api('hse/incidents/update', T.admin, { incidentId: closeId, status: 'closed' }));

    const evFound = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.incident.closed')
        .eq('source_entity_id', closeId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(evFound, 'hse.incident.closed event not emitted');

    const notifFound = await waitFor(async () => {
      const { data } = await sb.from('notifications').select('id')
        .eq('user_id', b.id).eq('type','hse.incident.closed').limit(1);
      return (data ?? []).length > 0;
    });
    expect(notifFound, 'close notification not delivered to reporter (B)');
  });
  await test('ACCESS: update denied for user B (no hse.incidents.manage)', async () => {
    fails(await api('hse/incidents/update', T.b, { incidentId: ctx.incidentId, description: 'hack' }));
  });

  // ── List reflects creates ──────────────────────────────────────────────────
  h.section('Incidents › List reflects creates');

  await test('created incident appears in list', async () => {
    const r = await api('hse/incidents/list', T.admin, { limit: 200 });
    ok(r);
    expect((r.body.data || []).some(i => i.id === ctx.incidentId), 'created incident not in list');
  });

  // ── Investigations › CRUD ──────────────────────────────────────────────────
  h.section('Investigations › CRUD');

  await test('reset incident status to open', async () => {
    ok(await api('hse/incidents/update', T.admin, { incidentId: ctx.incidentId, status: 'open' }));
  });
  await test('investigations/list returns array', async () => {
    const r = await api('hse/investigations/list', T.admin);
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('investigations/list filters by incidentId', async () => {
    const r = await api('hse/investigations/list', T.admin, { incidentId: ctx.incidentId });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('VALIDATION: create missing incidentId → rejected', async () => {
    fails(await api('hse/investigations/create', T.admin, {}));
  });
  await test('VALIDATION: create non-UUID incidentId → rejected', async () => {
    fails(await api('hse/investigations/create', T.admin, { incidentId: 'not-a-uuid' }));
  });
  await test('VALIDATION: create invalid rootCauseMethod → rejected', async () => {
    fails(await api('hse/investigations/create', T.admin, { incidentId: ctx.incidentId, rootCauseMethod: 'xyz' }));
  });
  await test('investigations/create assigns investigator + notifies', async () => {
    const r = await api('hse/investigations/create', T.admin, {
      incidentId:          ctx.incidentId,
      investigatorUserId:  admin.id,
      rootCauseMethod:     '5why',
      dueAt:               new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    ok(r);
    ctx.investigationId  = r.body.investigationId ?? r.body.data?.id;
    ctx.investigationRef = r.body.ref ?? r.body.data?.ref;
    ctx.investigationIds.push(ctx.investigationId);
    expect(ctx.investigationId, 'no investigationId in response');
  });
  await test('SIDE-EFFECT: investigation row in DB status=assigned', async () => {
    const { data } = await sb.from('hse_investigations').select('id,status,incident_id').eq('id', ctx.investigationId).single();
    expect(data?.status === 'assigned', `expected assigned, got ${data?.status}`);
    expect(data?.incident_id === ctx.incidentId, 'incident_id mismatch');
  });
  await test('SIDE-EFFECT: parent incident advanced to investigation status', async () => {
    const { data } = await sb.from('hse_incidents').select('status').eq('id', ctx.incidentId).single();
    expect(data?.status === 'investigation', `expected investigation, got ${data?.status}`);
  });
  await test('SIDE-EFFECT: hse.investigation.assigned event emitted', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.investigation.assigned')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.investigation.assigned event not emitted');
  });
  await test('investigations/get returns investigation + evidence + rootCauses arrays', async () => {
    const r = await api('hse/investigations/get', T.admin, { investigationId: ctx.investigationId });
    ok(r);
    expect(r.body.data?.investigation?.id === ctx.investigationId, 'id mismatch');
    expect(Array.isArray(r.body.data?.evidence), 'evidence not array');
    expect(Array.isArray(r.body.data?.rootCauses), 'rootCauses not array');
  });
  await test('investigations/get non-existent → 404 failure', async () => {
    fails(await api('hse/investigations/get', T.admin, { investigationId: '00000000-0000-0000-0000-000000000000' }));
  });
  await test('investigations/update: advance to collecting_evidence', async () => {
    ok(await api('hse/investigations/update', T.admin, {
      investigationId: ctx.investigationId,
      status:  'collecting_evidence',
      summary: `${TAG} initial summary`,
    }));
    const { data } = await sb.from('hse_investigations').select('status,summary').eq('id', ctx.investigationId).single();
    expect(data?.status === 'collecting_evidence', 'status not collecting_evidence');
    expect((data?.summary ?? '').includes(TAG), 'summary not in DB');
  });
  await test('VALIDATION: update invalid status → rejected', async () => {
    fails(await api('hse/investigations/update', T.admin, { investigationId: ctx.investigationId, status: 'flying' }));
  });
  await test('investigations/update: close → sets closed_at', async () => {
    ok(await api('hse/investigations/update', T.admin, {
      investigationId: ctx.investigationId,
      status:   'closed',
      findings: `${TAG} findings`,
    }));
    const { data } = await sb.from('hse_investigations').select('status,closed_at').eq('id', ctx.investigationId).single();
    expect(data?.status === 'closed', 'status not closed');
    expect(data?.closed_at != null, 'closed_at not set when status=closed');
  });
  await test('ACCESS: investigations blocked for user B (no hse.investigations.manage)', async () => {
    fails(await api('hse/investigations/list', T.b));
  });

  // ── Evidence ───────────────────────────────────────────────────────────────
  h.section('Investigations › Evidence');

  await test('reset investigation to collecting_evidence', async () => {
    ok(await api('hse/investigations/update', T.admin, { investigationId: ctx.investigationId, status: 'collecting_evidence' }));
  });
  await test('addEvidence: add photo evidence', async () => {
    const r = await api('hse/investigations/addEvidence', T.admin, {
      investigationId: ctx.investigationId,
      evidenceType:    'photo',
      title:           `${TAG} Photo Evidence`,
      description:     'Scene photo',
      collectedAt:     new Date().toISOString(),
    });
    ok(r);
    expect(r.body.evidenceId, 'no evidenceId');
    ctx.evidenceId = r.body.evidenceId;
    ctx.evidenceIds.push(ctx.evidenceId);
  });
  await test('SIDE-EFFECT: evidence row in DB with correct type and title', async () => {
    const { data } = await sb.from('hse_investigation_evidence')
      .select('evidence_type,title').eq('id', ctx.evidenceId).single();
    expect(data?.evidence_type === 'photo', `evidence_type: ${data?.evidence_type}`);
    expect((data?.title ?? '').includes(TAG), 'title not in DB');
  });
  await test('evidence appears in investigations/get response', async () => {
    const r = await api('hse/investigations/get', T.admin, { investigationId: ctx.investigationId });
    ok(r);
    expect((r.body.data?.evidence ?? []).some(e => e.id === ctx.evidenceId), 'evidence not in get response');
  });
  await test('VALIDATION: addEvidence empty title → rejected', async () => {
    fails(await api('hse/investigations/addEvidence', T.admin, {
      investigationId: ctx.investigationId, evidenceType: 'document', title: '',
    }));
  });
  await test('VALIDATION: addEvidence invalid evidenceType → rejected', async () => {
    // "video" is not in the enum (photo,document,statement,inspection,measurement,other).
    fails(await api('hse/investigations/addEvidence', T.admin, {
      investigationId: ctx.investigationId, evidenceType: 'video', title: 'test',
    }));
  });

  // ── Root Causes ────────────────────────────────────────────────────────────
  h.section('Investigations › Root Causes');

  await test('addRootCause: add primary root cause', async () => {
    const r = await api('hse/investigations/addRootCause', T.admin, {
      investigationId:    ctx.investigationId,
      category:           'human_factors',
      cause:              `${TAG} Inadequate training`,
      contributingFactor: false,
    });
    ok(r);
    expect(r.body.rootCauseId, 'no rootCauseId');
    ctx.rootCauseId = r.body.rootCauseId;
    ctx.rootCauseIds.push(ctx.rootCauseId);
  });
  await test('SIDE-EFFECT: root cause row in DB with correct category', async () => {
    const { data } = await sb.from('hse_root_causes').select('category,cause').eq('id', ctx.rootCauseId).single();
    expect(data?.category === 'human_factors', 'category mismatch');
    expect((data?.cause ?? '').includes(TAG), 'cause not in DB');
  });
  await test('addRootCause: contributing factor variant', async () => {
    const r = await api('hse/investigations/addRootCause', T.admin, {
      investigationId:    ctx.investigationId,
      category:           'environmental',
      cause:              `${TAG} Wet floor`,
      contributingFactor: true,
    });
    ok(r);
    ctx.rootCauseIds.push(r.body.rootCauseId);
  });
  await test('root causes appear in investigations/get', async () => {
    const r = await api('hse/investigations/get', T.admin, { investigationId: ctx.investigationId });
    ok(r);
    expect((r.body.data?.rootCauses ?? []).some(rc => rc.id === ctx.rootCauseId), 'root cause not in get response');
  });
  await test('VALIDATION: addRootCause empty category → rejected', async () => {
    fails(await api('hse/investigations/addRootCause', T.admin, {
      investigationId: ctx.investigationId, category: '', cause: 'something',
    }));
  });
  await test('VALIDATION: addRootCause empty cause → rejected', async () => {
    fails(await api('hse/investigations/addRootCause', T.admin, {
      investigationId: ctx.investigationId, category: 'human_factors', cause: '',
    }));
  });

  // ── CAPA › CRUD ────────────────────────────────────────────────────────────
  h.section('CAPA › CRUD');

  await test('capa/list returns array', async () => {
    const r = await api('hse/capa/list', T.admin);
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('capa/list response shape', async () => {
    const r = await api('hse/capa/list', T.admin, { limit: 5 });
    ok(r);
    if ((r.body.data || []).length > 0) {
      const row = r.body.data[0];
      for (const f of ['id','ref','title','status','priority','created_at']) {
        expect(row[f] !== undefined, `list row missing: ${f}`);
      }
    }
  });
  await test('capa/list overdue filter accepted', async () => {
    ok(await api('hse/capa/list', T.admin, { overdue: true }));
  });
  await test('ACCESS: capa/list denied without auth', async () => {
    fails(await api('hse/capa/list', null));
  });
  await test('ACCESS: B sees only own CAPAs', async () => {
    const r = await api('hse/capa/list', T.b);
    ok(r, 'B can list own CAPAs');
    expect((r.body.data || []).every(ca => ca.owner_user_id === b.id), 'B sees CAPAs not owned by them');
  });
  await test('VALIDATION: create empty title → rejected', async () => {
    fails(await api('hse/capa/create', T.admin, { sourceType:'incident', sourceId: ctx.incidentRef, title:'', description:'test' }));
  });
  await test('VALIDATION: create empty description → rejected', async () => {
    fails(await api('hse/capa/create', T.admin, { sourceType:'incident', sourceId: ctx.incidentRef, title:`${TAG} CAPA`, description:'' }));
  });
  await test('VALIDATION: create invalid priority → rejected', async () => {
    fails(await api('hse/capa/create', T.admin, { sourceType:'incident', sourceId: ctx.incidentRef, title:`${TAG} CAPA`, description:'test', priority:'extreme' }));
  });
  await test('FINDING: sourceType is free-form string (no enum/FK check)', async () => {
    const r = await api('hse/capa/create', T.admin, {
      sourceType:  'custom_source_type_not_in_enum',
      sourceId:    'fake-ref-000',
      title:       `${TAG} FreeformSrc CAPA`,
      description: 'Testing sourceType validation gap',
    });
    if (r.body.success) {
      ctx.capaIds.push(r.body.capaId ?? r.body.data?.id);
      console.warn('\n      FINDING: capa sourceType accepts any string — no enum or FK constraint on the route');
    }
    // Documented finding — not a hard failure.
  });
  await test('capa/create happy path', async () => {
    const r = await api('hse/capa/create', T.admin, {
      sourceType:  'incident',
      sourceId:    ctx.incidentRef,
      title:       `${TAG} CAPA Action`,
      description: 'Corrective action for test incident',
      ownerUserId: admin.id,
      priority:    'high',
      dueAt:       new Date(Date.now() + 14 * 86_400_000).toISOString(),
    });
    ok(r);
    ctx.capaId  = r.body.capaId ?? r.body.data?.id;
    ctx.capaRef = r.body.ref    ?? r.body.data?.ref;
    ctx.capaIds.push(ctx.capaId);
    expect(ctx.capaId, 'no capaId in response');
  });
  await test('SIDE-EFFECT: CAPA row in DB status=open priority=high', async () => {
    const { data } = await sb.from('hse_capa_actions').select('status,priority').eq('id', ctx.capaId).single();
    expect(data?.status === 'open', `expected open, got ${data?.status}`);
    expect(data?.priority === 'high', `priority mismatch: ${data?.priority}`);
  });
  await test('SIDE-EFFECT: hse.capa.assigned notification sent to assignee', async () => {
    const found = await waitFor(async () => {
      const { data } = await sb.from('notifications').select('id').eq('user_id', admin.id).eq('type','hse.capa.assigned')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.capa.assigned notification not delivered to assignee');
  });
  await test('capa/get by id', async () => {
    const r = await api('hse/capa/get', T.admin, { capaId: ctx.capaId });
    ok(r); expect(r.body.data?.id === ctx.capaId, 'id mismatch');
  });
  await test('capa/get by ref', async () => {
    const r = await api('hse/capa/get', T.admin, { ref: ctx.capaRef });
    ok(r); expect(r.body.data?.ref === ctx.capaRef, 'ref mismatch');
  });
  await test('capa/get non-existent → failure', async () => {
    fails(await api('hse/capa/get', T.admin, { capaId: '00000000-0000-0000-0000-000000000000' }));
  });

  // ── CAPA › Update lifecycle ────────────────────────────────────────────────
  h.section('CAPA › Update lifecycle');

  await test('advance to in_progress', async () => {
    ok(await api('hse/capa/update', T.admin, { capaId: ctx.capaId, status: 'in_progress' }));
    const { data } = await sb.from('hse_capa_actions').select('status').eq('id', ctx.capaId).single();
    expect(data?.status === 'in_progress', 'not in_progress');
  });
  await test('advance to implemented → completed_at set', async () => {
    ok(await api('hse/capa/update', T.admin, { capaId: ctx.capaId, status: 'implemented' }));
    const { data } = await sb.from('hse_capa_actions').select('status,completed_at').eq('id', ctx.capaId).single();
    expect(data?.status === 'implemented', 'not implemented');
    expect(data?.completed_at != null, 'completed_at not set on implemented');
  });
  await test('close → hse.capa.closed event emitted', async () => {
    ok(await api('hse/capa/update', T.admin, { capaId: ctx.capaId, status: 'closed', effectivenessResult: 'effective' }));
    const found = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type','hse.capa.closed')
        .order('created_at',{ascending:false}).limit(5);
      return (data ?? []).length > 0;
    });
    expect(found, 'hse.capa.closed event not emitted');
  });
  await test('VALIDATION: invalid status → rejected', async () => {
    fails(await api('hse/capa/update', T.admin, { capaId: ctx.capaId, status: 'flying' }));
  });
  await test('VALIDATION: invalid effectivenessResult → rejected', async () => {
    fails(await api('hse/capa/update', T.admin, { capaId: ctx.capaId, effectivenessResult: 'somewhat' }));
  });
  await test('VALIDATION: non-UUID capaId → rejected', async () => {
    fails(await api('hse/capa/update', T.admin, { capaId: 'not-a-uuid', status: 'open' }));
  });
  await test('ACCESS: update denied for B', async () => {
    fails(await api('hse/capa/update', T.b, { capaId: ctx.capaId, status: 'open' }));
  });

  // ── Full lifecycle chain ────────────────────────────────────────────────────
  h.section('Incidents › Full lifecycle chain');

  await test('Full chain: create→investigate→evidence→rootcause→CAPA→close', async () => {
    const incR = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title: `${TAG} FullChain`, severity: 'high',
    });
    ok(incR, 'step 1: create incident');
    const fId  = incR.body.data.id;
    const fRef = incR.body.data.ref;
    ctx.incidentIds.push(fId);

    const invR = await api('hse/investigations/create', T.admin, {
      incidentId: fId, investigatorUserId: admin.id, rootCauseMethod: '5why',
    });
    ok(invR, 'step 2: create investigation');
    const fInvId = invR.body.investigationId ?? invR.body.data?.id;
    ctx.investigationIds.push(fInvId);

    const evR = await api('hse/investigations/addEvidence', T.admin, {
      investigationId: fInvId, evidenceType: 'statement', title: `${TAG} Statement`,
    });
    ok(evR, 'step 3: add evidence');
    ctx.evidenceIds.push(evR.body.evidenceId);

    const rcR = await api('hse/investigations/addRootCause', T.admin, {
      investigationId: fInvId, category: 'process', cause: `${TAG} Process gap`, contributingFactor: false,
    });
    ok(rcR, 'step 4: add root cause');
    ctx.rootCauseIds.push(rcR.body.rootCauseId);

    const capaR = await api('hse/capa/create', T.admin, {
      sourceType: 'incident', sourceId: fRef,
      title: `${TAG} FullChain CAPA`, description: 'Full chain corrective action',
    });
    ok(capaR, 'step 5: create CAPA');
    const fCapaId = capaR.body.capaId ?? capaR.body.data?.id;
    ctx.capaIds.push(fCapaId);

    ok(await api('hse/capa/update', T.admin, { capaId: fCapaId, status: 'closed', effectivenessResult: 'effective' }), 'step 6: close CAPA');
    ok(await api('hse/investigations/update', T.admin, {
      investigationId: fInvId, status: 'closed', findings: `${TAG} complete`,
    }), 'step 7: close investigation');
    ok(await api('hse/incidents/update', T.admin, { incidentId: fId, status: 'closed' }), 'step 8: close incident');

    const { data } = await sb.from('hse_incidents').select('status').eq('id', fId).single();
    expect(data?.status === 'closed', 'incident not closed at end of chain');
  });

  // ── Idempotency ────────────────────────────────────────────────────────────
  h.section('Incidents › Idempotency');

  await test('idempotent create: same content key → same id, no duplicate row or workflow', async () => {
    // With the investigation binding live, create goes through
    // workflow_create_and_start_tx whose request-key receipt (content-derived
    // key) dedupes the retry; without a binding the module_mutation_runs ledger
    // does. Either way the OBSERVABLE invariant is identical: one row, one id,
    // at most one workflow.
    const payload = { ...baseIncident(), title: `${TAG} Idempotent`, incidentDate: '2026-01-15' };
    const r1 = await api('hse/incidents/create', T.admin, payload);
    const r2 = await api('hse/incidents/create', T.admin, payload);
    ok(r1, 'first create should succeed');
    ok(r2, 'second create should succeed (idempotent)');
    expect(r1.body.data?.id === r2.body.data?.id, 'idempotent creates returned different IDs — duplicate row created');
    if (r1.body.data?.id) ctx.incidentIds.push(r1.body.data.id);

    const { data: rows } = await sb.from('hse_incidents').select('id').eq('title', payload.title);
    expect((rows?.length ?? 0) === 1, `expected exactly 1 incident row, got ${rows?.length ?? 0}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id')
      .eq('source_record_id', r1.body.data.id);
    expect((wfs?.length ?? 0) <= 1, `expected at most 1 workflow for the incident, got ${wfs?.length ?? 0}`);
  });

  // ── Slice D1 — atomic create-and-start (finding #3) ────────────────────────
  h.section('Incidents › D1 atomic create-and-start');

  const d1WorkflowIds = [];
  h.onCleanup(async () => {
    if (d1WorkflowIds.length) {
      // Tasks/decisions/transitions cascade from the instance; only
      // workflow_handoffs.workflow_id (no ON DELETE) blocks it.
      await h.mustDelete('workflow_handoffs', q => q.in('workflow_id', d1WorkflowIds));
      await h.mustDelete('workflow_instances', q => q.in('id', d1WorkflowIds));
    }
  });

  await test('D1: incident create is ATOMIC — triage status + workflow + people + 1 event + 1 audit in one commit', async () => {
    const title = `${TAG} D1 Atomic Incident`;
    const r = await api('hse/incidents/create', T.admin, {
      ...baseIncident(), title, severity: 'high',
      people: [{ personType: 'injured', fullName: `${TAG} D1 Worker`, injuryDescription: 'Bruised arm' }],
    });
    ok(r, `create failed: ${r.body.message}`);
    const id = r.body.data.id;
    ctx.incidentIds.push(id);

    const { data: row } = await sb.from('hse_incidents')
      .select('status, workflow_id, ref').eq('id', id).single();
    expect(row?.status === 'triage', `expected triage (atomic onStarted), got ${row?.status}`);
    expect(row?.workflow_id != null, 'workflow_id must be linked in-commit');
    expect(r.body.data.workflowId === row.workflow_id, 'response workflowId != row workflow_id');
    d1WorkflowIds.push(row.workflow_id);

    const { data: wf } = await sb.from('workflow_instances')
      .select('status, module_key, workflow_type').eq('id', row.workflow_id).single();
    expect(wf?.status === 'in_progress', `expected in_progress workflow, got ${wf?.status}`);
    expect(wf?.module_key === 'hse_incidents' && wf?.workflow_type === 'incident_investigation',
      `unexpected workflow identity ${wf?.module_key}/${wf?.workflow_type}`);

    const { data: tasks } = await sb.from('workflow_tasks')
      .select('id, status, assigned_role').eq('workflow_id', row.workflow_id).eq('status', 'pending');
    expect((tasks?.length ?? 0) >= 1, 'expected a pending first-step task');
    expect(tasks?.[0]?.assigned_role === 'manager', `expected manager task, got ${tasks?.[0]?.assigned_role}`);

    const { data: people } = await sb.from('hse_incident_people').select('id').eq('incident_id', id);
    expect((people?.length ?? 0) === 1, `expected 1 person row (atomic satellite), got ${people?.length ?? 0}`);

    const { data: events } = await sb.from('app_events').select('id')
      .eq('event_type', 'hse.incident.submitted').eq('source_entity_id', id);
    expect((events?.length ?? 0) === 1, `expected exactly 1 app_event, got ${events?.length ?? 0}`);

    const { data: audits } = await sb.from('audit_logs').select('id')
      .eq('action', 'hse.incident.submitted').eq('record_id', row.ref);
    expect((audits?.length ?? 0) === 1, `expected exactly 1 audit_logs row keyed by ref, got ${audits?.length ?? 0}`);
  });

  await test('D1: incident + all conditional handoffs commit once and retry idempotently', async () => {
    const payload = {
      ...baseIncident(), title: `${TAG} D1 All Handoffs`, severity: 'high',
      lostTime: true, lostDays: 3, costImpact: true, equipmentDamage: true,
      people: [{ personType: 'injured', fullName: `${TAG} D1 LT Worker`, userId: admin.id }],
    };
    const r = await api('hse/incidents/create', T.admin, payload);
    const retry = await api('hse/incidents/create', T.admin, payload);
    ok(r, `create failed: ${r.body.message}`);
    ok(retry, `retry failed: ${retry.body.message}`);
    expect(retry.body.data.id === r.body.data.id, 'retry returned a different incident');
    ctx.incidentIds.push(r.body.data.id);
    const { data: rowLt } = await sb.from('hse_incidents').select('workflow_id,metadata').eq('id', r.body.data.id).single();
    if (rowLt?.workflow_id) d1WorkflowIds.push(rowLt.workflow_id);
    expect(rowLt?.metadata?.costImpact === true, 'costImpact must persist on the incident');
    expect(rowLt?.metadata?.equipmentDamage === true, 'equipmentDamage must persist on the incident');
    expect(r.body.data.handoffIds?.length === 3, `expected 3 handoff ids, got ${r.body.data.handoffIds?.length}`);
    expect(JSON.stringify(retry.body.data.handoffIds) === JSON.stringify(r.body.data.handoffIds), 'retry returned different handoff ids');

    const [{ data: handoffs }, { data: handoffEvents }, { data: incidents }] = await Promise.all([
      sb.from('handoff_outbox').select('id,target_module').eq('source_entity_id', r.body.data.id).order('target_module'),
      sb.from('app_events').select('id').eq('event_type', 'handoff.created').eq('source_entity_id', r.body.data.id),
      sb.from('hse_incidents').select('id').eq('id', r.body.data.id),
    ]);
    expect(handoffs?.length === 3, `expected exactly 3 handoffs, got ${handoffs?.length}`);
    expect(handoffs?.map(x => x.target_module).join(',') === 'finance,hr,operations', 'wrong handoff targets');
    expect(handoffEvents?.length === 3, `expected exactly 3 handoff events, got ${handoffEvents?.length}`);
    expect(incidents?.length === 1, `retry duplicated the incident: ${incidents?.length}`);
  });

  await test('D1: CAPA create is ATOMIC — open status + closure workflow + 1 event + 1 audit', async () => {
    const title = `${TAG} D1 Atomic CAPA`;
    const r = await api('hse/capa/create', T.admin, {
      sourceType: 'incident', sourceId: ctx.incidentRef ?? 'standalone',
      title, description: 'D1 atomicity check', ownerUserId: admin.id, priority: 'high',
    });
    ok(r, `capa create failed: ${r.body.message}`);
    const id = r.body.capaId ?? r.body.data?.id;
    ctx.capaIds.push(id);

    const { data: row } = await sb.from('hse_capa_actions')
      .select('status, workflow_id, ref').eq('id', id).single();
    expect(row?.status === 'open', `expected open (capa_closure has no onStarted flip), got ${row?.status}`);
    expect(row?.workflow_id != null, 'workflow_id must be linked in-commit');
    d1WorkflowIds.push(row.workflow_id);

    const { data: wf } = await sb.from('workflow_instances')
      .select('status, module_key, workflow_type').eq('id', row.workflow_id).single();
    expect(wf?.status === 'in_progress' && wf?.module_key === 'hse_capa' && wf?.workflow_type === 'capa_closure',
      `unexpected workflow ${wf?.module_key}/${wf?.workflow_type}/${wf?.status}`);

    const { data: events } = await sb.from('app_events').select('id')
      .eq('event_type', 'hse.capa.assigned').eq('source_entity_id', id);
    expect((events?.length ?? 0) === 1, `expected exactly 1 app_event, got ${events?.length ?? 0}`);

    const { data: audits } = await sb.from('audit_logs').select('id')
      .eq('action', 'hse.capa.assigned').eq('record_id', row.ref);
    expect((audits?.length ?? 0) === 1, `expected exactly 1 audit_logs row, got ${audits?.length ?? 0}`);

    // Idempotent retry: same content-derived key → same record, no dup workflow.
    const r2 = await api('hse/capa/create', T.admin, {
      sourceType: 'incident', sourceId: ctx.incidentRef ?? 'standalone',
      title, description: 'D1 atomicity check', ownerUserId: admin.id, priority: 'high',
    });
    ok(r2, 'retry should succeed via the RPC receipt');
    const id2 = r2.body.capaId ?? r2.body.data?.id;
    expect(id2 === id || (r2.body.data?.recordId ?? null) === id,
      `retry must return the same CAPA (got ${id2})`);
    const { data: wfs } = await sb.from('workflow_instances').select('id')
      .eq('source_record_id', id);
    expect((wfs?.length ?? 0) === 1, `expected exactly 1 workflow for the CAPA, got ${wfs?.length ?? 0}`);
  });
}
