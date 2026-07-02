// routes/hr.ts — HR people backbone (Phase 1: Employee Master + Organization)
//
// HR is built ON app_users (no fork). These routes add the HR layer over the
// existing identity: HR-field reads, audited employment changes (status /
// transfer / supervisor), positions, org tree, training summary (read-only from
// the Training module), and dashboard KPIs. POST-only; every route gated via
// requirePermission. Sensitive-change approval *workflow* routing is deferred to
// the central Workflow Engine phase — for now changes apply directly (by an
// actor who holds the change permission) and are fully audited + status-tracked.

import { Hono, type Context } from 'hono';
import { sb }         from '../lib/db';
import { requirePermission, requireUser, userCan } from '../lib/auth';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import { emitAppEvent }      from '../lib/appEvents';
import { createAttachmentUploadUrl } from '../lib/upload';
import { getSignedUrl, resolveProfileImageUrl } from '../lib/photos';
import { nextRef }    from '../lib/refGenerator';
import { z, zv }      from '../lib/validate';
import {
  EMPLOYMENT_TYPES, NIS_STATUSES, statutoryPatch, statutoryWithDefaults, computePayrollReadiness,
  writeHrAudit, provisionEmployee, todayISO, type StatutoryRow,
} from '../lib/hr/employeeCore';
import { startOnboardingCase } from '../lib/hr/onboardingCore';
import { CHANGE_TYPES, type ChangeType, CONTACT_COLS, applyApprovedChange, markChangeRequestStatus } from '../lib/hr/changeApproval';
import { startWorkflowForRecord, decideTask } from '../lib/workflow/service';
import { listOrgUnits, getOrgUnit, listPositions, getPosition, listCostCenters, getOrgStats } from '../lib/hr/organizationQueries';
import { getOrgHealthSummary } from '../lib/hr/organizationHealth';
import { previewOrgChangeImpact } from '../lib/hr/organizationImpact';
import {
  createOrgUnit, updateOrgUnit, moveOrgUnit, archiveOrgUnit, deleteOrgUnit,
  createPosition, updatePosition, retirePosition,
  createCostCenter, updateCostCenter, retireCostCenter,
} from '../lib/hr/organizationMutations';
import { listOrgChangeRequests, getOrgChangeRequest, cancelOrgChangeRequest, applyDueOrgChanges } from '../lib/hr/organizationChangeRequests';
import { HR_DOC_BUCKET, RESTRICTED_TIERS, filterVisibleDocs } from '../lib/hr/documentsCore';
import { listAllDocuments, getDocumentsStats, listExpiring } from '../lib/hr/documentsQueries';
import { listRequirements, createRequirement, updateRequirement, retireRequirement } from '../lib/hr/documentsRequirements';
import { getComplianceForEmployee, getComplianceOverview, countMissingRequired } from '../lib/hr/documentsCompliance';
import { runExpirySweep } from '../lib/hr/documentsExpirySweep';
import { resolveSettingValue } from '../lib/settings/resolveSetting';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const HR_COLS =
  'id, username, full_name, first_name, last_name, display_name, role, status, ' +
  'employment_type, department_id, site_id, position, supervisor_id, email, personal_email, ' +
  'phone, employee_number, start_date, end_date, contractor_flag, profile_image_url, profile_image_thumb_url, profile_image, signed_url, signed_url_expires_at, ' +
  'date_of_birth, nationality, government_id, probation_end_date, employee_grade, work_schedule, cost_center, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship';

interface EmpRow { id: string; full_name: string | null; department_id: string | null; supervisor_id: string | null; status: string; [k: string]: unknown }

