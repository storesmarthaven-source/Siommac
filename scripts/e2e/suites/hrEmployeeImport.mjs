/**
 * scripts/e2e/suites/hrEmployeeImport.mjs
 *
 * E2E for the HR Employee Master bulk import (v36 §8, CSV-only), mounted at
 * /api/hr/employees/import/* (routes/hrEmployeeImport.ts):
 *   upload → map-fields → set-policy → validate → (resolve-row) → commit → report
 *
 * Covers: server-side CSV parse + staging, validation states (ready / blocked /
 * duplicate), commit-create via the SHARED provisionEmployee() (createLogins:false
 * path — no Auth account), access control against REAL roles (employee + manager
 * denied — import is full-HR-only), and §2 side-effects (batch/rows/errors,
 * app_events hr.import.committed + hr.employee.created, created app_users + statutory).
 *
 * REQUIRES (operator-applied): 20260708000000_hr_employee_import.sql + NOTIFY pgrst.
 */

export const title = 'HR Employee Import';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);
  const tag = TAG.toLowerCase();

  const ctx = { batchId: null, createdIds: [], mgrTok: null, empTok: null, dupNo: null };

  h.onCleanup(async () => {
    try { await sb.from('module_mutation_runs').delete().ilike('idempotency_key', `%${ctx.batchId ?? TAG}%`); } catch { /* optional */ }
    for (const id of ctx.createdIds) {
      await sb.from('app_events').delete().eq('source_entity_id', id);
      await sb.from('hr_audit_log').delete().eq('employee_id', id);
    }
    if (ctx.createdIds.length) await sb.from('app_users').delete().in('id', ctx.createdIds);   // cascades statutory/assignments
    if (ctx.batchId) {
      await sb.from('app_events').delete().eq('source_entity_id', ctx.batchId);
      await sb.from('hr_audit_log').delete().eq('record_id', ctx.batchId);
      await sb.from('hr_employee_import_batches').delete().eq('id', ctx.batchId);   // cascades rows + errors
    }
  });

  // Real-role identities (no fabrication) — both lack the import.* keys.
  {
    const { data: mgr } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'manager').eq('status', 'active').neq('id', admin.id).limit(1).maybeSingle();
    if (mgr) ctx.mgrTok = mint(mgr);
    const { data: emp } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'employee').eq('status', 'active').limit(1).maybeSingle();
    if (emp) ctx.empTok = mint(emp);
  }

  // A real department (for the rows to resolve) + an existing EMP-#### (for the dup row).
  const { data: dept } = await sb.from('departments').select('id, name').limit(1).maybeSingle();
  const deptName = dept?.name ?? '';
  const { data: anyEmp } = await sb.from('app_users').select('employee_number').like('employee_number', 'EMP-%').limit(1).maybeSingle();
  ctx.dupNo = anyEmp?.employee_number ?? '';

  const header = 'firstName,lastName,workerType,department,position,email,employeeNumber,nisNumber,nisStatus,birFileNumber,td1Received';
  const rowA = `${TAG}A,Alpha,employee,${deptName},Tester,e2e-${tag}-a@import.test,,NIS-A,registered,BIR-A,yes`;   // ready → created
  const rowB = `${TAG}B,Beta,employee,${deptName},,e2e-${tag}-b@import.test,,,,,`;                                  // missing position → blocked
  const rowC = `${TAG}C,Gamma,employee,${deptName},Tester,e2e-${tag}-c@import.test,${ctx.dupNo},NIS-C,registered,BIR-C,yes`; // dup empno → duplicate (if dupNo found)
  const csv = [header, rowA, rowB, rowC].join('\n');
  const csvB64 = Buffer.from(csv, 'utf8').toString('base64');

  const identityMapping = {
    firstName: 'firstName', lastName: 'lastName', workerType: 'workerType', department: 'department',
    position: 'position', email: 'email', employeeNumber: 'employeeNumber',
    nisNumber: 'nisNumber', nisStatus: 'nisStatus', birFileNumber: 'birFileNumber', td1Received: 'td1Received',
  };

  // ── upload ──────────────────────────────────────────────────────────────────
  await test('upload (admin) → parses CSV server-side + stages rows', async () => {
    const r = await api('hr/employees/import/upload', A, { fileName: `${TAG}.csv`, fileType: 'csv', fileBase64: csvB64, importMode: 'create' });
    ok(r, 'upload');
    expect(!!r.body.data.batchId, 'batchId returned');
    expect(/^HRI-/.test(r.body.data.batchNo), `batchNo format — got ${r.body.data.batchNo}`);
    expect(r.body.data.totalRows === 3, `3 rows staged — got ${r.body.data.totalRows}`);
    expect(Array.isArray(r.body.data.columns) && r.body.data.columns.includes('firstName'), 'columns detected');
    ctx.batchId = r.body.data.batchId;
    const { data: staged } = await sb.from('hr_employee_import_rows').select('id', { count: 'exact', head: true }).eq('batch_id', ctx.batchId);
    expect(staged !== undefined, 'rows table reachable');
  });

  await test('upload rejects XLSX (CSV-only for now)', async () => {
    const r = await api('hr/employees/import/upload', A, { fileName: 'x.xlsx', fileType: 'xlsx', fileBase64: csvB64 });
    fails(r, 'xlsx rejected by schema');
  });

  await test('upload unauthorized (employee) → denied', async () => {
    const r = await api('hr/employees/import/upload', ctx.empTok, { fileName: 'x.csv', fileType: 'csv', fileBase64: csvB64 });
    fails(r, 'employee cannot upload');
  });

  await test('upload unauthorized (manager — import is full-HR only) → denied', async () => {
    const r = await api('hr/employees/import/upload', ctx.mgrTok, { fileName: 'x.csv', fileType: 'csv', fileBase64: csvB64 });
    fails(r, 'manager cannot upload');
  });

  // ── map + policy ──────────────────────────────────────────────────────────────
  await test('map-fields (admin)', async () => {
    const r = await api('hr/employees/import/map-fields', A, { batchId: ctx.batchId, mapping: identityMapping });
    ok(r, 'map-fields');
  });

  await test('set-policy (admin) — record-only import policy', async () => {
    const r = await api('hr/employees/import/set-policy', A, { batchId: ctx.batchId, policy: { missingSupervisor: 'allow', duplicateEmployeeNumber: 'skip' } });
    ok(r, 'set-policy');
  });

  // ── validate ──────────────────────────────────────────────────────────────────
  await test('validate (admin) → ready / blocked / duplicate states', async () => {
    const r = await api('hr/employees/import/validate', A, { batchId: ctx.batchId });
    ok(r, 'validate');
    const s = r.body.data.summary;
    expect(s.ready >= 1, `>=1 ready — got ${s.ready}`);
    expect(s.blocked >= 1, `>=1 blocked (row missing position) — got ${s.blocked}`);
    if (ctx.dupNo) expect(s.duplicate >= 1, `>=1 duplicate (existing EMP no.) — got ${s.duplicate}`);
    // The blocked row recorded a required_missing error.
    const { data: errs } = await sb.from('hr_employee_import_row_errors').select('error_code').eq('batch_id', ctx.batchId).eq('error_code', 'required_missing');
    expect(errs && errs.length >= 1, 'required_missing error recorded');
  });

  await test('validate unauthorized (manager) → denied', async () => {
    const r = await api('hr/employees/import/validate', ctx.mgrTok, { batchId: ctx.batchId });
    fails(r, 'manager cannot validate');
  });

  // ── commit ──────────────────────────────────────────────────────────────────
  await test('commit (admin) → creates ready rows via provisionEmployee', async () => {
    const r = await api('hr/employees/import/commit', A, { batchId: ctx.batchId });
    ok(r, 'commit');
    expect(r.body.data.created >= 1, `>=1 created — got ${r.body.data.created}`);
    // Gather created employees for assertions + cleanup.
    const { data: createdRows } = await sb.from('hr_employee_import_rows').select('target_employee_id').eq('batch_id', ctx.batchId).eq('status', 'created');
    ctx.createdIds = (createdRows ?? []).map(x => x.target_employee_id).filter(Boolean);
    expect(ctx.createdIds.length >= 1, 'created rows carry target_employee_id');
  });

  await test('commit side-effects: app_user + statutory + events', async () => {
    const id = ctx.createdIds[0];
    const { data: usr } = await sb.from('app_users').select('id, employee_number, contractor_flag, auth_id').eq('id', id).maybeSingle();
    expect(usr && /^EMP-\d{4}$/.test(usr.employee_number ?? ''), 'created app_user has EMP number');
    // Import NEVER creates an Auth account — there is no code path left that can.
    expect(usr && !usr.auth_id, 'no Auth account is ever created by import');
    // Import NEVER grants elevated access: every imported row lands on `employee`.
    const { data: roleRow } = await sb.from('app_users').select('role').eq('id', id).maybeSingle();
    expect(roleRow && roleRow.role === 'employee', `imported role must be employee — got ${roleRow && roleRow.role}`);
    // Statutory is written to the CANONICAL profile table. The legacy table must not
    // receive new import writes (this assertion previously checked the legacy table and
    // therefore no longer proved the current create path).
    const { data: st } = await sb.from('hr_employee_statutory_profiles').select('payroll_ready_status').eq('employee_id', id).maybeSingle();
    expect(st && st.payroll_ready_status === 'ready', `canonical statutory ready — got ${st && st.payroll_ready_status}`);
    const { data: legacy } = await sb.from('hr_employee_statutory').select('employee_id').eq('employee_id', id).maybeSingle();
    expect(!legacy, 'no new write to the legacy hr_employee_statutory table');
    const { data: batchEv } = await sb.from('app_events').select('id').eq('event_type', 'hr.import.committed').eq('source_entity_id', ctx.batchId).limit(1);
    expect(batchEv && batchEv.length === 1, 'hr.import.committed event');
    const { data: empEv } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.created').eq('source_entity_id', id).limit(1);
    expect(empEv && empEv.length === 1, 'per-employee hr.employee.created event');
  });

  await test('commit unauthorized (employee) → denied', async () => {
    const r = await api('hr/employees/import/commit', ctx.empTok, { batchId: ctx.batchId });
    fails(r, 'employee cannot commit');
  });

  // ── report ──────────────────────────────────────────────────────────────────
  await test('report (admin) → committed batch + per-row results', async () => {
    const r = await api('hr/employees/import/report', A, { batchId: ctx.batchId });
    ok(r, 'report');
    expect(r.body.data.batch.status === 'committed', `committed — got ${r.body.data.batch.status}`);
    expect(r.body.data.batch.createdRows >= 1, 'createdRows tallied');
    expect(Array.isArray(r.body.data.rows) && r.body.data.rows.length === 3, '3 rows in report');
  });
}
