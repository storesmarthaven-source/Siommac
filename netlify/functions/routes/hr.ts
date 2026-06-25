// routes/hr.ts — HR people backbone (Phase 1: Employee Master + Organization)
//
// HR is built ON app_users (no fork). These routes add the HR layer over the
// existing identity: HR-field reads, audited employment changes (status /
// transfer / supervisor), positions, org tree, training summary (read-only from
// the Training module), and dashboard KPIs. POST-only; every route gated via
// requirePermission. Sensitive-change approval *workflow* routing is deferred to
// the central Workflow Engine phase — for now changes apply directly (by an
// actor who holds the change permission) and are fully audited + status-tracked.

import { Hono }       from 'hono';
import { sb }         from '../lib/db';
import { requirePermission, requireUser, userCan } from '../lib/auth';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import { emitAppEvent }      from '../lib/appEvents';
import { createAttachmentUploadUrl } from '../lib/upload';
import { getSignedUrl }      from '../lib/photos';
import { nextRef }    from '../lib/refGenerator';
import { z, zv }      from '../lib/validate';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const HR_DOC_BUCKET = 'hr-employee-documents';
const RESTRICTED_TIERS = new Set(['restricted_hr', 'legal', 'medical']);

const HR_COLS =
  'id, username, full_name, first_name, last_name, display_name, role, status, ' +
  'employment_type, department_id, site_id, position, supervisor_id, email, personal_email, ' +
  'phone, employee_number, start_date, end_date, contractor_flag, profile_image_url, profile_image';

// app_users.employment_type CHECK set (default 'employee'). Validated at the API
// boundary so a bad value is a clean 400, not a raw DB 500.
const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern', 'temporary', 'consultant', 'seconded'] as const;

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Fire-and-forget HR audit (async helper so the supabase builder actually executes). */
async function writeHrAudit(a: {
  employeeId?: string | null; submoduleKey: string; recordId?: string | null;
  actorId?: string | null; action: string; previousState?: unknown; newState?: unknown; reason?: string | null;
}): Promise<void> {
  try {
    await sb.from('hr_audit_log').insert({
      employee_id: a.employeeId ?? null, submodule_key: a.submoduleKey, record_id: a.recordId ?? null,
      actor_id: a.actorId ?? null, action: a.action,
      previous_state: a.previousState ?? null, new_state: a.newState ?? null, reason: a.reason ?? null,
    });
  } catch (e) { console.error('[hr] audit failed:', e); }
}

interface EmpRow { id: string; full_name: string | null; department_id: string | null; supervisor_id: string | null; status: string; [k: string]: unknown }

async function loadEmployee(id: string): Promise<EmpRow | null> {
  const { data } = await sb.from('app_users').select(HR_COLS).eq('id', id).maybeSingle<EmpRow>();
  return data ?? null;
}

/** Next EMP-#### reference (mirrors employees.ts so HR-created and core-created staff share one sequence). */
async function nextEmployeeNumber(): Promise<string> {
  const { data } = await sb.from('app_users')
    .select('employee_number').like('employee_number', 'EMP-%')
    .order('employee_number', { ascending: false }).limit(1);
  const top = (data ?? [])[0] as { employee_number?: string } | undefined;
  if (top?.employee_number) {
    const n = parseInt(String(top.employee_number).replace('EMP-', ''), 10);
    if (Number.isFinite(n)) return `EMP-${String(n + 1).padStart(4, '0')}`;
  }
  return 'EMP-0001';
}

// ── Statutory & payroll readiness (v36 §7.2) ────────────────────────────────────
// HR owns the readiness snapshot; Finance/Payroll owns deduction calc + remittance.
// Readiness is computed from the captured statutory fields — never hand-set.

interface StatutoryRow {
  nis_status: string; nis_number: string | null;
  paye_applicable: boolean; bir_file_number: string | null; td1_received: boolean;
  hs_applicable: boolean; hs_verification_required: boolean;
  [k: string]: unknown;
}

/** Derive payroll readiness from the statutory fields. Blocked until required fields are complete. */
function computePayrollReadiness(s: StatutoryRow): { status: 'ready' | 'blocked'; blockers: string[]; financeEligible: boolean } {
  const blockers: string[] = [];
  // NIS — must be registered (with a number) or explicitly exempt / not-applicable.
  if (s.nis_status === 'pending') blockers.push('NIS registration pending');
  if (s.nis_status === 'registered' && !s.nis_number) blockers.push('NIS number missing');
  // BIR / PAYE — when PAYE applies, the BIR file number + a received TD1 are required.
  if (s.paye_applicable) {
    if (!s.bir_file_number) blockers.push('BIR file number missing');
    if (!s.td1_received)    blockers.push('TD1 not received');
  }
  // Health surcharge — applicable + still-pending verification holds payroll.
  if (s.hs_applicable && s.hs_verification_required) blockers.push('Health surcharge verification pending');
  const status = blockers.length ? 'blocked' : 'ready';
  return { status, blockers, financeEligible: status === 'ready' };
}

const NIS_STATUSES = ['pending', 'registered', 'exempt', 'not_applicable'] as const;

/** camelCase statutory input → snake_case column patch (only provided keys). */
function statutoryPatch(s: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (s['nisNumber']              !== undefined) p['nis_number']               = s['nisNumber'];
  if (s['nisStatus']              !== undefined) p['nis_status']               = s['nisStatus'];
  if (s['nisEffectiveDate']       !== undefined) p['nis_effective_date']       = s['nisEffectiveDate'];
  if (s['birFileNumber']          !== undefined) p['bir_file_number']          = s['birFileNumber'];
  if (s['payeApplicable']         !== undefined) p['paye_applicable']          = s['payeApplicable'];
  if (s['td1Received']            !== undefined) p['td1_received']             = s['td1Received'];
  if (s['td1EffectiveYear']       !== undefined) p['td1_effective_year']       = s['td1EffectiveYear'];
  if (s['hsApplicable']           !== undefined) p['hs_applicable']            = s['hsApplicable'];
  if (s['hsExemptionReason']      !== undefined) p['hs_exemption_reason']      = s['hsExemptionReason'];
  if (s['hsEffectiveDate']        !== undefined) p['hs_effective_date']        = s['hsEffectiveDate'];
  if (s['hsVerificationRequired'] !== undefined) p['hs_verification_required'] = s['hsVerificationRequired'];
  return p;
}

/** Merge a patch over satutory defaults to a full row for readiness computation. */
function statutoryWithDefaults(p: Record<string, unknown>): StatutoryRow {
  return {
    nis_status:               (p['nis_status']               as string)        ?? 'pending',
    nis_number:               (p['nis_number']               as string | null) ?? null,
    paye_applicable:          (p['paye_applicable']          as boolean)       ?? true,
    bir_file_number:          (p['bir_file_number']          as string | null) ?? null,
    td1_received:             (p['td1_received']             as boolean)       ?? false,
    hs_applicable:            (p['hs_applicable']            as boolean)       ?? true,
    hs_verification_required: (p['hs_verification_required'] as boolean)       ?? false,
  };
}

const TRAINING_TERMINAL = new Set(['revoked', 'archived', 'rejected']);
/** Roll up an employee's certificates into a single training_status signal. */
function rollupTrainingStatus(certs: { status: string; expires_at: string | null }[], today: string): 'current' | 'due_soon' | 'expired' | 'none' {
  if (!certs.length) return 'none';
  const active = certs.filter(x => !TRAINING_TERMINAL.has(x.status));
  if (active.some(x => x.status === 'expired' || (!!x.expires_at && x.expires_at < today))) return 'expired';
  if (active.some(x => x.status === 'due_soon')) return 'due_soon';
  if (active.some(x => x.status === 'current')) return 'current';
  return 'none';
}

// ── Employee Master ────────────────────────────────────────────────────────────

