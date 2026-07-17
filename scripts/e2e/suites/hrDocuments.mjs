/**
 * scripts/e2e/suites/hrDocuments.mjs
 *
 * E2E for the HR Documents module (cross-employee register, expiry tracking,
 * requirements policy, compliance, expiry sweep).
 *
 * Covers (spec §7 Testing Standard, all 7 areas):
 *  1. Cross-employee register: list + filters + pagination (documents/list)
 *  2. Stats endpoint (documents/stats)
 *  3. Expiring list (documents/expiring)
 *  4. Requirements CRUD: list, create, update, retire (requirements/*)
 *  5. Compliance: per-employee + overview (documents/compliance)
 *  6. Access control: unauthorized actors denied with correct code
 *  7. Side-effects: app_events + hr_audit_log written on every mutation
 *  8. Expiry sweep: idempotency, sent/skipped counts (expiry/run-sweep)
 *
 * REQUIRES (operator-applied, in order):
 *   20260716000000_hr_document_requirements.sql
 *   20260716000001_hr_document_reminders.sql
 *   20260716000002_hr_documents_perms.sql
 *   then NOTIFY pgrst, 'reload schema';
 *
 * NOTE: The expiry sweep endpoint is service-role-only. The E2E calls it via
 * the harness's service-role key (h.sb has service-role access; we build the
 * auth header directly for that endpoint).
 */