async function loadEmployee(id: string): Promise<EmpRow | null> {
  const { data } = await sb.from('app_users').select(HR_COLS).eq('id', id).maybeSingle<EmpRow>();
  return data ?? null;
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
  const [{ data: rows, error }, { data: depts }, { data: sites }] = await Promise.all([
    q,
    sb.from('departments').select('id, name'),
    sb.from('project_sites').select('id, name'),
  ]);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const deptMap = Object.fromEntries(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
  const siteMap = Object.fromEntries(((sites ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]));
  let data = (rows ?? []) as unknown as EmpRow[];
  if (v.data.search) {
    const s = v.data.search.toLowerCase();
    data = data.filter(r => (r.full_name ?? '').toLowerCase().includes(s) || String(r['employee_number'] ?? '').toLowerCase().includes(s));
  }

  // Bulk side-reads over the page: training certificates (rolled up per worker) and
  // supervisor names. Supervisors are resolved over their actual ids — a supervisor
  // can sit outside this page — so the contract carries the resolved name, not a raw id.
  const today = todayISO();
  const ids = data.map(r => r.id);
  const supIds = Array.from(new Set(data.map(r => r.supervisor_id).filter((x): x is string => !!x)));
  const [certsRes, supsRes] = await Promise.all([
    ids.length
      ? sb.from('hse_worker_certificates').select('worker_id, status, expires_at').in('worker_id', ids)
      : Promise.resolve({ data: [] as { worker_id: string; status: string; expires_at: string | null }[] }),
    supIds.length
      ? sb.from('app_users').select('id, full_name').in('id', supIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ]);
  const certByWorker = new Map<string, { status: string; expires_at: string | null }[]>();
  for (const cr of (certsRes.data ?? []) as { worker_id: string; status: string; expires_at: string | null }[]) {
    const list = certByWorker.get(cr.worker_id) ?? [];
    list.push({ status: cr.status, expires_at: cr.expires_at });
    certByWorker.set(cr.worker_id, list);
  }
  const supMap = Object.fromEntries(((supsRes.data ?? []) as { id: string; full_name: string | null }[]).map(s => [s.id, s.full_name]));

  return c.json({ success: true, data: data.map(r => ({
    ...r,
    profile_image_url: resolveProfileImageUrl(r as Parameters<typeof resolveProfileImageUrl>[0]),
    departmentName: deptMap[r.department_id ?? ''] ?? null,
    siteName: siteMap[(r['site_id'] as string | null) ?? ''] ?? null,
    supervisorName: r.supervisor_id ? supMap[r.supervisor_id] ?? null : null,
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

  const [{ data: supervisor }, { data: dept }, { data: site }, { data: statusHistory }, { data: assignment }, { data: statutory }] = await Promise.all([
    emp.supervisor_id ? sb.from('app_users').select('id, full_name').eq('id', emp.supervisor_id).maybeSingle() : Promise.resolve({ data: null }),
    emp.department_id ? sb.from('departments').select('id, name').eq('id', emp.department_id).maybeSingle() : Promise.resolve({ data: null }),
    emp['site_id'] ? sb.from('project_sites').select('id, name').eq('id', emp['site_id'] as string).maybeSingle() : Promise.resolve({ data: null }),
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
      profile_image_url: resolveProfileImageUrl(emp as Parameters<typeof resolveProfileImageUrl>[0]),
      supervisorName: (supervisor as { full_name?: string } | null)?.full_name ?? null,
      departmentName: (dept as { name?: string } | null)?.name ?? null,
      siteName: (site as { name?: string } | null)?.name ?? null,
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
      dateOfBirth:    z.string().max(20).optional(),
      nationality:    z.string().max(80).optional(),
      preferredName:  z.string().max(160).optional(),
      governmentId:   z.string().max(80).optional(),
    }),
    employment: z.object({
      employmentType:   z.enum(EMPLOYMENT_TYPES).optional(),
      contractorFlag:   z.boolean().optional(),
      startDate:        z.string().optional(),
      position:         z.string().max(160).optional(),
      positionTitle:    z.string().max(120).optional(),
      probationEndDate: z.string().max(20).optional(),
      employeeGrade:    z.string().max(60).optional(),
      workSchedule:     z.string().max(60).optional(),
    }).optional(),
    assignment: z.object({
      departmentId: z.string().nullable().optional(),
      siteId:       z.string().nullable().optional(),
      positionId:   z.string().uuid().nullable().optional(),
      supervisorId: z.string().nullable().optional(),
      costCenter:   z.string().max(60).nullable().optional(),
      effectiveDate: z.string().max(20).optional(),
    }).optional(),
    access:    z.object({
      role:                   z.string().max(60).optional(),
      permissionProfile:      z.string().max(60).optional(),
      selfServiceProfile:     z.string().max(60).optional(),
      requireMfa:             z.boolean().optional(),
      onboardingRequirements: z.record(z.string(), z.boolean()).optional(),
    }).optional(),
    createLogin:  z.boolean().optional(),
    recordStatus: z.string().max(40).optional(),
    statutory: z.record(z.string(), z.unknown()).optional(),
    onboarding: z.object({
      createOnboardingCase: z.boolean().optional(),
      packageKey:           z.string().optional(),
    }).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { identity, employment, assignment, access, statutory } = v.data;

  // Friendly pre-flight uniqueness (provisionEmployee + the DB constraints are the backstop).
  const { data: dupUser } = await sb.from('app_users').select('id').eq('username', identity.username).maybeSingle();
  if (dupUser) return c.json({ success: false, message: `Username "${identity.username}" is already taken.` }, 400 as 200);
  if (identity.employeeNumber?.trim()) {
    const num = identity.employeeNumber.trim().toUpperCase();
    const { data: dupNum } = await sb.from('app_users').select('id').eq('employee_number', num).maybeSingle();
    if (dupNum) return c.json({ success: false, message: `Employee ID "${num}" is already in use.` }, 400 as 200);
  }

  // Provisioning (app_users + Supabase Auth + satellites, atomic) is the SHARED
  // provisionEmployee() — the same path import/commit uses. The adapter emits the
  // hr.employee.created app_event and tracks the run for idempotency.
  const result = await runModuleMutation<{ id: string; employeeNo: string; readiness: 'pending' | 'ready' | 'blocked' }>({
    context: { actorUserId: actor.id, siteId: assignment?.siteId ?? null, departmentId: assignment?.departmentId ?? null },
    options: {
      module: 'hr', operation: 'create', entityType: 'employee',
      idempotencyKey: `hr.employee.create:${actor.id}:${identity.username}`,
      eventType: 'hr.employee.created', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.employeeNo }),
      buildEventPayload:  (r) => ({ employeeNumber: r.employeeNo, payrollReadiness: r.readiness }),
    },
    writeRecord: () => provisionEmployee(actor.id, { identity, employment, assignment, access, statutory, createLogin: v.data.createLogin, recordStatus: v.data.recordStatus }),
  });

  // Optional onboarding (v36 §10) — the employee is already committed, so starting
  // onboarding is a best-effort follow-up via the shared startOnboardingCase(). A
  // failure does NOT roll back the create (the employee is valid); it is SURFACED
  // (onboarding_error), never swallowed or faked.
  let onboardingCaseId: string | null = null;
  let onboardingError: string | null = null;
  if (v.data.onboarding?.createOnboardingCase) {
    try {
      const ob = await startOnboardingCase(actor.id, { employeeId: result.entityId, packageKey: v.data.onboarding.packageKey ?? 'standard_employee' });
      onboardingCaseId = ob.caseId;
    } catch (e) {
      onboardingError = e instanceof Error ? e.message : 'Onboarding could not be started.';
      console.error('[hr] onboarding start after create failed:', e);
    }
  }

  return c.json({ success: true, data: {
    employee_id: result.entityId, employee_no: result.entityRef, status: 'active',
    payroll_readiness: result.record.readiness, onboarding_case_id: onboardingCaseId,
    onboarding_error: onboardingError, workflow_id: result.workflowId ?? null,
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
  // Emits are AWAITED (emitAppEvent never throws): per Spec §2 the event is part of the
  // mutation, and awaiting guarantees durability before we respond (a fire-and-forget
  // void can be dropped when the serverless instance freezes after the response).
  await emitAppEvent({ eventType: 'hr.employee.statutory_updated', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: v.data.employeeId, actorUserId: actor.id, severity: 'info', payload: { payrollReadiness: readiness.status } });
  // Crossing into payroll-ready emits the domain event the Finance/Payroll handoff will
  // key off. The actual handoff (handoff_outbox → payroll receiver) is build-order step
  // 14 — emitted here as an event, NOT faked as a handoff into the wrong receiver.
  if (!wasReady && readiness.status === 'ready') {
    await emitAppEvent({ eventType: 'hr.employee.payroll_ready', sourceModule: 'hr', sourceEntityType: 'employee',
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
  const rows = (data ?? []) as Array<{ actor_id: string | null; [k: string]: unknown }>;
  // Resolve actor display names server-side (an actor may be any app_user, not just
  // someone on the employee page) — the audit row carries the name, never a raw id.
  const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter((x): x is string => !!x)));
  const { data: actors } = actorIds.length
    ? await sb.from('app_users').select('id, full_name').in('id', actorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const actorMap = Object.fromEntries(((actors ?? []) as { id: string; full_name: string | null }[]).map(a => [a.id, a.full_name]));
  return c.json({ success: true, data: rows.map(r => ({ ...r, actorName: r.actor_id ? actorMap[r.actor_id] ?? null : null })) });
});

// ── Organization Structure (Phase A) ────────────────────────────────────────────
// Org-unit tree + positions + cost centres. Reads via lib/hr/organizationQueries;
// writes (event + audit + guards + concurrency) via lib/hr/organizationMutations.

const orgBody = (c: Context<{ Variables: HonoVariables }>) => (c.get('body') as Record<string, unknown>).args ?? {};
function orgErr(c: Context<{ Variables: HonoVariables }>, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200);
}
const ORG_UNIT_TYPES = ['company', 'division', 'department', 'team', 'crew', 'site_department'] as const;
// Optional fields on every gated mutation: a reason + an effective date (Phase B).
const GATED = { reason: z.string().max(500).nullable().optional(), effectiveFrom: z.string().nullable().optional() };

// POST /api/hr/organization/tree — enriched flat list; frontend builds the tree
router.post('/organization/tree', async c => {
  await requirePermission(c, 'hr.organization.view');
  try { return c.json({ success: true, data: await listOrgUnits() }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/unit/get', async c => {
  await requirePermission(c, 'hr.organization.view');
  const v = zv(c, z.object({ unitId: z.string().min(1) }), orgBody(c));
  if (!v.ok) return v.response;
  try {
    const unit = await getOrgUnit(v.data.unitId);
    if (!unit) return c.json({ success: false, message: 'Org unit not found.' }, 404 as 200);
    return c.json({ success: true, data: unit });
  } catch (e) { return orgErr(c, e); }
});

router.post('/organization/unit/create', async c => {
  const actor = await requirePermission(c, 'hr.organization.manage');
  const v = zv(c, z.object({
    name: z.string().min(1).max(160), code: z.string().max(40).nullable().optional(),
    orgUnitType: z.enum(ORG_UNIT_TYPES).optional(), parentId: z.string().nullable().optional(),
    siteId: z.string().nullable().optional(), managerId: z.string().nullable().optional(),
    costCenterId: z.string().uuid().nullable().optional(), description: z.string().max(500).nullable().optional(),
    sortOrder: z.number().int().optional(),
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createOrgUnit(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/unit/update', async c => {
  const actor = await requirePermission(c, 'hr.organization.manage');
  const v = zv(c, z.object({
    unitId: z.string().min(1), expectedUpdatedAt: z.string().nullable().optional(),
    name: z.string().min(1).max(160).optional(), code: z.string().max(40).nullable().optional(),
    orgUnitType: z.enum(ORG_UNIT_TYPES).optional(), siteId: z.string().nullable().optional(),
    managerId: z.string().nullable().optional(), costCenterId: z.string().uuid().nullable().optional(),
    description: z.string().max(500).nullable().optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
    ...GATED,
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await updateOrgUnit(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/unit/move', async c => {
  const actor = await requirePermission(c, 'hr.organization.manage');
  const v = zv(c, z.object({
    unitId: z.string().min(1), newParentId: z.string().nullable(), expectedUpdatedAt: z.string().nullable().optional(), ...GATED,
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await moveOrgUnit(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/unit/archive', async c => {
  const actor = await requirePermission(c, 'hr.organization.manage');
  const v = zv(c, z.object({ unitId: z.string().min(1), ...GATED }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await archiveOrgUnit(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/unit/delete', async c => {
  const actor = await requirePermission(c, 'hr.organization.delete');
  const v = zv(c, z.object({ unitId: z.string().min(1), ...GATED }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await deleteOrgUnit(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/stats', async c => {
  await requirePermission(c, 'hr.organization.view');
  try { return c.json({ success: true, data: await getOrgStats() }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/health', async c => {
  await requirePermission(c, 'hr.organization.view');
  try { return c.json({ success: true, data: await getOrgHealthSummary() }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/change/preview', async c => {
  await requirePermission(c, 'hr.organization.view');
  const v = zv(c, z.object({
    entityType: z.enum(['org_unit', 'position', 'cost_center']), entityId: z.string().min(1),
    action: z.enum(['move', 'archive', 'delete', 'retire', 'update']), newParentId: z.string().nullable().optional(),
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await previewOrgChangeImpact(v.data) }); }
  catch (e) { return orgErr(c, e); }
});

// ── Positions ──────────────────────────────────────────────────────────────────

// POST /api/hr/sites/list — project sites for assignment selectors (authenticated)
router.post('/sites/list', async c => {
  await requirePermission(c, 'hr.view');
  const { data } = await sb.from('project_sites').select('id, name').order('name');
  return c.json({ success: true, data: data ?? [] });
});

router.post('/positions/list', async c => {
  await requirePermission(c, 'hr.positions.view');
  try { return c.json({ success: true, data: await listPositions() }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/positions/get', async c => {
  await requirePermission(c, 'hr.positions.view');
  const v = zv(c, z.object({ positionId: z.string().uuid() }), orgBody(c));
  if (!v.ok) return v.response;
  try {
    const pos = await getPosition(v.data.positionId);
    if (!pos) return c.json({ success: false, message: 'Position not found.' }, 404 as 200);
    return c.json({ success: true, data: pos });
  } catch (e) { return orgErr(c, e); }
});

router.post('/positions/create', async c => {
  const actor = await requirePermission(c, 'hr.positions.manage');
  const v = zv(c, z.object({
    positionKey: z.string().min(1).max(80), title: z.string().min(1).max(160), grade: z.string().max(60).nullable().optional(),
    departmentId: z.string().nullable().optional(), siteId: z.string().nullable().optional(),
    defaultSupervisorId: z.string().nullable().optional(), reportsToPositionId: z.string().uuid().nullable().optional(),
    isSafetyCritical: z.boolean().optional(), headcountBudget: z.number().int().nullable().optional(),
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createPosition(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/positions/update', async c => {
  const actor = await requirePermission(c, 'hr.positions.manage');
  const v = zv(c, z.object({
    positionId: z.string().uuid(), expectedUpdatedAt: z.string().nullable().optional(),
    title: z.string().max(160).optional(), grade: z.string().max(60).nullable().optional(),
    departmentId: z.string().nullable().optional(), siteId: z.string().nullable().optional(),
    defaultSupervisorId: z.string().nullable().optional(), reportsToPositionId: z.string().uuid().nullable().optional(),
    isSafetyCritical: z.boolean().optional(), headcountBudget: z.number().int().nullable().optional(), isActive: z.boolean().optional(),
    ...GATED,
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await updatePosition(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/positions/retire', async c => {
  const actor = await requirePermission(c, 'hr.positions.manage');
  const v = zv(c, z.object({ positionId: z.string().uuid(), ...GATED }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await retirePosition(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

// ── Cost centres (shared finance_cost_centers registry) ──────────────────────────

router.post('/cost-centers/list', async c => {
  await requirePermission(c, 'hr.cost_centers.view');
  try { return c.json({ success: true, data: await listCostCenters() }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/cost-centers/create', async c => {
  const actor = await requirePermission(c, 'hr.cost_centers.manage');
  const v = zv(c, z.object({
    code: z.string().max(40).nullable().optional(), name: z.string().min(1).max(160),
    currency: z.string().max(8).optional(), annualBudget: z.number().nullable().optional(),
    departmentId: z.string().nullable().optional(), managerId: z.string().nullable().optional(),
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createCostCenter(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/cost-centers/update', async c => {
  const actor = await requirePermission(c, 'hr.cost_centers.manage');
  const v = zv(c, z.object({
    costCenterId: z.string().uuid(), expectedUpdatedAt: z.string().nullable().optional(),
    code: z.string().max(40).nullable().optional(), name: z.string().min(1).max(160).optional(),
    currency: z.string().max(8).optional(), annualBudget: z.number().nullable().optional(),
    departmentId: z.string().nullable().optional(), managerId: z.string().nullable().optional(), isActive: z.boolean().optional(),
    ...GATED,
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await updateCostCenter(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/cost-centers/retire', async c => {
  const actor = await requirePermission(c, 'hr.cost_centers.manage');
  const v = zv(c, z.object({ costCenterId: z.string().uuid(), ...GATED }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await retireCostCenter(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

// ── Org change requests (Phase B — approval envelope) ────────────────────────────

router.post('/organization/changes/list', async c => {
  await requirePermission(c, 'hr.organization.view');
  const v = zv(c, z.object({
    status: z.string().optional(), entityType: z.enum(['org_unit', 'position', 'cost_center']).optional(), limit: z.number().int().optional(),
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listOrgChangeRequests(v.data as never) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/organization/change/get', async c => {
  await requirePermission(c, 'hr.organization.view');
  const v = zv(c, z.object({ changeRequestId: z.string().uuid() }), orgBody(c));
  if (!v.ok) return v.response;
  try {
    const cr = await getOrgChangeRequest(v.data.changeRequestId);
    if (!cr) return c.json({ success: false, message: 'Change request not found.' }, 404 as 200);
    return c.json({ success: true, data: cr });
  } catch (e) { return orgErr(c, e); }
});

router.post('/organization/change/cancel', async c => {
  const actor = await requirePermission(c, 'hr.organization.manage');
  const v = zv(c, z.object({ changeRequestId: z.string().uuid(), reason: z.string().max(500).nullable().optional() }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await cancelOrgChangeRequest(actor.id, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

// Effective-dating sweep — apply every 'scheduled' change whose effective_from passed.
// Service-role only (no scheduler infra exists — trigger via external cron / operator).
router.post('/organization/changes/apply-due', async c => {
  const actor = await requireUser(c);
  if (actor.role !== 'superadmin') return c.json({ success: false, message: 'Service-role only.' }, 403 as 200);
  try { return c.json({ success: true, data: await applyDueOrgChanges(actor.id) }); }
  catch (e) { return orgErr(c, e); }
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

// ── Change requests (maker-checker → central Workflow Engine, Spec §14) ─────────
// Create = hr.view (managers may request changes for their reports). Sensitive
// changes route through the engine: createChangeRequest starts a workflow (one
// binding per change type) and stores workflow_id; the hr_employee_master adapter
// applies the approved change to app_users. /decide delegates to decideTask when a
// workflow exists, else applies directly (no binding). CHANGE_TYPES / ChangeType /
// CONTACT_COLS / applyChange live in lib/hr/changeApproval.
const CHANGE_PERM: Record<ChangeType, string> = {
  status_change:          'hr.employees.status_change',
  department_transfer:    'hr.employees.transfer',
  site_transfer:          'hr.employees.transfer',
  supervisor_change:      'hr.employees.supervisor_change',
  role_change:            'hr.employees.role_change',
  employment_type_change: 'hr.employees.role_change',
  contact_update:         'hr.employees.restricted_contact.update',
  // Bundled transfer/promotion — requires the dedicated transfers.approve gate since
  // it can include role + salary changes (higher oversight than a simple transfer).
  transfer_promotion:     'hr.transfers.approve',
};
function snapshotForChange(t: ChangeType, emp: EmpRow): Record<string, unknown> {
  switch (t) {
    case 'status_change':          return { status: emp.status };
    case 'department_transfer':    return { department_id: emp.department_id };
    case 'site_transfer':          return { site_id: emp['site_id'] };
    case 'supervisor_change':      return { supervisor_id: emp.supervisor_id };
    case 'role_change':            return { role: emp['role'] };
    case 'employment_type_change': return { employment_type: emp['employment_type'] };
    case 'contact_update':         return Object.fromEntries(CONTACT_COLS.map(k => [k, emp[k] ?? null]));
    case 'transfer_promotion':     return {
      department_id:  emp.department_id,
      site_id:        emp['site_id'] ?? null,
      position_id:    emp['position_id'] ?? null,
      supervisor_id:  emp.supervisor_id,
      role:           emp['role'] ?? null,
      monthly_salary: emp['monthly_salary'] ?? null,
      hourly_rate:    emp['hourly_rate'] ?? null,
      pay_basis:      emp['pay_basis'] ?? null,
    };
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
  const id = result.entityId;
  // Route the sensitive change through the central engine. Guard on workflow_id so
  // a deduped retry of the same request doesn't start a second workflow. No binding
  // (startWorkflowForRecord → null) leaves it as a direct maker-checker request.
  const { data: crRow } = await sb.from('hr_employee_change_requests')
    .select('workflow_id').eq('id', id).maybeSingle<{ workflow_id: string | null }>();
  if (crRow && !crRow.workflow_id) {
    const { data: emp } = await sb.from('app_users')
      .select('department_id, site_id').eq('id', p.employeeId)
      .maybeSingle<{ department_id: string | null; site_id: string | null }>();
    const wf = await startWorkflowForRecord({
      context: {
        moduleKey: 'hr_employee_master', workflowType: 'hr_change_approval',
        triggerEvent: `hr.employee.${p.changeType}`, sourceRecordId: id,
        sourceRecordRef: result.record.changeNo, requestedBy: actor.id,
        departmentId: emp?.department_id ?? null, siteId: emp?.site_id ?? null,
        recordData: { employeeId: p.employeeId, changeType: p.changeType, requestedValue: p.requestedValue, previousValue: p.previousValue },
      },
      actor: { id: actor.id },
    });
    if (wf) await sb.from('hr_employee_change_requests').update({ workflow_id: wf.id }).eq('id', id);
  }
  return { id, changeNo: result.record.changeNo };
}

// POST /api/hr/employees/change-request — create (maker)
// NOTE: transfer_promotion is intentionally excluded from this route — it bundles
// role + salary and must only be submitted through /transfers/request
// (gated by hr.transfers.request, not the lower hr.view gate). See brief §3.5.
const GENERIC_CHANGE_TYPES = CHANGE_TYPES.filter(t => t !== 'transfer_promotion') as readonly Exclude<ChangeType, 'transfer_promotion'>[];
router.post('/employees/change-request', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), changeType: z.enum(GENERIC_CHANGE_TYPES as unknown as [string, ...string[]]),
    requestedValue: z.record(z.string(), z.unknown()), reason: z.string().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const changeType = v.data.changeType as ChangeType;
  const cr = await createChangeRequest(actor, {
    employeeId: v.data.employeeId, changeType,
    previousValue: snapshotForChange(changeType, emp), requestedValue: v.data.requestedValue, reason: v.data.reason ?? null,
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
  const { data: req } = await sb.from('hr_employee_change_requests').select('id, employee_id, change_type, status, workflow_id').eq('id', v.data.requestId)
    .maybeSingle<{ id: string; employee_id: string; change_type: ChangeType; status: string; workflow_id: string | null }>();
  if (!req) return c.json({ success: false, message: 'Change request not found.' }, 404 as 200);
  if (!['submitted', 'in_review', 'returned'].includes(req.status))
    return c.json({ success: false, message: `Change request already ${req.status}.` }, 400 as 200);
  // Checker must hold the change-type permission (enforced here; the engine task is role-assigned).
  if (!(await userCan(actor, CHANGE_PERM[req.change_type])))
    return c.json({ success: false, message: 'Forbidden' }, 403 as 200);

  const outcome = v.data.decision === 'approve' ? 'applied' : v.data.decision === 'reject' ? 'rejected' : 'returned';

  // Engine-driven (a binding started a workflow): delegate to the central decision
  // API; the hr_employee_master adapter applies / sets status on the request.
  if (req.workflow_id) {
    const { data: task } = await sb.from('workflow_tasks').select('id')
      .eq('workflow_id', req.workflow_id).in('status', ['pending', 'open', 'in_progress'])
      .order('created_at', { ascending: true }).limit(1).maybeSingle<{ id: string }>();
    if (!task) return c.json({ success: false, message: 'No open approval task for this request.' }, 400 as 200);
    const decision = v.data.decision === 'approve' ? 'approved' : v.data.decision === 'reject' ? 'rejected' : 'returned';
    await decideTask({ workflowId: req.workflow_id, taskId: task.id, actor: { id: actor.id }, decision, comment: v.data.comment });
    // Report the TRUE outcome the adapter wrote — not an assumed one. A single-step
    // approval completes → 'applied'; a multi-step approval only advances → still
    // 'in_review'. (Never claim 'applied' when the change wasn't actually applied.)
    const { data: after } = await sb.from('hr_employee_change_requests').select('status').eq('id', req.id).maybeSingle<{ status: string }>();
    return c.json({ success: true, data: { requestId: req.id, status: after?.status ?? outcome } });
  }

  // Fallback (no binding → no workflow): apply / set status directly via the shared lib.
  if (v.data.decision === 'approve') await applyApprovedChange(req.id, actor.id);
  else await markChangeRequestStatus(req.id, outcome as 'rejected' | 'returned', actor.id, v.data.comment ?? null);
  return c.json({ success: true, data: { requestId: req.id, status: outcome } });
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

// ── Transfers & Promotions (scoped submit + filtered list; decide/cancel reuse the generic routes above) ──
// The bundled transfer_promotion change type bundles dept/site/position/supervisor/role/salary + a
// required effectiveDate and routes through the same hr_change_approval workflow as other change types.
// Approve/reject/cancel go through the existing generic routes above (routed by CHANGE_PERM).

// POST /api/hr/transfers/request — submit a bundled transfer/promotion request
router.post('/transfers/request', async c => {
  const actor = await requirePermission(c, 'hr.transfers.request');
  const v = zv(c, z.object({
    employeeId:    z.string().min(1),
    departmentId:  z.string().nullable().optional(),
    siteId:        z.string().nullable().optional(),
    positionId:    z.string().uuid().nullable().optional(),
    supervisorId:  z.string().nullable().optional(),
    role:          z.string().nullable().optional(),
    monthlySalary: z.number().positive().nullable().optional(),
    hourlyRate:    z.number().positive().nullable().optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveDate must be YYYY-MM-DD'),
    reason:        z.string().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  // At least one changing field (excluding effectiveDate/reason) is required.
  const { employeeId, effectiveDate, reason, ...changedFields } = v.data;
  const hasChange = Object.values(changedFields).some(val => val !== undefined && val !== null);
  if (!hasChange) return c.json({ success: false, message: 'At least one field to change is required (department, site, position, supervisor, role, or salary).' }, 400 as 200);

  const emp = await loadEmployee(employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const requestedValue: Record<string, unknown> = { effectiveDate, reason: reason ?? null };
  if (v.data.departmentId !== undefined)  requestedValue['departmentId']  = v.data.departmentId;
  if (v.data.siteId       !== undefined)  requestedValue['siteId']        = v.data.siteId;
  if (v.data.positionId   !== undefined)  requestedValue['positionId']    = v.data.positionId;
  if (v.data.supervisorId !== undefined)  requestedValue['supervisorId']  = v.data.supervisorId;
  if (v.data.role         !== undefined)  requestedValue['role']          = v.data.role;
  if (v.data.monthlySalary !== undefined) requestedValue['monthlySalary'] = v.data.monthlySalary;
  if (v.data.hourlyRate    !== undefined) requestedValue['hourlyRate']    = v.data.hourlyRate;

  const cr = await createChangeRequest(actor, {
    employeeId,
    changeType:     'transfer_promotion',
    previousValue:  snapshotForChange('transfer_promotion', emp),
    requestedValue,
    reason:         reason ?? null,
  });
  return c.json({ success: true, data: { id: cr.id, changeNo: cr.changeNo } });
});

// POST /api/hr/transfers/list — filtered view of transfer_promotion requests
router.post('/transfers/list', async c => {
  await requirePermission(c, 'hr.transfers.view');
  const v = zv(c, z.object({
    status:     z.string().optional(),
    employeeId: z.string().optional(),
    limit:      z.number().int().positive().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  let q = sb.from('hr_employee_change_requests')
    .select('id, change_no, employee_id, requested_value, previous_value, status, requested_by, requested_at, decided_at, applied_at, metadata, workflow_id')
    .eq('change_type', 'transfer_promotion')
    .order('requested_at', { ascending: false })
    .limit(v.data.limit ?? 200);
  if (v.data.status)     q = q.eq('status', v.data.status);
  if (v.data.employeeId) q = q.eq('employee_id', v.data.employeeId);
  const { data } = await q;
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Enrich with employee and requester names from app_users.
  const allIds = new Set<string>();
  for (const r of rows) {
    if (r['employee_id'])  allIds.add(r['employee_id']  as string);
    if (r['requested_by']) allIds.add(r['requested_by'] as string);
  }
  const { data: users } = await sb.from('app_users').select('id, full_name').in('id', [...allIds]);
  const nameMap = new Map((users ?? []).map((u: { id: string; full_name: string | null }) => [u.id, u.full_name]));

  const enriched = rows.map(r => ({
    id:            r['id'],
    changeNo:      r['change_no'],
    employeeId:    r['employee_id'],
    employeeName:  nameMap.get(r['employee_id'] as string) ?? null,
    requestedBy:   r['requested_by'],
    requestedByName: nameMap.get(r['requested_by'] as string) ?? null,
    status:        r['status'],
    requestedValue: r['requested_value'],
    previousValue:  r['previous_value'],
    effectiveDate: (r['requested_value'] as Record<string, unknown> | null)?.['effectiveDate'] ?? null,
    reason:        (r['metadata'] as Record<string, unknown> | null)?.['reason'] ?? null,
    requestedAt:   r['requested_at'],
    decidedAt:     r['decided_at'],
    appliedAt:     r['applied_at'],
    workflowId:    r['workflow_id'],
  }));

  return c.json({ success: true, data: enriched });
});

// ── Employee Documents (private bucket; verify/reject/archive; audited download) ─

// POST /api/hr/employees/documents/list
router.post('/employees/documents/list', async c => {
  const user = await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const { data } = await sb.from('hr_employee_documents').select('*').eq('employee_id', v.data.employeeId)
    .neq('status', 'archived').order('uploaded_at', { ascending: false });
  const rawRows = (data ?? []) as { confidentiality: string }[];
  // Restricted tiers require the sensitive-view permission (via filterVisibleDocs).
  const canSeeSensitive = await userCan(user, 'hr.employee_documents.sensitive_view');
  const rows = filterVisibleDocs(rawRows, canSeeSensitive);
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

// ── HR Documents Module (cross-employee register, expiry, requirements, compliance) ─
// All reads apply the confidentiality gate via filterVisibleDocs (canSeeSensitive
// pre-computed once per request via userCan).

// POST /api/hr/documents/list — cross-employee register
router.post('/documents/list', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({
    q: z.string().optional(), employeeId: z.string().optional(), departmentId: z.string().optional(),
    documentType: z.string().optional(), status: z.string().optional(), confidentiality: z.string().optional(),
    expiryState: z.enum(['valid','expiring','expired','none']).optional(),
    expiringWithinDays: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(200).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const canSeeSensitive = await userCan(actor, 'hr.employee_documents.sensitive_view');
  try {
    const result = await listAllDocuments(canSeeSensitive, v.data);
    return c.json({ success: true, data: result });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Query failed' }, 500 as 200);
  }
});

// POST /api/hr/documents/stats
router.post('/documents/stats', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.view');
  const canSeeSensitive = await userCan(actor, 'hr.employee_documents.sensitive_view');
  try {
    const missing = await countMissingRequired(canSeeSensitive);
    const stats = await getDocumentsStats(canSeeSensitive, missing);
    return c.json({ success: true, data: stats });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Stats failed' }, 500 as 200);
  }
});

// POST /api/hr/documents/expiring
router.post('/documents/expiring', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({ withinDays: z.number().int().positive().max(365).optional() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const canSeeSensitive = await userCan(actor, 'hr.employee_documents.sensitive_view');
  try {
    const rows = await listExpiring(canSeeSensitive, { withinDays: v.data.withinDays });
    return c.json({ success: true, data: rows });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Query failed' }, 500 as 200);
  }
});

// POST /api/hr/documents/compliance — per-employee or overview
router.post('/documents/compliance', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(), departmentId: z.string().optional(), overview: z.boolean().optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const canSeeSensitive = await userCan(actor, 'hr.employee_documents.sensitive_view');
  try {
    if (v.data.overview || !v.data.employeeId) {
      const rows = await getComplianceOverview(canSeeSensitive, {
        departmentId: v.data.departmentId, employeeId: v.data.employeeId,
      });
      return c.json({ success: true, data: rows });
    }
    const rows = await getComplianceForEmployee(canSeeSensitive, v.data.employeeId);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Compliance query failed' }, 500 as 200);
  }
});

// POST /api/hr/documents/requirements/list
router.post('/documents/requirements/list', async c => {
  await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({ activeOnly: z.boolean().optional() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  try {
    const rows = await listRequirements(v.data.activeOnly ?? true);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'List failed' }, 500 as 200);
  }
});

// POST /api/hr/documents/requirements/create
router.post('/documents/requirements/create', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.requirements.manage');
  const v = zv(c, z.object({
    documentType: z.string().min(1).max(80), label: z.string().min(1).max(200),
    appliesToScope: z.enum(['all','role','employment_type','department']),
    appliesToValue: z.string().nullable().optional(),
    requiresExpiry: z.boolean().optional(), reminderDays: z.array(z.number().int()).optional(),
    minConfidentiality: z.enum(['internal','confidential','restricted_hr','legal','medical']).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  try {
    const req = await createRequirement(actor, v.data);
    return c.json({ success: true, data: req });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return c.json({ success: false, message: e.message ?? 'Create failed' }, (e.status ?? 500) as 200);
  }
});

// POST /api/hr/documents/requirements/update
router.post('/documents/requirements/update', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.requirements.manage');
  const v = zv(c, z.object({
    requirementId: z.string().uuid(), label: z.string().min(1).max(200).optional(),
    requiresExpiry: z.boolean().optional(), reminderDays: z.array(z.number().int()).optional(),
    minConfidentiality: z.enum(['internal','confidential','restricted_hr','legal','medical']).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  try {
    const req = await updateRequirement(actor, v.data);
    return c.json({ success: true, data: req });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return c.json({ success: false, message: e.message ?? 'Update failed' }, (e.status ?? 500) as 200);
  }
});

// POST /api/hr/documents/requirements/retire
router.post('/documents/requirements/retire', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.requirements.manage');
  const v = zv(c, z.object({ requirementId: z.string().uuid() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  try {
    await retireRequirement(actor, v.data);
    return c.json({ success: true });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return c.json({ success: false, message: e.message ?? 'Retire failed' }, (e.status ?? 500) as 200);
  }
});

// POST /api/hr/documents/expiry/run-sweep — SERVICE-ROLE ONLY (no normal principal)
router.post('/documents/expiry/run-sweep', async c => {
  // Reject normal principals — only service-role callers (cron/ops) may trigger this.
  const authHeader = (c.req.raw.headers.get('authorization') ?? '').trim();
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return c.json({ success: false, message: 'Service-role authentication required.' }, 403 as 200);
  }

  const v = zv(c, z.object({ windows: z.array(z.number().int()).optional() }),
    (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  // Read reminder windows from settings (fall back to [30,7,0]).
  let windows = v.data.windows;
  if (!windows) {
    const raw = await resolveSettingValue(sb, 'hr_documents.expiry_reminder_days', { moduleKey: 'hr_documents' }, '30,7,0');
    windows = String(raw).split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
  }
  if (!windows.length) windows = [30, 7, 0];

  try {
    const result = await runExpirySweep(null, { windows });
    return c.json({ success: true, data: result });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Sweep failed' }, 500 as 200);
  }
});

export default router;