// POST /api/hr/employees/list
router.post('/employees/list', async c => {
  await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({
    status: z.string().optional(), departmentId: z.string().optional(),
    employmentType: z.string().optional(), workerType: z.enum(['employee', 'contractor']).optional(),
    search: z.string().optional(), limit: z.number().int().positive().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  let q = sb.from('app_users').select(HR_COLS).neq('role', 'superadmin').order('full_name').limit(v.data.limit ?? 300);
  if (v.data.status)         q = q.eq('status', v.data.status);
  if (v.data.departmentId)   q = q.eq('department_id', v.data.departmentId);
  if (v.data.employmentType) q = q.eq('employment_type', v.data.employmentType);
  if (v.data.workerType)     q = q.eq('contractor_flag', v.data.workerType === 'contractor');
  const [{ data: rows, error }, { data: depts }] = await Promise.all([
    q,
    sb.from('departments').select('id, name'),
  ]);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const deptMap = Object.fromEntries(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
  let data = (rows ?? []) as unknown as EmpRow[];
  if (v.data.search) {
    const s = v.data.search.toLowerCase();
    data = data.filter(r => (r.full_name ?? '').toLowerCase().includes(s) || String(r['employee_number'] ?? '').toLowerCase().includes(s));
  }

  // Training status — one bulk certificate read over the page, rolled up per worker.
  const today = todayISO();
  const ids = data.map(r => r.id);
  const certByWorker = new Map<string, { status: string; expires_at: string | null }[]>();
  if (ids.length) {
    const { data: certs } = await sb.from('hse_worker_certificates')
      .select('worker_id, status, expires_at').in('worker_id', ids);
    for (const cr of (certs ?? []) as { worker_id: string; status: string; expires_at: string | null }[]) {
      const list = certByWorker.get(cr.worker_id) ?? [];
      list.push({ status: cr.status, expires_at: cr.expires_at });
      certByWorker.set(cr.worker_id, list);
    }
  }

  return c.json({ success: true, data: data.map(r => ({
    ...r,
    departmentName: deptMap[r.department_id ?? ''] ?? null,
    workerType: r['contractor_flag'] ? 'contractor' : 'employee',
    trainingStatus: rollupTrainingStatus(certByWorker.get(r.id) ?? [], today),
  })) });
});

// POST /api/hr/employees/get
router.post('/employees/get', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const [{ data: supervisor }, { data: dept }, { data: statusHistory }, { data: assignment }, { data: statutory }] = await Promise.all([
    emp.supervisor_id ? sb.from('app_users').select('id, full_name').eq('id', emp.supervisor_id).maybeSingle() : Promise.resolve({ data: null }),
    emp.department_id ? sb.from('departments').select('id, name').eq('id', emp.department_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('hr_employee_status_history').select('*').eq('employee_id', emp.id).order('changed_at', { ascending: false }).limit(20),
    sb.from('hr_employee_assignments').select('*').eq('employee_id', emp.id).eq('is_current', true).maybeSingle(),
    sb.from('hr_employee_statutory').select('*').eq('employee_id', emp.id).maybeSingle<StatutoryRow & Record<string, unknown>>(),
  ]);

  // Statutory is sensitive — full detail needs statutory.view; readiness-only needs payroll_readiness.view.
  const [canStatutory, canReadiness] = await Promise.all([
    userCan(actor, 'hr.employees.statutory.view'),
    userCan(actor, 'hr.employees.payroll_readiness.view'),
  ]);
  const payrollReadiness = statutory ? {
    status: statutory['payroll_ready_status'] ?? 'pending',
    blockers: statutory['missing_blockers'] ?? [],
    financeHandoffEligible: statutory['finance_handoff_eligible'] ?? false,
  } : { status: 'pending', blockers: [], financeHandoffEligible: false };

  return c.json({ success: true, data: {
    employee: { ...emp,
      supervisorName: (supervisor as { full_name?: string } | null)?.full_name ?? null,
      departmentName: (dept as { name?: string } | null)?.name ?? null,
      workerType: emp['contractor_flag'] ? 'contractor' : 'employee',
    },
    statusHistory: statusHistory ?? [],
    currentAssignment: assignment ?? null,
    statutory: canStatutory ? (statutory ?? null) : null,
    payrollReadiness: (canStatutory || canReadiness) ? payrollReadiness : null,
  } });
});

// POST /api/hr/employees/create — v36 Create Employee wizard (identity → statutory).
// Routed through the standard module-mutation adapter (record → event → idempotency),
// matching every other module's CREATE path. Credentials live in Supabase Auth —
// app_users holds no password. Onboarding-case creation is owned by the Onboarding
// phase (§10, tables not yet built): no onboarding inputs; onboarding_case_id is null.
router.post('/employees/create', async c => {
  const actor = await requirePermission(c, 'hr.employees.create');
  const v = zv(c, z.object({
    identity: z.object({
      username:       z.string().min(1).max(80),
      password:       z.string().min(6).max(200),
      fullName:       z.string().min(1).max(200),
      firstName:      z.string().max(120).optional(),
      lastName:       z.string().max(120).optional(),
      email:          z.string().max(160).optional(),
      personalEmail:  z.string().max(160).optional(),
      phone:          z.string().max(60).optional(),
      employeeNumber: z.string().max(40).optional(),
    }),
    employment: z.object({
      employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
      contractorFlag: z.boolean().optional(),
      startDate:      z.string().optional(),
      position:       z.string().max(160).optional(),
    }).optional(),
    assignment: z.object({
      departmentId: z.string().nullable().optional(),
      siteId:       z.string().nullable().optional(),
      positionId:   z.string().uuid().nullable().optional(),
      supervisorId: z.string().nullable().optional(),
    }).optional(),
    access:    z.object({ role: z.string().max(60).optional() }).optional(),
    statutory: z.record(z.string(), z.unknown()).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { identity, employment, assignment, access, statutory } = v.data;

  const employeeNo = identity.employeeNumber?.trim()
    ? identity.employeeNumber.trim().toUpperCase()
    : await nextEmployeeNumber();
  // Friendly pre-flight uniqueness (the DB unique constraints remain the backstop).
  const [{ data: dupUser }, { data: dupNum }] = await Promise.all([
    sb.from('app_users').select('id').eq('username', identity.username).maybeSingle(),
    sb.from('app_users').select('id').eq('employee_number', employeeNo).maybeSingle(),
  ]);
  if (dupUser) return c.json({ success: false, message: `Username "${identity.username}" is already taken.` }, 400 as 200);
  if (dupNum)  return c.json({ success: false, message: `Employee ID "${employeeNo}" is already in use.` }, 400 as 200);

  const authEmail = identity.email?.trim()
    ? identity.email.trim().toLowerCase()
    : `${identity.username.toLowerCase()}@siomac.internal`;
  const startDate = employment?.startDate ?? todayISO();
  const stPatch = statutory ? statutoryPatch(statutory) : {};
  const readiness = Object.keys(stPatch).length
    ? computePayrollReadiness(statutoryWithDefaults(stPatch))
    : { status: 'pending' as const, blockers: [] as string[], financeEligible: false };

  const result = await runModuleMutation<{ id: string; employeeNo: string; readiness: string }>({
    context: { actorUserId: actor.id, siteId: assignment?.siteId ?? null, departmentId: assignment?.departmentId ?? null },
    options: {
      module: 'hr', operation: 'create', entityType: 'employee',
      idempotencyKey: `hr.employee.create:${actor.id}:${identity.username}`,
      eventType: 'hr.employee.created', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.employeeNo }),
      buildEventPayload:  (r) => ({ employeeNumber: r.employeeNo, payrollReadiness: r.readiness }),
    },
    // The record write = app_users + Supabase Auth account + assignment + statutory +
    // status history + HR submodule audit. The adapter emits the hr.employee.created
    // app_event (so we don't emit it here) and tracks the run for idempotency.
    writeRecord: async () => {
      const insertRow: Record<string, unknown> = {
        username: identity.username, full_name: identity.fullName,
        role: access?.role ?? 'employee', status: 'active', auth_email: authEmail,
        email: identity.email?.trim() || null, personal_email: identity.personalEmail?.trim() || null,
        phone: identity.phone?.trim() || null, employee_number: employeeNo,
        // contractor_flag derives from employmentType unless explicitly set.
        contractor_flag: employment?.contractorFlag ?? (employment?.employmentType === 'contractor'),
        start_date: startDate, position: employment?.position ?? null, position_id: assignment?.positionId ?? null,
        department_id: assignment?.departmentId ?? null, site_id: assignment?.siteId ?? null,
        supervisor_id: assignment?.supervisorId ?? null,
      };
      // employment_type is NOT NULL with a DB default — only set it when provided.
      if (employment?.employmentType) insertRow['employment_type'] = employment.employmentType;
      if (identity.firstName) insertRow['first_name'] = identity.firstName;
      if (identity.lastName)  insertRow['last_name']  = identity.lastName;

      const { data: created, error: insErr } = await sb.from('app_users').insert(insertRow).select('id').single<{ id: string }>();
      if (insErr) {
        const dup = insErr.code === '23505';
        const msg = dup
          ? (insErr.message.includes('employee_number') ? `Employee ID "${employeeNo}" is already in use.` : `Username "${identity.username}" is already taken.`)
          : insErr.message;
        throw Object.assign(new Error(msg), { status: dup ? 400 : 500 });
      }
      const employeeId = created.id;

      // Supabase Auth account (so the new hire can log in) — roll back app_users on failure.
      const { data: authData, error: authErr } = await sb.auth.admin.createUser({
        email: authEmail, password: identity.password, email_confirm: true,
        user_metadata: { appUserId: employeeId, username: identity.username },
      });
      if (authErr) {
        await sb.from('app_users').delete().eq('id', employeeId);
        throw Object.assign(new Error('Failed to create auth account: ' + authErr.message), { status: 500 });
      }
      await sb.from('app_users').update({ auth_id: authData.user.id }).eq('id', employeeId);

      // Satellites — assignment, statutory snapshot, initial status history. Errors are
      // checked (not swallowed): if any fails we roll back the user + Auth account so we
      // never leave a half-provisioned employee (e.g. one with no statutory row).
      const { error: asgErr } = await sb.from('hr_employee_assignments').insert({
        employee_id: employeeId, position_id: assignment?.positionId ?? null,
        department_id: assignment?.departmentId ?? null, site_id: assignment?.siteId ?? null,
        supervisor_id: assignment?.supervisorId ?? null, assignment_type: 'primary',
        effective_from: startDate, is_current: true, created_by: actor.id,
      });
      const { error: stErr } = await sb.from('hr_employee_statutory').insert({
        employee_id: employeeId, ...stPatch,
        payroll_ready_status: readiness.status, missing_blockers: readiness.blockers,
        finance_handoff_eligible: readiness.financeEligible, updated_by: actor.id,
      });
      const { error: histErr } = await sb.from('hr_employee_status_history').insert({
        employee_id: employeeId, previous_status: null, new_status: 'active',
        reason: 'Employee created', effective_date: startDate, changed_by: actor.id,
      });
      const satErr = asgErr ?? stErr ?? histErr;
      if (satErr) {
        await sb.from('app_users').delete().eq('id', employeeId);   // cascades any satellites written
        try { await sb.auth.admin.deleteUser(authData.user.id); } catch { /* best-effort */ }
        throw Object.assign(new Error('Failed to write employee records: ' + satErr.message), { status: 500 });
      }

      await writeHrAudit({ employeeId, submoduleKey: 'employees', recordId: employeeId, actorId: actor.id,
        action: 'hr.employee.created', newState: { employee_number: employeeNo, role: access?.role ?? 'employee', payrollReadiness: readiness.status } });

      return { id: employeeId, employeeNo, readiness: readiness.status };
    },
  });

  return c.json({ success: true, data: {
    employee_id: result.entityId, employee_no: result.entityRef, status: 'active',
    payroll_readiness: result.record.readiness, onboarding_case_id: null, workflow_id: result.workflowId ?? null,
  } });
});

// POST /api/hr/employees/dashboard-stats — the 4 Employee-Master KPI cards (v36 §4.3).
// Every number is computed from live data (workforce / statutory / change-requests / certs).
router.post('/employees/dashboard-stats', async c => {
  await requirePermission(c, 'hr.employees.view');
  const v = zv(c, z.object({ siteId: z.string().optional(), departmentId: z.string().optional() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const today = todayISO();

  const [{ data: workforceRaw }, { data: statRows }, { data: changeRows }] = await Promise.all([
    sb.from('app_users').select('id, status, contractor_flag, supervisor_id, department_id, site_id, start_date, end_date').neq('role', 'superadmin'),
    sb.from('hr_employee_statutory').select('employee_id, payroll_ready_status'),
    sb.from('hr_employee_change_requests').select('change_type, status, requested_at').in('status', ['submitted', 'in_review', 'returned']),
  ]);
  let workforce = (workforceRaw ?? []) as { id: string; status: string; contractor_flag: boolean | null; supervisor_id: string | null; department_id: string | null; site_id: string | null; start_date: string | null; end_date: string | null }[];
  if (v.data.siteId)       workforce = workforce.filter(w => w.site_id === v.data.siteId);
  if (v.data.departmentId) workforce = workforce.filter(w => w.department_id === v.data.departmentId);
  const active = workforce.filter(w => w.status === 'active');
  const activeIds = active.map(w => w.id);

  // Active workforce + 6-month headcount trend (by hire / termination dates).
  const now = new Date();
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 0); // last day of that month
    const monthEnd = d.toISOString().slice(0, 10);
    const count = workforce.filter(w => (w.start_date ?? '') <= monthEnd && (!w.end_date || w.end_date > monthEnd)).length;
    return { period: MONTHS[d.getMonth()] ?? '', count };
  });

  // Statutory readiness (active workers only).
  const activeSet = new Set(activeIds);
  const activeStat = ((statRows ?? []) as { employee_id: string; payroll_ready_status: string }[]).filter(s => activeSet.has(s.employee_id));
  const payrollReady   = activeStat.filter(s => s.payroll_ready_status === 'ready').length;
  const payrollBlocked = activeStat.filter(s => s.payroll_ready_status === 'blocked').length;

  // Training rollup over active workers.
  const certByWorker = new Map<string, { status: string; expires_at: string | null }[]>();
  if (activeIds.length) {
    const { data: certs } = await sb.from('hse_worker_certificates').select('worker_id, status, expires_at').in('worker_id', activeIds);
    for (const cr of (certs ?? []) as { worker_id: string; status: string; expires_at: string | null }[]) {
      const list = certByWorker.get(cr.worker_id) ?? []; list.push({ status: cr.status, expires_at: cr.expires_at }); certByWorker.set(cr.worker_id, list);
    }
  }
  const trainingCurrent = activeIds.filter(id => rollupTrainingStatus(certByWorker.get(id) ?? [], today) === 'current').length;
  const trainingExpired = activeIds.filter(id => rollupTrainingStatus(certByWorker.get(id) ?? [], today) === 'expired').length;

  // HR work queue (open change-requests).
  const chg = (changeRows ?? []) as { change_type: string; status: string; requested_at: string | null }[];
  const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const mixMap = new Map<string, number>();
  for (const r of chg) mixMap.set(r.change_type, (mixMap.get(r.change_type) ?? 0) + 1);
  const urgent = chg.filter(r => r.status === 'in_review' || (r.requested_at ?? '') < threeDaysAgo).length;

  // Exceptions.
  const exceptionItems = [
    { type: 'Supervisor', count: active.filter(w => !w.supervisor_id).length },
    { type: 'Department', count: active.filter(w => !w.department_id).length },
    { type: 'Payroll',    count: payrollBlocked },
    { type: 'Training',   count: trainingExpired },
  ].filter(x => x.count > 0);

  return c.json({ success: true, data: { stats: {
    active_workforce: {
      total: active.length,
      employees: active.filter(w => !w.contractor_flag).length,
      contractors: active.filter(w => w.contractor_flag).length,
      trend,
    },
    hr_work_queue: { total: chg.length, urgent, mix: [...mixMap.entries()].map(([type, count]) => ({ type, count })) },
    readiness: {
      percent: active.length ? Math.round((payrollReady / active.length) * 100) : 0,
      payroll_ready: payrollReady, training_current: trainingCurrent, blocked: payrollBlocked,
    },
    exceptions: { total: exceptionItems.reduce((s, x) => s + x.count, 0), items: exceptionItems },
  } } });
});

// POST /api/hr/employees/workflow-summary — open engine workflows about this employee (v36 §5.2).
// Reads the central engine (workflow_instances) — the single source of truth for workflows.
router.post('/employees/workflow-summary', async c => {
  await requirePermission(c, 'hr.employees.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  const { data: instances } = await sb.from('workflow_instances')
    .select('id, workflow_no, workflow_type, status, current_step_key, priority')
    .eq('source_record_id', v.data.employeeId).in('status', ['in_progress', 'returned'])
    .order('created_at', { ascending: false });
  const rows = (instances ?? []) as { id: string; workflow_no: string | null; workflow_type: string; status: string; current_step_key: string | null; priority: string | null }[];

  // Current open task per workflow → step name + due date.
  const taskByWf = new Map<string, { step_name: string | null; due_at: string | null }>();
  if (rows.length) {
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('workflow_id, step_name, due_at, status').in('workflow_id', rows.map(r => r.id)).eq('status', 'pending')
      .order('due_at', { ascending: true });
    for (const t of (tasks ?? []) as { workflow_id: string; step_name: string | null; due_at: string | null }[]) {
      if (!taskByWf.has(t.workflow_id)) taskByWf.set(t.workflow_id, { step_name: t.step_name, due_at: t.due_at });
    }
  }

  const soon = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const items = rows.map(r => {
    const task = taskByWf.get(r.id);
    const dueAt = task?.due_at ?? null;
    const urgent = r.priority === 'high' || r.priority === 'critical' || (!!dueAt && dueAt < soon);
    return {
      workflow_id: r.id, workflow_no: r.workflow_no, workflow_type: r.workflow_type,
      current_step: task?.step_name ?? r.current_step_key, status: r.status, due_at: dueAt, urgent,
    };
  });
  return c.json({ success: true, data: {
    employee_id: v.data.employeeId, open_count: items.length,
    urgent_count: items.filter(i => i.urgent).length, items,
  } });
});

// POST /api/hr/employees/statutory/get — sensitive; gated by statutory.view.
router.post('/employees/statutory/get', async c => {
  await requirePermission(c, 'hr.employees.statutory.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data } = await sb.from('hr_employee_statutory').select('*').eq('employee_id', v.data.employeeId).maybeSingle<StatutoryRow & Record<string, unknown>>();
  const readiness = data ? computePayrollReadiness(data) : { status: 'pending' as const, blockers: [] as string[], financeEligible: false };
  return c.json({ success: true, data: { statutory: data ?? null, readiness } });
});

// POST /api/hr/employees/statutory/update — capture/verify statutory; recompute payroll readiness.
router.post('/employees/statutory/update', async c => {
  const actor = await requirePermission(c, 'hr.employees.statutory.update');
  const v = zv(c, z.object({
    employeeId:             z.string().min(1),
    nisNumber:              z.string().nullable().optional(),
    nisStatus:              z.enum(NIS_STATUSES).optional(),
    nisEffectiveDate:       z.string().nullable().optional(),
    birFileNumber:          z.string().nullable().optional(),
    payeApplicable:         z.boolean().optional(),
    td1Received:            z.boolean().optional(),
    td1EffectiveYear:       z.number().int().nullable().optional(),
    hsApplicable:           z.boolean().optional(),
    hsExemptionReason:      z.string().nullable().optional(),
    hsEffectiveDate:        z.string().nullable().optional(),
    hsVerificationRequired: z.boolean().optional(),
    markVerified:           z.boolean().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const { data: existing } = await sb.from('hr_employee_statutory').select('*').eq('employee_id', v.data.employeeId).maybeSingle<Record<string, unknown>>();
  const patch = statutoryPatch(v.data as Record<string, unknown>);
  const wasReady = existing?.['payroll_ready_status'] === 'ready';
  const readiness = computePayrollReadiness(statutoryWithDefaults({ ...(existing ?? {}), ...patch }));

  const upd: Record<string, unknown> = {
    ...patch,
    payroll_ready_status: readiness.status, missing_blockers: readiness.blockers,
    finance_handoff_eligible: readiness.financeEligible, updated_by: actor.id, updated_at: new Date().toISOString(),
  };
  if (v.data.markVerified) { upd['verified_by'] = actor.id; upd['verified_at'] = new Date().toISOString(); }

  if (existing) {
    const { error } = await sb.from('hr_employee_statutory').update(upd).eq('employee_id', v.data.employeeId);
    if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  } else {
    const { error } = await sb.from('hr_employee_statutory').insert({ employee_id: v.data.employeeId, ...upd });
    if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  }

  await writeHrAudit({ employeeId: v.data.employeeId, submoduleKey: 'employees', recordId: v.data.employeeId, actorId: actor.id,
    action: 'hr.employee.statutory_updated', previousState: existing ?? null, newState: upd });
  void emitAppEvent({ eventType: 'hr.employee.statutory_updated', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: v.data.employeeId, actorUserId: actor.id, severity: 'info', payload: { payrollReadiness: readiness.status } });
  // Crossing into payroll-ready emits the domain event the Finance/Payroll handoff will
  // key off. The actual handoff (handoff_outbox → payroll receiver) is build-order step
  // 14 — emitted here as an event, NOT faked as a handoff into the wrong receiver.
  if (!wasReady && readiness.status === 'ready') {
    void emitAppEvent({ eventType: 'hr.employee.payroll_ready', sourceModule: 'hr', sourceEntityType: 'employee',
      sourceEntityId: v.data.employeeId, actorUserId: actor.id, severity: 'info', payload: { financeHandoffEligible: true } });
  }
  return c.json({ success: true, data: {
    payroll_readiness: readiness.status, blockers: readiness.blockers, financeHandoffEligible: readiness.financeEligible,
  } });
});

// POST /api/hr/employees/contact/update — work / personal / emergency contact (v36 §6.3).
// Gating per tier (no grab-bag): work contact → hr.employees.update;
// personal/emergency (restricted) → hr.employees.restricted_contact.update. All audited.
// mode 'request' routes through maker-checker (hr_employee_change_requests, change_type contact_update).
router.post('/employees/contact/update', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    mode:       z.enum(['direct', 'request']).optional(),
    work:       z.object({ email: z.string().max(160).nullable().optional(), phone: z.string().max(60).nullable().optional() }).optional(),
    personal:   z.object({ personalEmail: z.string().max(160).nullable().optional() }).optional(),
    emergency:  z.object({
      name:         z.string().max(160).nullable().optional(),
      phone:        z.string().max(60).nullable().optional(),
      relationship: z.string().max(80).nullable().optional(),
    }).optional(),
    reason: z.string().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const patch: Record<string, unknown> = {};
  if (v.data.work?.email             !== undefined) patch['email']                          = v.data.work.email;
  if (v.data.work?.phone             !== undefined) patch['phone']                          = v.data.work.phone;
  if (v.data.personal?.personalEmail !== undefined) patch['personal_email']                = v.data.personal.personalEmail;
  if (v.data.emergency?.name         !== undefined) patch['emergency_contact_name']         = v.data.emergency.name;
  if (v.data.emergency?.phone        !== undefined) patch['emergency_contact_phone']        = v.data.emergency.phone;
  if (v.data.emergency?.relationship !== undefined) patch['emergency_contact_relationship'] = v.data.emergency.relationship;
  if (!Object.keys(patch).length) return c.json({ success: false, message: 'No contact fields provided.' }, 400 as 200);

  const touchesRestricted = !!(v.data.personal || v.data.emergency);

  // Change-request mode → maker-checker; the checker holds the change-type permission.
  if (v.data.mode === 'request') {
    const cr = await createChangeRequest(actor, {
      employeeId: v.data.employeeId, changeType: 'contact_update',
      previousValue: snapshotForChange('contact_update', emp), requestedValue: patch, reason: v.data.reason ?? null,
    });
    return c.json({ success: true, data: { mode: 'request', requestId: cr.id, changeNo: cr.changeNo } });
  }

  // Direct mode → permission per tier, then apply (audited).
  const requiredPerm = touchesRestricted ? 'hr.employees.restricted_contact.update' : 'hr.employees.update';
  if (!(await userCan(actor, requiredPerm))) {
    return c.json({ success: false, message: touchesRestricted
      ? 'Updating personal or emergency contact requires the restricted-contact permission.'
      : 'You do not have permission to update contact details.' }, 403 as 200);
  }

  patch['updated_at'] = new Date().toISOString();
  const { error } = await sb.from('app_users').update(patch).eq('id', v.data.employeeId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ employeeId: v.data.employeeId, submoduleKey: 'employees', recordId: v.data.employeeId, actorId: actor.id,
    action: 'hr.employee.contact_updated', previousState: snapshotForChange('contact_update', emp), newState: patch, reason: v.data.reason ?? null });
  void emitAppEvent({ eventType: 'hr.employee.contact_updated', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: v.data.employeeId, actorUserId: actor.id, severity: 'info', payload: { fields: Object.keys(patch).filter(k => k !== 'updated_at'), restricted: touchesRestricted } });
  return c.json({ success: true, data: { mode: 'direct', employee: await loadEmployee(v.data.employeeId) } });
});

// POST /api/hr/employees/update — edit HR fields (non-sensitive); name split kept in sync by trigger
router.post('/employees/update', async c => {
  const actor = await requirePermission(c, 'employees.edit');
  const v = zv(c, z.object({
    employeeId:     z.string().min(1),
    firstName:      z.string().max(120).optional(),
    lastName:       z.string().max(120).nullable().optional(),
    displayName:    z.string().max(160).nullable().optional(),
    personalEmail:  z.string().max(160).nullable().optional(),
    phone:          z.string().max(60).nullable().optional(),
    position:       z.string().max(160).nullable().optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    startDate:      z.string().nullable().optional(),
    endDate:        z.string().nullable().optional(),
    contractorFlag: z.boolean().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  const prev = await loadEmployee(v.data.employeeId);
  if (!prev) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.firstName      !== undefined) patch['first_name']      = v.data.firstName;
  if (v.data.lastName       !== undefined) patch['last_name']       = v.data.lastName;
  if (v.data.displayName    !== undefined) patch['display_name']    = v.data.displayName;
  if (v.data.personalEmail  !== undefined) patch['personal_email']  = v.data.personalEmail;
  if (v.data.phone          !== undefined) patch['phone']           = v.data.phone;
  if (v.data.position       !== undefined) patch['position']        = v.data.position;
  if (v.data.employmentType !== undefined) patch['employment_type'] = v.data.employmentType;
  if (v.data.startDate      !== undefined) patch['start_date']      = v.data.startDate;
  if (v.data.endDate        !== undefined) patch['end_date']        = v.data.endDate;
  if (v.data.contractorFlag !== undefined) patch['contractor_flag'] = v.data.contractorFlag;

  const { error } = await sb.from('app_users').update(patch).eq('id', v.data.employeeId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  await writeHrAudit({ employeeId: v.data.employeeId, submoduleKey: 'employees', recordId: v.data.employeeId,
    actorId: actor.id, action: 'hr.employee.updated', previousState: prev, newState: patch });
  void emitAppEvent({ eventType: 'hr.employee.updated', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: v.data.employeeId, actorUserId: actor.id, severity: 'info', payload: { fields: Object.keys(patch) } });

  return c.json({ success: true, data: await loadEmployee(v.data.employeeId) });
});

// POST /api/hr/employees/status-change — HR lifecycle status (history + auth sync)
const HR_STATUSES = ['draft','pending_onboarding','active','probation','on_leave','suspended','inactive','terminated','archived'] as const;
const BLOCKING_STATUSES = new Set(['suspended','inactive','terminated','archived']);

router.post('/employees/status-change', async c => {
  const actor = await requirePermission(c, 'hr.employees.status_change');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    newStatus:  z.enum(HR_STATUSES),
    reason:     z.string().max(500).optional(),
    effectiveDate: z.string().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);
  const prevHr = await sb.from('hr_employee_status_history').select('new_status').eq('employee_id', emp.id)
    .order('changed_at', { ascending: false }).limit(1).maybeSingle<{ new_status: string }>();
  const previousStatus = prevHr.data?.new_status ?? emp.status;

  await sb.from('hr_employee_status_history').insert({
    employee_id: emp.id, previous_status: previousStatus, new_status: v.data.newStatus,
    reason: v.data.reason ?? null, effective_date: v.data.effectiveDate ?? todayISO(), changed_by: actor.id,
  });

  // Sync the coarse auth status so blocking states stop login (hr.termination_blocks_login).
  const authStatus = BLOCKING_STATUSES.has(v.data.newStatus) ? 'inactive' : 'active';
  await sb.from('app_users').update({ status: authStatus, updated_at: new Date().toISOString() }).eq('id', emp.id);

  await writeHrAudit({ employeeId: emp.id, submoduleKey: 'employees', recordId: emp.id, actorId: actor.id,
    action: 'hr.employee.status_changed', previousState: { status: previousStatus }, newState: { status: v.data.newStatus, authStatus }, reason: v.data.reason ?? null });
  void emitAppEvent({ eventType: 'hr.employee.status_changed', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: emp.id, actorUserId: actor.id, severity: BLOCKING_STATUSES.has(v.data.newStatus) ? 'warning' : 'info',
    payload: { from: previousStatus, to: v.data.newStatus } });

  return c.json({ success: true, data: { employeeId: emp.id, status: v.data.newStatus } });
});

// POST /api/hr/employees/transfer — department / site move (closes current assignment, opens new)
router.post('/employees/transfer', async c => {
  const actor = await requirePermission(c, 'hr.employees.transfer');
  const v = zv(c, z.object({
    employeeId:   z.string().min(1),
    departmentId: z.string().nullable().optional(),
    siteId:       z.string().nullable().optional(),
    positionId:   z.string().uuid().nullable().optional(),
    reason:       z.string().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.departmentId !== undefined) patch['department_id'] = v.data.departmentId;
  if (v.data.siteId       !== undefined) patch['site_id']       = v.data.siteId;
  const { error } = await sb.from('app_users').update(patch).eq('id', emp.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  // Close current assignment, open a new one.
  await sb.from('hr_employee_assignments').update({ is_current: false, effective_to: todayISO() })
    .eq('employee_id', emp.id).eq('is_current', true);
  await sb.from('hr_employee_assignments').insert({
    employee_id: emp.id, position_id: v.data.positionId ?? null,
    department_id: v.data.departmentId ?? emp.department_id, site_id: v.data.siteId ?? (emp['site_id'] as string | null),
    supervisor_id: emp.supervisor_id, assignment_type: 'primary', effective_from: todayISO(), is_current: true, created_by: actor.id,
  });

  await writeHrAudit({ employeeId: emp.id, submoduleKey: 'employees', recordId: emp.id, actorId: actor.id,
    action: 'hr.employee.department_transferred', previousState: { department_id: emp.department_id, site_id: emp['site_id'] }, newState: patch, reason: v.data.reason ?? null });
  void emitAppEvent({ eventType: 'hr.employee.department_transferred', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: emp.id, actorUserId: actor.id, severity: 'info', payload: patch });

  return c.json({ success: true, data: await loadEmployee(emp.id) });
});

// POST /api/hr/employees/supervisor-change
router.post('/employees/supervisor-change', async c => {
  const actor = await requirePermission(c, 'hr.employees.supervisor_change');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), supervisorId: z.string().nullable(), reason: z.string().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);
  if (v.data.supervisorId === emp.id) return c.json({ success: false, message: 'An employee cannot be their own supervisor.' }, 400 as 200);

  const { error } = await sb.from('app_users').update({ supervisor_id: v.data.supervisorId, updated_at: new Date().toISOString() }).eq('id', emp.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  await writeHrAudit({ employeeId: emp.id, submoduleKey: 'employees', recordId: emp.id, actorId: actor.id,
    action: 'hr.employee.supervisor_changed', previousState: { supervisor_id: emp.supervisor_id }, newState: { supervisor_id: v.data.supervisorId }, reason: v.data.reason ?? null });
  void emitAppEvent({ eventType: 'hr.employee.supervisor_changed', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: emp.id, actorUserId: actor.id, severity: 'info', payload: { supervisor_id: v.data.supervisorId } });
  return c.json({ success: true, data: await loadEmployee(emp.id) });
});

// POST /api/hr/employees/training-summary — READ-ONLY from the Training module (no dup)
router.post('/employees/training-summary', async c => {
  await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const today = todayISO();
  const { data: certs } = await sb.from('hse_worker_certificates')
    .select('status, expires_at, course_name').eq('worker_id', v.data.employeeId);
  const list = (certs ?? []) as { status: string; expires_at: string | null; course_name: string }[];
  const isExpired = (x: { status: string; expires_at: string | null }) =>
    x.status === 'expired' || (!!x.expires_at && x.expires_at < today && !['revoked','archived','rejected'].includes(x.status));
  return c.json({ success: true, data: {
    total:   list.length,
    current: list.filter(x => x.status === 'current').length,
    dueSoon: list.filter(x => x.status === 'due_soon').length,
    expired: list.filter(isExpired).length,
    pending: list.filter(x => x.status === 'pending_verification').length,
    certificates: list,
  } });
});

// POST /api/hr/employees/audit
router.post('/employees/audit', async c => {
  await requirePermission(c, 'hr.audit.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1), limit: z.number().int().positive().max(200).optional() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data } = await sb.from('hr_audit_log').select('*').eq('employee_id', v.data.employeeId)
    .order('created_at', { ascending: false }).limit(v.data.limit ?? 100);
  return c.json({ success: true, data: data ?? [] });
});

// ── Organization Structure ─────────────────────────────────────────────────────

// POST /api/hr/organization/tree — flat list of org units (frontend builds the tree)
router.post('/organization/tree', async c => {
  await requirePermission(c, 'hr.organization.view');
  const { data, error } = await sb.from('departments')
    .select('id, name, description, parent_id, org_unit_type, site_id, manager_id, is_active').order('name');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── Positions ──────────────────────────────────────────────────────────────────

router.post('/positions/list', async c => {
  await requirePermission(c, 'hr.positions.view');
  const { data } = await sb.from('hr_positions').select('*').order('title');
  return c.json({ success: true, data: data ?? [] });
});

router.post('/positions/create', async c => {
  const actor = await requirePermission(c, 'hr.positions.manage');
  const v = zv(c, z.object({
    positionKey: z.string().min(1).max(80), title: z.string().min(1).max(160),
    departmentId: z.string().nullable().optional(), siteId: z.string().nullable().optional(),
    defaultSupervisorId: z.string().nullable().optional(), isSafetyCritical: z.boolean().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hr_positions').insert({
    position_key: v.data.positionKey, title: v.data.title, department_id: v.data.departmentId ?? null,
    site_id: v.data.siteId ?? null, default_supervisor_id: v.data.defaultSupervisorId ?? null,
    is_safety_critical: v.data.isSafetyCritical ?? false, created_by: actor.id,
  }).select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ submoduleKey: 'organization', recordId: data.id, actorId: actor.id, action: 'hr.position.created', newState: v.data });
  return c.json({ success: true, data });
});

router.post('/positions/update', async c => {
  const actor = await requirePermission(c, 'hr.positions.manage');
  const v = zv(c, z.object({
    positionId: z.string().uuid(), title: z.string().max(160).optional(),
    departmentId: z.string().nullable().optional(), siteId: z.string().nullable().optional(),
    defaultSupervisorId: z.string().nullable().optional(), isSafetyCritical: z.boolean().optional(), isActive: z.boolean().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.title               !== undefined) patch['title']                 = v.data.title;
  if (v.data.departmentId        !== undefined) patch['department_id']         = v.data.departmentId;
  if (v.data.siteId              !== undefined) patch['site_id']               = v.data.siteId;
  if (v.data.defaultSupervisorId !== undefined) patch['default_supervisor_id'] = v.data.defaultSupervisorId;
  if (v.data.isSafetyCritical    !== undefined) patch['is_safety_critical']    = v.data.isSafetyCritical;
  if (v.data.isActive            !== undefined) patch['is_active']             = v.data.isActive;
  const { error } = await sb.from('hr_positions').update(patch).eq('id', v.data.positionId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ submoduleKey: 'organization', recordId: v.data.positionId, actorId: actor.id, action: 'hr.position.updated', newState: patch });
  return c.json({ success: true });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

router.post('/dashboard/kpis', async c => {
  await requirePermission(c, 'hr.dashboard.view');
  const monthStart = new Date(); monthStart.setDate(1);
  const monthStartISO = monthStart.toISOString().slice(0, 10);
  const [active, contractors, inactive, newHires, pendingChanges, total] = await Promise.all([
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('status', 'active').neq('role', 'superadmin'),
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('contractor_flag', true),
    sb.from('app_users').select('id', { count: 'exact', head: true }).neq('status', 'active').neq('role', 'superadmin'),
    sb.from('app_users').select('id', { count: 'exact', head: true }).gte('start_date', monthStartISO),
    sb.from('hr_employee_change_requests').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'in_review']),
    sb.from('app_users').select('id', { count: 'exact', head: true }).neq('role', 'superadmin'),
  ]);
  return c.json({ success: true, data: {
    activeEmployees:       active.count ?? 0,
    contractors:           contractors.count ?? 0,
    inactive:              inactive.count ?? 0,
    newHiresThisMonth:     newHires.count ?? 0,
    pendingChangeRequests: pendingChanges.count ?? 0,
    totalTracked:          total.count ?? 0,
  } });
});

// ── Change requests (maker-checker; decoupled from the workflow engine) ─────────
// Create = hr.view (managers may request changes for their reports). Decide
// (approve→apply / reject / return) requires the change-type permission below.
// When the central Workflow Engine lands, these re-point to it via workflow_id.

const CHANGE_TYPES = ['status_change','department_transfer','site_transfer','supervisor_change','role_change','employment_type_change','contact_update'] as const;
type ChangeType = typeof CHANGE_TYPES[number];
const CHANGE_PERM: Record<ChangeType, string> = {
  status_change:          'hr.employees.status_change',
  department_transfer:    'hr.employees.transfer',
  site_transfer:          'hr.employees.transfer',
  supervisor_change:      'hr.employees.supervisor_change',
  role_change:            'hr.employees.role_change',
  employment_type_change: 'hr.employees.role_change',
  contact_update:         'hr.employees.restricted_contact.update',
};
// Contact columns a contact_update change request may touch (whitelist for apply).
const CONTACT_COLS = ['email','phone','personal_email','emergency_contact_name','emergency_contact_phone','emergency_contact_relationship'] as const;
function snapshotForChange(t: ChangeType, emp: EmpRow): Record<string, unknown> {
  switch (t) {
    case 'status_change':          return { status: emp.status };
    case 'department_transfer':    return { department_id: emp.department_id };
    case 'site_transfer':          return { site_id: emp['site_id'] };
    case 'supervisor_change':      return { supervisor_id: emp.supervisor_id };
    case 'role_change':            return { role: emp['role'] };
    case 'employment_type_change': return { employment_type: emp['employment_type'] };
    case 'contact_update':         return Object.fromEntries(CONTACT_COLS.map(k => [k, emp[k] ?? null]));
  }
}
const HR_BLOCKING = new Set(['suspended','inactive','terminated','archived']);

/** Apply an approved change to app_users (+ history/assignment). */
async function applyChange(req: { employee_id: string; change_type: ChangeType; requested_value: Record<string, unknown>; previous_value: Record<string, unknown> | null }, actorId: string): Promise<void> {
  const rv = req.requested_value ?? {};
  const eid = req.employee_id;
  const stamp = { updated_at: new Date().toISOString() };
  switch (req.change_type) {
    case 'status_change': {
      const newStatus = String(rv['newStatus'] ?? rv['status'] ?? '');
      await sb.from('hr_employee_status_history').insert({
        employee_id: eid, previous_status: (req.previous_value?.['status'] as string) ?? null, new_status: newStatus,
        reason: 'Approved change request', effective_date: todayISO(), changed_by: actorId,
      });
      await sb.from('app_users').update({ status: HR_BLOCKING.has(newStatus) ? 'inactive' : 'active', ...stamp }).eq('id', eid);
      break;
    }
    case 'department_transfer':
    case 'site_transfer': {
      const patch: Record<string, unknown> = { ...stamp };
      if ('departmentId' in rv) patch['department_id'] = rv['departmentId'];
      if ('siteId' in rv)       patch['site_id']       = rv['siteId'];
      await sb.from('app_users').update(patch).eq('id', eid);
      await sb.from('hr_employee_assignments').update({ is_current: false, effective_to: todayISO() }).eq('employee_id', eid).eq('is_current', true);
      await sb.from('hr_employee_assignments').insert({
        employee_id: eid, department_id: (rv['departmentId'] as string) ?? null, site_id: (rv['siteId'] as string) ?? null,
        assignment_type: 'primary', effective_from: todayISO(), is_current: true, created_by: actorId,
      });
      break;
    }
    case 'supervisor_change':
      await sb.from('app_users').update({ supervisor_id: (rv['supervisorId'] as string) ?? null, ...stamp }).eq('id', eid);
      break;
    case 'role_change':
      await sb.from('app_users').update({ role: rv['role'], ...stamp }).eq('id', eid);
      break;
    case 'employment_type_change':
      await sb.from('app_users').update({ employment_type: rv['employmentType'], ...stamp }).eq('id', eid);
      break;
    case 'contact_update': {
      // requested_value already holds snake_case contact columns; apply only the whitelist.
      const patch: Record<string, unknown> = { ...stamp };
      for (const k of CONTACT_COLS) if (k in rv) patch[k] = rv[k];
      await sb.from('app_users').update(patch).eq('id', eid);
      break;
    }
  }
}

/**
 * Create a maker-checker change request via the standard module-create path
 * (record → event → idempotency). Shared by /employees/change-request and the
 * /employees/contact/update request mode so both emit one consistent event +
 * hr_audit_log entry. Returns the new request id + change_no.
 */
async function createChangeRequest(actor: { id: string }, p: {
  employeeId: string; changeType: ChangeType;
  previousValue: Record<string, unknown>; requestedValue: Record<string, unknown>; reason?: string | null;
}): Promise<{ id: string; changeNo: string }> {
  const result = await runModuleMutation<{ id: string; changeNo: string }>({
    context: { actorUserId: actor.id },
    options: {
      module: 'hr', operation: 'create', entityType: 'employee_change',
      // Content-derived so an accidental double-submit of the SAME change dedupes,
      // while distinct changes for the same employee remain separate requests.
      idempotencyKey: `hr.change_request:${actor.id}:${p.employeeId}:${p.changeType}:${JSON.stringify(p.requestedValue)}`,
      eventType: 'hr.employee.change_requested', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.changeNo }),
      buildEventPayload: () => ({ employeeId: p.employeeId, changeType: p.changeType }),
    },
    writeRecord: async () => {
      // Reference is consumed only on a real write — deduped retries don't burn a ref.
      const changeNo = await nextRef('HRC');
      const { data, error } = await sb.from('hr_employee_change_requests').insert({
        change_no: changeNo, employee_id: p.employeeId, change_type: p.changeType, requested_by: actor.id,
        previous_value: p.previousValue, requested_value: p.requestedValue,
        status: 'submitted', metadata: { reason: p.reason ?? null },
      }).select('id, change_no').single<{ id: string; change_no: string }>();
      if (error) throw Object.assign(new Error(error.message), { status: 500 });
      await writeHrAudit({ employeeId: p.employeeId, submoduleKey: 'employees', recordId: data.id, actorId: actor.id,
        action: 'hr.employee.change_requested', newState: { changeType: p.changeType, requestedValue: p.requestedValue }, reason: p.reason ?? null });
      return { id: data.id, changeNo: data.change_no };
    },
  });
  return { id: result.entityId, changeNo: result.record.changeNo };
}

// POST /api/hr/employees/change-request — create (maker)
router.post('/employees/change-request', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), changeType: z.enum(CHANGE_TYPES),
    requestedValue: z.record(z.string(), z.unknown()), reason: z.string().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const cr = await createChangeRequest(actor, {
    employeeId: v.data.employeeId, changeType: v.data.changeType,
    previousValue: snapshotForChange(v.data.changeType, emp), requestedValue: v.data.requestedValue, reason: v.data.reason ?? null,
  });
  return c.json({ success: true, data: { id: cr.id, change_no: cr.changeNo } });
});

// POST /api/hr/employee-change-requests/list
router.post('/employee-change-requests/list', async c => {
  await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ status: z.string().optional(), employeeId: z.string().optional() }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  let q = sb.from('hr_employee_change_requests').select('*').order('requested_at', { ascending: false }).limit(200);
  if (v.data.status)     q = q.eq('status', v.data.status);
  if (v.data.employeeId) q = q.eq('employee_id', v.data.employeeId);
  const { data } = await q;
  return c.json({ success: true, data: data ?? [] });
});

// POST /api/hr/employee-change-requests/decide — approve (apply) / reject / return (checker)
router.post('/employee-change-requests/decide', async c => {
  const actor = await requireUser(c);
  const v = zv(c, z.object({ requestId: z.string().uuid(), decision: z.enum(['approve','reject','return']), comment: z.string().max(500).optional() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data: req } = await sb.from('hr_employee_change_requests').select('*').eq('id', v.data.requestId)
    .maybeSingle<{ id: string; employee_id: string; change_type: ChangeType; requested_value: Record<string, unknown>; previous_value: Record<string, unknown> | null; status: string }>();
  if (!req) return c.json({ success: false, message: 'Change request not found.' }, 404 as 200);
  if (!['submitted', 'in_review', 'returned'].includes(req.status))
    return c.json({ success: false, message: `Change request already ${req.status}.` }, 400 as 200);
  // Checker must hold the change-type permission.
  if (!(await userCan(actor, CHANGE_PERM[req.change_type])))
    return c.json({ success: false, message: 'Forbidden' }, 403 as 200);

  if (v.data.decision === 'reject' || v.data.decision === 'return') {
    const status = v.data.decision === 'reject' ? 'rejected' : 'returned';
    await sb.from('hr_employee_change_requests').update({ status, decided_at: new Date().toISOString(), metadata: { decisionComment: v.data.comment ?? null } }).eq('id', req.id);
    await writeHrAudit({ employeeId: req.employee_id, submoduleKey: 'employees', recordId: req.id, actorId: actor.id, action: `hr.employee.change_${status}`, reason: v.data.comment ?? null });
    return c.json({ success: true, data: { requestId: req.id, status } });
  }

  // approve → apply
  await applyChange(req, actor.id);
  await sb.from('hr_employee_change_requests').update({ status: 'applied', decided_at: new Date().toISOString(), applied_at: new Date().toISOString() }).eq('id', req.id);
  await writeHrAudit({ employeeId: req.employee_id, submoduleKey: 'employees', recordId: req.id, actorId: actor.id,
    action: 'hr.employee.change_applied', previousState: req.previous_value, newState: req.requested_value });
  void emitAppEvent({ eventType: 'hr.employee.change_applied', sourceModule: 'hr', sourceEntityType: 'employee_change',
    sourceEntityId: req.id, actorUserId: actor.id, severity: 'info', payload: { employeeId: req.employee_id, changeType: req.change_type } });
  return c.json({ success: true, data: { requestId: req.id, status: 'applied' } });
});

// POST /api/hr/employee-change-requests/cancel — by the requester
router.post('/employee-change-requests/cancel', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ requestId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data: req } = await sb.from('hr_employee_change_requests').select('requested_by, status, employee_id').eq('id', v.data.requestId)
    .maybeSingle<{ requested_by: string; status: string; employee_id: string }>();
  if (!req) return c.json({ success: false, message: 'Change request not found.' }, 404 as 200);
  if (req.requested_by !== actor.id && !(await userCan(actor, 'hr.employees.status_change')))
    return c.json({ success: false, message: 'Only the requester or an HR approver can cancel.' }, 403 as 200);
  if (['applied', 'rejected', 'cancelled'].includes(req.status))
    return c.json({ success: false, message: `Cannot cancel a ${req.status} request.` }, 400 as 200);
  await sb.from('hr_employee_change_requests').update({ status: 'cancelled', decided_at: new Date().toISOString() }).eq('id', v.data.requestId);
  await writeHrAudit({ employeeId: req.employee_id, submoduleKey: 'employees', recordId: v.data.requestId, actorId: actor.id, action: 'hr.employee.change_cancelled' });
  return c.json({ success: true });
});

// ── Employee Documents (private bucket; verify/reject/archive; audited download) ─

// POST /api/hr/employees/documents/list
router.post('/employees/documents/list', async c => {
  const user = await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data } = await sb.from('hr_employee_documents').select('*').eq('employee_id', v.data.employeeId)
    .neq('status', 'archived').order('uploaded_at', { ascending: false });
  let rows = (data ?? []) as { confidentiality: string }[];
  // Restricted tiers require the sensitive-view permission.
  if (!(await userCan(user, 'hr.employee_documents.sensitive_view'))) {
    rows = rows.filter(d => !RESTRICTED_TIERS.has(d.confidentiality));
  }
  return c.json({ success: true, data: rows });
});

// POST /api/hr/employees/documents/upload-url
router.post('/employees/documents/upload-url', async c => {
  await requirePermission(c, 'hr.employee_documents.upload');
  const v = zv(c, z.object({ fileName: z.string().min(1), mimeType: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  try {
    const { uploadUrl, token, path } = await createAttachmentUploadUrl(HR_DOC_BUCKET, v.data.fileName, v.data.mimeType);
    return c.json({ success: true, uploadUrl, token, path, bucket: HR_DOC_BUCKET });
  } catch (err) { return c.json({ success: false, message: err instanceof Error ? err.message : 'Upload URL failed' }, 400 as 200); }
});

// POST /api/hr/employees/documents/commit
router.post('/employees/documents/commit', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.upload');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), documentType: z.string().min(1).max(80), title: z.string().min(1).max(200),
    filePath: z.string().min(1), fileName: z.string().min(1), mimeType: z.string().nullable().optional(),
    fileSize: z.number().int().nullable().optional(),
    confidentiality: z.enum(['internal', 'confidential', 'restricted_hr', 'legal', 'medical']).default('internal'),
    expiryDate: z.string().nullable().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hr_employee_documents').insert({
    employee_id: v.data.employeeId, document_type: v.data.documentType, title: v.data.title,
    file_path: v.data.filePath, file_name: v.data.fileName, mime_type: v.data.mimeType ?? null,
    file_size: v.data.fileSize ?? null, confidentiality: v.data.confidentiality, expiry_date: v.data.expiryDate ?? null,
    uploaded_by: actor.id,
  }).select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ employeeId: v.data.employeeId, submoduleKey: 'documents', recordId: data.id, actorId: actor.id,
    action: 'hr.employee.document_uploaded', newState: { documentType: v.data.documentType, confidentiality: v.data.confidentiality } });
  void emitAppEvent({ eventType: 'hr.employee.document_uploaded', sourceModule: 'hr', sourceEntityType: 'hr_document',
    sourceEntityId: data.id, actorUserId: actor.id, severity: 'info', payload: { employeeId: v.data.employeeId } });
  return c.json({ success: true, data });
});

// POST /api/hr/documents/verify  (decision: approve | reject)
router.post('/documents/verify', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.verify');
  const v = zv(c, z.object({ documentId: z.string().uuid(), decision: z.enum(['approve', 'reject']), reason: z.string().max(500).optional() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data: doc } = await sb.from('hr_employee_documents').select('employee_id, status').eq('id', v.data.documentId).maybeSingle<{ employee_id: string; status: string }>();
  if (!doc) return c.json({ success: false, message: 'Document not found.' }, 404 as 200);
  const newStatus = v.data.decision === 'approve' ? 'verified' : 'rejected';
  const { error } = await sb.from('hr_employee_documents').update({
    status: newStatus, verified_by: actor.id, verified_at: new Date().toISOString(),
    rejected_reason: v.data.decision === 'reject' ? (v.data.reason ?? null) : null,
  }).eq('id', v.data.documentId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ employeeId: doc.employee_id, submoduleKey: 'documents', recordId: v.data.documentId, actorId: actor.id,
    action: v.data.decision === 'approve' ? 'hr.employee.document_verified' : 'hr.employee.document_rejected', reason: v.data.reason ?? null });
  return c.json({ success: true, data: { documentId: v.data.documentId, status: newStatus } });
});

// POST /api/hr/documents/archive
router.post('/documents/archive', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.archive');
  const v = zv(c, z.object({ documentId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data: doc } = await sb.from('hr_employee_documents').select('employee_id').eq('id', v.data.documentId).maybeSingle<{ employee_id: string }>();
  if (!doc) return c.json({ success: false, message: 'Document not found.' }, 404 as 200);
  const { error } = await sb.from('hr_employee_documents').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', v.data.documentId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  await writeHrAudit({ employeeId: doc.employee_id, submoduleKey: 'documents', recordId: v.data.documentId, actorId: actor.id, action: 'hr.employee.document_archived' });
  return c.json({ success: true });
});

// POST /api/hr/documents/download-url  (audited; restricted tiers need sensitive_view)
router.post('/documents/download-url', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.download');
  const v = zv(c, z.object({ documentId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data: doc } = await sb.from('hr_employee_documents').select('employee_id, file_path, confidentiality')
    .eq('id', v.data.documentId).maybeSingle<{ employee_id: string; file_path: string; confidentiality: string }>();
  if (!doc) return c.json({ success: false, message: 'Document not found.' }, 404 as 200);
  if (RESTRICTED_TIERS.has(doc.confidentiality) && !(await userCan(actor, 'hr.employee_documents.sensitive_view'))) {
    return c.json({ success: false, message: 'You do not have permission to access this restricted document.' }, 403 as 200);
  }
  let url = '';
  try { url = await getSignedUrl(HR_DOC_BUCKET, doc.file_path); }
  catch (err) { return c.json({ success: false, message: err instanceof Error ? err.message : 'Could not sign URL' }, 400 as 200); }
  await writeHrAudit({ employeeId: doc.employee_id, submoduleKey: 'documents', recordId: v.data.documentId, actorId: actor.id, action: 'hr.employee.document_downloaded' });
  return c.json({ success: true, url });
});

export default router;