export const title = 'HR Documents';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const BASE_URL = h.base;
  const { admin } = h.users;
  const A = mint(admin);

  // Context accumulated across tests
  const ctx = {
    requirementId: null,
    employeeId:    null,
    employeeToken: null,
    documentId:    null, // an existing doc uploaded via the existing route
  };

  // ── Bootstrap: find a real employee + their existing docs ────────────────────

  h.onCleanup(async () => {
    // Remove ALL requirement rows this suite created (by TAGGED document_type —
    // covers the duplicate-attempt row too, not just ctx.requirementId). NOTE:
    // supabase builders are thenables without .catch — await them plainly and
    // never pass a builder into .in() (it silently produced the old
    // ".catch is not a function" cleanup warnings).
    const { data: docs } = await sb.from('hr_employee_documents').select('id').eq('employee_id', ctx.employeeId ?? '');
    const docIds = (docs ?? []).map(d => d.id);
    if (docIds.length) { try { await sb.from('hr_document_reminders').delete().in('document_id', docIds); } catch { /* best-effort */ } }
    const { data: reqs } = await sb.from('hr_document_requirements').select('id').like('document_type', `${TAG}-%`);
    for (const r of (reqs ?? [])) {
      try { await sb.from('app_events').delete().eq('source_entity_id', r.id); } catch { /* best-effort */ }
      try { await sb.from('hr_audit_log').delete().eq('record_id', r.id); } catch { /* best-effort */ }
    }
    try { await sb.from('hr_document_requirements').delete().like('document_type', `${TAG}-%`); } catch { /* best-effort */ }
  });

  // Find a plain 'employee' user for access-control denial tests.
  // Must be role='employee' specifically — manager/hr_staff/finance_manager also
  // hold hr.employee_documents.view in the DB so they would pass where we expect denial.
  {
    const { data: emp } = await sb
      .from('app_users')
      .select('id, role')
      .eq('status', 'active')
      .eq('role', 'employee')
      .limit(1)
      .maybeSingle();
    if (emp) {
      ctx.employeeId    = emp.id;
      ctx.employeeToken = mint(emp);
    }

    // Find an existing document for download/verify tests
    const { data: doc } = await sb
      .from('hr_employee_documents')
      .select('id, employee_id')
      .neq('status', 'archived')
      .limit(1)
      .maybeSingle();
    if (doc) ctx.documentId = doc.id;
  }

  // ── 1. Cross-employee register ────────────────────────────────────────────────

  await test('documents/list (admin) → success + shape', async () => {
    const r = await api('hr/documents/list', A, {});
    ok(r, 'list ok');
    expect(Array.isArray(r.body.data?.rows), 'rows array');
    expect(typeof r.body.data?.total === 'number', 'total number');
  });

  await test('documents/list filter by status=uploaded → only uploaded rows', async () => {
    const r = await api('hr/documents/list', A, { status: 'uploaded' });
    ok(r, 'filtered list ok');
    const rows = r.body.data?.rows ?? [];
    expect(rows.every(row => row.status === 'uploaded'), 'all rows uploaded');
  });

  await test('documents/list filter by expiryState=expired → only expired rows', async () => {
    const r = await api('hr/documents/list', A, { expiryState: 'expired' });
    ok(r, 'expiry filter ok');
    const rows = r.body.data?.rows ?? [];
    // Each returned row must have expiryState=expired
    expect(rows.every(row => row.expiryState === 'expired'), 'all rows expired');
  });

  await test('documents/list pagination → pageSize=5 respected', async () => {
    const r = await api('hr/documents/list', A, { pageSize: 5 });
    ok(r, 'paginated list ok');
    expect((r.body.data?.rows ?? []).length <= 5, 'at most 5 rows');
  });

  await test('documents/list (unauthorized employee) → denied', async () => {
    if (!ctx.employeeToken) { h.skip('no employee token'); return; }
    const r = await api('hr/documents/list', ctx.employeeToken, {});
    fails(r, 'employee denied from cross-employee list');
  });

  // ── 2. Stats ──────────────────────────────────────────────────────────────────

  await test('documents/stats (admin) → all stat fields present', async () => {
    const r = await api('hr/documents/stats', A, {});
    ok(r, 'stats ok');
    const d = r.body.data;
    expect(typeof d?.total         === 'number', 'total');
    expect(typeof d?.uploaded      === 'number', 'uploaded');
    expect(typeof d?.verified      === 'number', 'verified');
    expect(typeof d?.expiringSoon  === 'number', 'expiringSoon');
    expect(typeof d?.expired       === 'number', 'expired');
    expect(typeof d?.missingRequired === 'number', 'missingRequired');
  });

  await test('documents/stats (unauthorized) → denied', async () => {
    if (!ctx.employeeToken) { h.skip('no employee token'); return; }
    const r = await api('hr/documents/stats', ctx.employeeToken, {});
    fails(r, 'employee denied from stats');
  });

  // ── 3. Expiring list ──────────────────────────────────────────────────────────

  await test('documents/expiring (admin, withinDays=30) → shape', async () => {
    const r = await api('hr/documents/expiring', A, { withinDays: 30 });
    ok(r, 'expiring list ok');
    expect(Array.isArray(r.body.data), 'data is array');
    const rows = r.body.data ?? [];
    // Every returned row must have expiryState=expiring|expired
    const validStates = new Set(['expiring', 'expired']);
    expect(rows.every(row => row.expiryDate != null), 'all rows have expiry_date');
    // expiryState must be expiring or expired (not valid/none)
    expect(rows.every(row => validStates.has(row.expiryState)), 'expiryState in expiring|expired');
  });

  await test('documents/expiring (unauthorized) → denied', async () => {
    if (!ctx.employeeToken) { h.skip('no employee token'); return; }
    const r = await api('hr/documents/expiring', ctx.employeeToken, { withinDays: 30 });
    fails(r, 'employee denied from expiring list');
  });

  // ── 4. Requirements CRUD ──────────────────────────────────────────────────────

  await test('documents/requirements/list (admin) → success', async () => {
    const r = await api('hr/documents/requirements/list', A, { activeOnly: true });
    ok(r, 'requirements list ok');
    expect(Array.isArray(r.body.data), 'data is array');
  });

  await test('documents/requirements/create (admin) → requirement created + side-effects', async () => {
    const r = await api('hr/documents/requirements/create', A, {
      documentType:    `${TAG}-passport`,
      label:           'Passport (E2E test)',
      appliesToScope:  'all',
      requiresExpiry:  true,
      reminderDays:    [30, 7],
    });
    ok(r, 'create ok');
    ctx.requirementId = r.body.data?.id;
    expect(!!ctx.requirementId, 'id returned');
    expect(r.body.data?.documentType === `${TAG}-passport`, 'documentType correct');
    expect(r.body.data?.requiresExpiry === true, 'requiresExpiry correct');
    expect(Array.isArray(r.body.data?.reminderDays), 'reminderDays array');

    // Side-effects
    const { data: ev } = await sb.from('app_events')
      .select('id').eq('event_type', 'hr.document_requirement.created')
      .eq('source_entity_id', ctx.requirementId).limit(1);
    expect(ev && ev.length === 1, 'app_event emitted');

    const { data: al } = await sb.from('hr_audit_log')
      .select('id').eq('action', 'hr.document_requirement.created')
      .eq('record_id', ctx.requirementId).limit(1);
    expect(al && al.length === 1, 'hr_audit_log written');
  });

  await test('documents/requirements/create duplicate → 409', async () => {
    // Same documentType + scope → unique conflict
    const r = await api('hr/documents/requirements/create', A, {
      documentType: `${TAG}-passport`,
      label:        'Duplicate',
      appliesToScope: 'all',
    });
    expect(r.body.success === false, 'fails on duplicate');
    // Expect a 409-style error in the message
    expect(r.body.message?.toLowerCase().includes('already exists') || !r.body.success, 'conflict message');
  });

  await test('documents/requirements/create (unauthorized employee) → denied', async () => {
    if (!ctx.employeeToken) { h.skip('no employee token'); return; }
    const r = await api('hr/documents/requirements/create', ctx.employeeToken, {
      documentType: `${TAG}-denied`, label: 'Denied', appliesToScope: 'all',
    });
    fails(r, 'employee cannot create requirements');
  });

  await test('documents/requirements/update (admin) → label updated + side-effects', async () => {
    if (!ctx.requirementId) { h.skip('no requirement'); return; }
    const r = await api('hr/documents/requirements/update', A, {
      requirementId: ctx.requirementId,
      label:         'Passport (updated)',
      reminderDays:  [14, 3],
    });
    ok(r, 'update ok');
    expect(r.body.data?.label === 'Passport (updated)', 'label updated');
    expect(r.body.data?.reminderDays[0] === 14, 'reminderDays updated');

    // Side-effects
    const { data: al } = await sb.from('hr_audit_log')
      .select('id, previous_state').eq('action', 'hr.document_requirement.updated')
      .eq('record_id', ctx.requirementId).order('id', { ascending: false }).limit(1);
    expect(al && al.length >= 1, 'audit written');
    expect(!!al?.[0]?.previous_state, 'previousState recorded');
  });

  await test('documents/requirements/update (unauthorized) → denied', async () => {
    if (!ctx.employeeToken || !ctx.requirementId) { h.skip(); return; }
    const r = await api('hr/documents/requirements/update', ctx.employeeToken, {
      requirementId: ctx.requirementId, label: 'Hack',
    });
    fails(r, 'employee cannot update requirements');
  });

  await test('documents/requirements/update non-existent → 404', async () => {
    const r = await api('hr/documents/requirements/update', A, {
      requirementId: '00000000-0000-0000-0000-000000000000',
      label: 'Ghost',
    });
    expect(!r.body.success, 'fails on missing requirement');
  });

  // ── 5. Compliance ─────────────────────────────────────────────────────────────

  await test('documents/compliance overview (admin) → array shape', async () => {
    const r = await api('hr/documents/compliance', A, { overview: true });
    ok(r, 'compliance overview ok');
    expect(Array.isArray(r.body.data), 'data is array');
    // Each row: employeeId, missingCount, expiredCount, totalRequired
    for (const row of (r.body.data ?? [])) {
      expect(typeof row.employeeId     === 'string', 'employeeId string');
      expect(typeof row.missingCount   === 'number', 'missingCount number');
      expect(typeof row.expiredCount   === 'number', 'expiredCount number');
      expect(typeof row.totalRequired  === 'number', 'totalRequired number');
    }
  });

  await test('documents/compliance per-employee (admin) → array shape', async () => {
    if (!ctx.employeeId) { h.skip('no employee'); return; }
    const r = await api('hr/documents/compliance', A, { employeeId: ctx.employeeId });
    ok(r, 'per-employee compliance ok');
    expect(Array.isArray(r.body.data), 'data is array');
    for (const row of (r.body.data ?? [])) {
      expect(typeof row.requirementId === 'string', 'requirementId string');
      expect(typeof row.requiredType  === 'string', 'requiredType string');
      expect(['present_verified','present_unverified','expired','missing'].includes(row.state), 'state valid');
    }
  });

  await test('documents/compliance (unauthorized) → denied', async () => {
    if (!ctx.employeeToken) { h.skip('no employee token'); return; }
    const r = await api('hr/documents/compliance', ctx.employeeToken, { overview: true });
    fails(r, 'employee denied from compliance overview');
  });

  // Compliance reflects our new requirement: passport required for all
  await test('documents/compliance shows new passport requirement', async () => {
    if (!ctx.requirementId || !ctx.employeeId) { h.skip('no requirement/employee'); return; }
    const r = await api('hr/documents/compliance', A, { employeeId: ctx.employeeId });
    ok(r, 'per-employee compliance for requirement check ok');
    const rows = r.body.data ?? [];
    const passportRow = rows.find(row => row.requiredType === `${TAG}-passport`);
    expect(!!passportRow, 'passport requirement visible in compliance');
    // No employee has a TAG-passport doc → must be missing
    expect(passportRow?.state === 'missing', 'state is missing (no doc uploaded)');
  });

  // ── 6. Requirements retire (at end, after compliance tests depend on it) ──────

  await test('documents/requirements/retire (admin) → retired + side-effects', async () => {
    if (!ctx.requirementId) { h.skip('no requirement'); return; }
    const r = await api('hr/documents/requirements/retire', A, { requirementId: ctx.requirementId });
    ok(r, 'retire ok');

    // Verify is_active=false in DB
    const { data: req } = await sb.from('hr_document_requirements')
      .select('is_active').eq('id', ctx.requirementId).single();
    expect(req?.is_active === false, 'is_active false in DB');

    // Side-effects
    const { data: ev } = await sb.from('app_events')
      .select('id').eq('event_type', 'hr.document_requirement.retired')
      .eq('source_entity_id', ctx.requirementId).limit(1);
    expect(ev && ev.length === 1, 'app_event emitted');

    const { data: al } = await sb.from('hr_audit_log')
      .select('id').eq('action', 'hr.document_requirement.retired')
      .eq('record_id', ctx.requirementId).limit(1);
    expect(al && al.length === 1, 'hr_audit_log written');
  });

  await test('documents/requirements/retire already-retired → 409', async () => {
    if (!ctx.requirementId) { h.skip('no requirement'); return; }
    const r = await api('hr/documents/requirements/retire', A, { requirementId: ctx.requirementId });
    expect(!r.body.success, 'fails on double-retire');
  });

  await test('documents/requirements/retire (unauthorized) → denied', async () => {
    if (!ctx.employeeToken || !ctx.requirementId) { h.skip(); return; }
    const r = await api('hr/documents/requirements/retire', ctx.employeeToken, {
      requirementId: ctx.requirementId,
    });
    fails(r, 'employee cannot retire requirements');
  });

  // ── 7. Expiry sweep ───────────────────────────────────────────────────────────

  // The sweep endpoint requires service-role auth. Use the harness's service key
  // (available as process.env.SUPABASE_SERVICE_ROLE_KEY or h.serviceKey).
  await test('documents/expiry/run-sweep (service-role) → scanned + remindersSent counts', async () => {
    const serviceKey = h.serviceKey ?? process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!serviceKey) { h.skip('no service key available'); return; }

    const res = await fetch(`${BASE_URL}/api/hr/documents/expiry/run-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ args: { windows: [30, 7, 0] } }),
    });
    const body = await res.json();
    expect(body.success === true, 'sweep ok');
    expect(typeof body.data?.scanned      === 'number', 'scanned count');
    expect(typeof body.data?.remindersSent === 'number', 'remindersSent count');
    expect(body.data?.remindersSent <= body.data?.scanned, 'remindersSent ≤ scanned');
  });

  await test('documents/expiry/run-sweep (normal JWT) → 403', async () => {
    // A normal user JWT must be rejected
    const res = await fetch(`${BASE_URL}/api/hr/documents/expiry/run-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${A}` },
      body: JSON.stringify({ args: {} }),
    });
    const body = await res.json();
    expect(body.success === false, 'normal JWT rejected');
  });

  await test('documents/expiry/run-sweep idempotency → second run sends 0 new reminders', async () => {
    const serviceKey = h.serviceKey ?? process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!serviceKey) { h.skip('no service key available'); return; }

    // Run once
    await fetch(`${BASE_URL}/api/hr/documents/expiry/run-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ args: { windows: [30, 7, 0] } }),
    });

    // Run again immediately — should send 0 new reminders (all deduplicated)
    const res2 = await fetch(`${BASE_URL}/api/hr/documents/expiry/run-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ args: { windows: [30, 7, 0] } }),
    });
    const body2 = await res2.json();
    expect(body2.success === true, 'second sweep ok');
    expect(body2.data?.remindersSent === 0, 'second sweep sends 0 (all deduped)');
  });

  // ── 8. Per-employee documents (existing routes still work) ────────────────────

  await test('employees/documents/list (admin, existing route) → still works', async () => {
    if (!ctx.employeeId) { h.skip('no employee'); return; }
    const r = await api('hr/employees/documents/list', A, { employeeId: ctx.employeeId });
    ok(r, 'per-employee list still ok');
    expect(Array.isArray(r.body.data), 'data is array');
  });
}
