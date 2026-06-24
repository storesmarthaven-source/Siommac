/**
 * scripts/e2e/suites/training.mjs
 *
 * Comprehensive E2E suite for the HSE Training / Competency module.
 * Backend route: hseTraining.ts, mounted at /api/hse/. Covers:
 *   training/competencies/{list,create,update}
 *   training/courses/{list,create}
 *   training/requirements/{list,create,delete}
 *   training/certificates/{list,get,create,renew,verify,reject,revoke,archive}
 *   training/certificates/evidence/add
 *   training/assignments/{list,create,complete,cancel}
 *   training/competency-matrix · training/stats · training/dashboard
 *
 * Permissions: hse.training.view · .manage · .verify
 * §2 side-effects asserted via the service-role client (app_events + audit).
 */

export const title = 'HSE Training / Competency';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  const ctx = { competencyIds: [], courseIds: [], requirementIds: [], certIds: [], certRefs: [], assignmentIds: [], assignmentRefs: [] };
  let seq = 0;
  const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
  const past = (days) => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);

  const waitFor = async (check, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };
  const certStatus = async (id) => (await sb.from('hse_worker_certificates').select('status').eq('id', id).single()).data?.status;

  const mkCert = (over = {}) => ({
    workerId: b.id, courseName: `${TAG} Confined Space ${++seq}`, issuedAt: past(10), expiresAt: future(365), ...over,
  });
  const createCert = async (over = {}) => {
    const r = await api('hse/training/certificates/create', T.admin, mkCert(over));
    ok(r, 'cert create failed');
    if (r.body.data?.id) ctx.certIds.push(r.body.data.id);
    if (r.body.data?.certificateNo) ctx.certRefs.push(r.body.data.certificateNo);
    return r.body.data;
  };

  h.onCleanup(async () => {
    // NOTE: a supabase-js builder is a thenable but has no `.catch`; guard each
    // delete with try/catch (matches the inspections suite) so one failure can't
    // abort the rest and leak TEST-E2E rows.
    const refs = [...ctx.certRefs, ...ctx.assignmentRefs];
    try { if (refs.length) await sb.from('app_events').delete().in('source_entity_id', refs); } catch {}
    try { await sb.from('notifications').delete().ilike('title', '%Training%'); } catch {}
    // tag sweeps (belt-and-suspenders) + tracked ids
    try { await sb.from('hse_worker_certificates').delete().ilike('course_name', `%${TAG}%`); } catch {}
    try { if (ctx.certIds.length) await sb.from('hse_worker_certificates').delete().in('id', ctx.certIds); } catch {}
    try { if (ctx.assignmentIds.length) await sb.from('hse_training_assignments').delete().in('id', ctx.assignmentIds); } catch {}
    try { if (ctx.requirementIds.length) await sb.from('hse_training_requirements').delete().in('id', ctx.requirementIds); } catch {}
    try { if (ctx.courseIds.length) await sb.from('hse_training_courses').delete().in('id', ctx.courseIds); } catch {}
    try { await sb.from('hse_training_competencies').delete().ilike('name', `%${TAG}%`); } catch {}
    try { if (ctx.competencyIds.length) await sb.from('hse_training_competencies').delete().in('id', ctx.competencyIds); } catch {}
  });

  // ── Setup: competency / course / requirement ──────────────────────────────────
  h.section('Training › Setup (competency / course / requirement)');

  let compId, courseId, reqId;
  await test('competencies/create', async () => {
    const r = await api('hse/training/competencies/create', T.admin, { name: `${TAG} Confined Space`, code: `${TAG}-CS`, defaultRenewalWindowDays: 90, requiresVerification: true });
    ok(r); compId = r.body.data?.id; expect(compId, 'no competency id'); ctx.competencyIds.push(compId);
  });
  await test('competencies/list contains it', async () => {
    const r = await api('hse/training/competencies/list', T.admin, {});
    ok(r); expect((r.body.data || []).some(x => x.id === compId), 'competency not listed');
  });
  await test('courses/create linked to competency', async () => {
    const r = await api('hse/training/courses/create', T.admin, { name: `${TAG} CS Entry L1`, competencyId: compId, provider: 'E2E Provider' });
    ok(r); courseId = r.body.data?.id; expect(courseId, 'no course id'); ctx.courseIds.push(courseId);
  });
  await test('requirements/create (role-scoped)', async () => {
    const r = await api('hse/training/requirements/create', T.admin, { competencyId: compId, roleName: b.role, requirementLevel: 'required' });
    ok(r); reqId = r.body.data?.id; expect(reqId, 'no requirement id'); ctx.requirementIds.push(reqId);
  });
  await test('VALIDATION: requirement with no scope → rejected', async () => {
    fails(await api('hse/training/requirements/create', T.admin, { competencyId: compId, requirementLevel: 'required' }), 'requirement needs a scope');
  });
  await test('ACCESS: competencies/list denied without auth', async () => {
    fails(await api('hse/training/competencies/list', null));
  });

  // ── Certificates — create + side-effects ──────────────────────────────────────
  h.section('Training › Certificates — create');

  await test('VALIDATION: expiry before issued → rejected', async () => {
    fails(await api('hse/training/certificates/create', T.admin, mkCert({ issuedAt: future(10), expiresAt: past(10) })));
  });
  await test('VALIDATION: empty payload → rejected', async () => {
    fails(await api('hse/training/certificates/create', T.admin, {}));
  });

  let cert;
  await test('create certificate → pending_verification', async () => {
    cert = await createCert({ competencyId: compId, courseId });
    expect(cert?.id, 'no id'); expect(cert?.certificateNo, 'no certificateNo');
    expect(await certStatus(cert.id) === 'pending_verification', `expected pending_verification, got ${await certStatus(cert.id)}`);
  });
  await test('SIDE-EFFECT: hse.training.certificate.created app_event', async () => {
    const found = await waitFor(async () => ((await sb.from('app_events').select('id').eq('event_type', 'hse.training.certificate.created').order('created_at', { ascending: false }).limit(10)).data ?? []).length > 0);
    expect(found, 'created event not emitted');
  });
  await test('SIDE-EFFECT: audit "created" row', async () => {
    const found = await waitFor(async () => ((await sb.from('hse_training_audit_events').select('id').eq('entity_type', 'certificate').eq('entity_id', cert.id).eq('action', 'created').limit(1)).data ?? []).length > 0);
    expect(found, 'created audit not written');
  });

  // ── Certificates — list / get ─────────────────────────────────────────────────
  h.section('Training › Certificates — list / get');

  await test('certificates/list response shape', async () => {
    const r = await api('hse/training/certificates/list', T.admin, { workerId: b.id, limit: 200 });
    ok(r);
    const row = (r.body.data || []).find(x => x.id === cert.id);
    expect(row, 'cert not in list');
    for (const f of ['id', 'certificate_no', 'worker_id', 'course_name', 'issued_at', 'expires_at', 'status']) expect(f in row, `missing field ${f}`);
  });
  await test('certificates/get returns cert + arrays', async () => {
    const r = await api('hse/training/certificates/get', T.admin, { certificateId: cert.id });
    ok(r);
    expect(r.body.data?.certificate, 'certificate missing');
    for (const f of ['evidence', 'verifications', 'audit']) expect(Array.isArray(r.body.data?.[f]), `${f} not array`);
  });

  // ── Verification lifecycle ────────────────────────────────────────────────────
  h.section('Training › Verification');

  await test('verify → current (records a verification row)', async () => {
    ok(await api('hse/training/certificates/verify', T.admin, { certificateId: cert.id, comments: 'looks good' }));
    expect(await certStatus(cert.id) === 'current', `expected current, got ${await certStatus(cert.id)}`);
    const { data } = await sb.from('hse_certificate_verifications').select('decision').eq('certificate_id', cert.id);
    expect((data ?? []).some(v => v.decision === 'approved'), 'verification row not written');
  });
  await test('GATE: verify again from current → rejected', async () => {
    fails(await api('hse/training/certificates/verify', T.admin, { certificateId: cert.id }), 'cannot verify a current cert');
  });
  await test('reject a fresh certificate', async () => {
    const d = await createCert({ competencyId: compId });
    ok(await api('hse/training/certificates/reject', T.admin, { certificateId: d.id, reason: 'illegible scan' }));
    expect(await certStatus(d.id) === 'rejected', 'not rejected');
  });
  await test('revoke a current certificate', async () => {
    const d = await createCert();
    ok(await api('hse/training/certificates/verify', T.admin, { certificateId: d.id }));
    ok(await api('hse/training/certificates/revoke', T.admin, { certificateId: d.id, reason: 'fraudulent' }));
    expect(await certStatus(d.id) === 'revoked', 'not revoked');
  });
  await test('renew → new cert (pending) + previous archived', async () => {
    const r = await api('hse/training/certificates/renew', T.admin, { certificateId: cert.id, issuedAt: past(1), expiresAt: future(730) });
    ok(r);
    expect(r.body.data?.id, 'no renewed id'); ctx.certIds.push(r.body.data.id);
    expect(await certStatus(cert.id) === 'archived', 'previous not archived');
    expect(await certStatus(r.body.data.id) === 'pending_verification', 'renewal not pending');
  });

  // ── Evidence ──────────────────────────────────────────────────────────────────
  h.section('Training › Evidence');

  await test('evidence/add records a row', async () => {
    const d = await createCert();
    const r = await api('hse/training/certificates/evidence/add', T.admin, { certificateId: d.id, fileName: 'cert.pdf', filePath: `training/${d.id}/cert.pdf`, evidenceType: 'certificate' });
    ok(r); expect(r.body.data?.id, 'no evidence id');
    const g = await api('hse/training/certificates/get', T.admin, { certificateId: d.id });
    expect((g.body.data.evidence || []).length > 0, 'evidence not on get');
  });

  // ── Assignments ───────────────────────────────────────────────────────────────
  h.section('Training › Assignments');

  let assignment;
  await test('assignments/create → assigned', async () => {
    const r = await api('hse/training/assignments/create', T.admin, { workerId: b.id, competencyId: compId, reason: `${TAG} gap`, priority: 'high', dueAt: future(14) });
    ok(r); assignment = r.body.data; expect(assignment?.id, 'no id'); ctx.assignmentIds.push(assignment.id);
    if (assignment.assignmentNo) ctx.assignmentRefs.push(assignment.assignmentNo);
  });
  await test('SIDE-EFFECT: hse.training.assignment.created app_event', async () => {
    const found = await waitFor(async () => ((await sb.from('app_events').select('id').eq('event_type', 'hse.training.assignment.created').order('created_at', { ascending: false }).limit(10)).data ?? []).length > 0);
    expect(found, 'assignment created event not emitted');
  });
  await test('assignments/list filters by worker', async () => {
    const r = await api('hse/training/assignments/list', T.admin, { workerId: b.id });
    ok(r); expect((r.body.data || []).some(a => a.id === assignment.id), 'assignment not listed');
  });
  await test('assignments/complete', async () => {
    ok(await api('hse/training/assignments/complete', T.admin, { assignmentId: assignment.id }));
    const { data } = await sb.from('hse_training_assignments').select('status').eq('id', assignment.id).single();
    expect(data?.status === 'completed', 'not completed');
  });
  await test('assignments/cancel', async () => {
    const r = await api('hse/training/assignments/create', T.admin, { workerId: b.id, competencyId: compId, dueAt: future(20) });
    ok(r); ctx.assignmentIds.push(r.body.data.id);
    ok(await api('hse/training/assignments/cancel', T.admin, { assignmentId: r.body.data.id, note: 'dup' }));
    const { data } = await sb.from('hse_training_assignments').select('status').eq('id', r.body.data.id).single();
    expect(data?.status === 'cancelled', 'not cancelled');
  });

  // ── Competency matrix engine ──────────────────────────────────────────────────
  h.section('Training › Competency matrix');

  await test('matrix includes worker B with the required competency', async () => {
    const r = await api('hse/training/competency-matrix', T.admin, {});
    ok(r);
    const row = (r.body.data || []).find(x => x.workerId === b.id);
    expect(row, 'worker B not in matrix (role requirement should apply)');
    const cell = (row.competencies || []).find(cc => cc.competencyId === compId);
    expect(cell, 'required competency not on B row');
    expect(['ok', 'due_soon', 'expired', 'missing', 'pending_verification'].includes(cell.status), `unexpected cell status ${cell.status}`);
    expect(typeof row.requiredCount === 'number' && typeof row.compliantCount === 'number', 'compliance counts missing');
  });

  // ── Stats ─────────────────────────────────────────────────────────────────────
  h.section('Training › Stats');

  await test('stats returns the card contract', async () => {
    const r = await api('hse/training/stats', T.admin);
    ok(r);
    for (const f of ['overallCompliancePercent', 'compliantSlots', 'totalRequiredSlots', 'currentCerts', 'dueForRenewal', 'expired', 'totalCertificates']) {
      expect(typeof r.body.data?.[f] === 'number', `stats.${f} missing`);
    }
  });

  // ── Requirements delete ───────────────────────────────────────────────────────
  h.section('Training › Requirements');

  await test('requirements/delete deactivates', async () => {
    const r = await api('hse/training/requirements/create', T.admin, { competencyId: compId, roleName: 'employee', requirementLevel: 'recommended' });
    ok(r); ctx.requirementIds.push(r.body.data.id);
    ok(await api('hse/training/requirements/delete', T.admin, { requirementId: r.body.data.id }));
    const { data } = await sb.from('hse_training_requirements').select('is_active').eq('id', r.body.data.id).single();
    expect(data?.is_active === false, 'not deactivated');
  });

  // ── Access control ──────────────────────────────────────────────────────────
  h.section('Training › Access control');

  await test('ACCESS: core endpoints deny without auth', async () => {
    for (const p of ['hse/training/certificates/list', 'hse/training/stats', 'hse/training/competency-matrix', 'hse/training/competencies/list']) {
      fails(await api(p, null, {}), `${p} should deny without auth`);
    }
  });
  await test('ACCESS: non-privileged B denied on manage + verify', async () => {
    fails(await api('hse/training/competencies/create', T.b, { name: 'x' }), 'B should not create competencies');
    fails(await api('hse/training/certificates/verify', T.b, { certificateId: cert.id }), 'B should not verify');
  });
}
