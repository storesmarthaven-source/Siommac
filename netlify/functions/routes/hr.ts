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
import { createHash } from 'node:crypto';
import { sb }         from '../lib/db';
import { requirePermission, requireUser, userCan } from '../lib/auth';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import { emitAppEvent }      from '../lib/appEvents';
import { getReqContext }     from '../lib/reqContext';
import { createAttachmentUploadUrl } from '../lib/upload';
import { getSignedUrl, resolveProfileImageUrl } from '../lib/photos';
import { nextRef }    from '../lib/refGenerator';
import { z, zv, zUsername } from '../lib/validate';
import {
  EMPLOYMENT_TYPES, NIS_STATUSES, statutoryPatch, statutoryProfilePatch,
  statutoryWithDefaults, computePayrollReadiness, profileRowToStatutoryRow,
  writeHrAudit, todayISO,
} from '../lib/hr/employeeCore';
import { CHANGE_TYPES, type ChangeType, CONTACT_COLS, applyApprovedChange, markChangeRequestStatus } from '../lib/hr/changeApproval';
import { decideTask, rpcHttpError } from '../lib/workflow/service';
import { selectWorkflowBinding } from '../lib/workflow/bindingResolver';
import { notifyUsersByRole } from '../lib/finance/financeEvents';
import { listOrgUnits, getOrgUnit, listPositions, getPosition, listCostCenters, getOrgStats } from '../lib/hr/organizationQueries';
import { getOrgHealthSummary } from '../lib/hr/organizationHealth';
import { previewOrgChangeImpact } from '../lib/hr/organizationImpact';
import {
  createOrgUnit, updateOrgUnit, moveOrgUnit, archiveOrgUnit, deleteOrgUnit,
  createPosition, updatePosition, retirePosition,
  createCostCenter, updateCostCenter, retireCostCenter,
} from '../lib/hr/organizationMutations';
import { listOrgChangeRequests, getOrgChangeRequest, cancelOrgChangeRequest, applyDueOrgChanges } from '../lib/hr/organizationChangeRequests';
import { HR_DOC_BUCKET, HR_DOC_MAX_BYTES, RESTRICTED_TIERS, filterVisibleDocs } from '../lib/hr/documentsCore';
import { listAllDocuments, getDocumentsStats, listExpiring } from '../lib/hr/documentsQueries';
import { listRequirements, createRequirement, updateRequirement, retireRequirement } from '../lib/hr/documentsRequirements';
import { getComplianceForEmployee, getComplianceOverview, countMissingRequired } from '../lib/hr/documentsCompliance';
import { runExpirySweep } from '../lib/hr/documentsExpirySweep';
import { resolveSettingValue } from '../lib/settings/resolveSetting';
import { getEmployerProfile } from '../lib/finance/employerProfile';
import { getDocumentHealth } from '../lib/hr/documentHealth';
import { listAccessAssignments, grantAccessAssignment, revokeAccessAssignment } from '../lib/hr/accessAssignments';
import {
  buildAttentionItems, buildTabIndicators, filterAttentionByCapability, loadAttentionInput,
} from '../lib/hr/employeeAttention';
import { buildProfileShell, type ShellContext } from '../lib/hr/employeeProfileShell';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const HR_COLS =
  'id, username, full_name, first_name, last_name, display_name, role, status, employment_status, ' +
  'employment_type, department_id, site_id, position, supervisor_id, email, personal_email, ' +
  'phone, mobile_phone, employee_number, start_date, end_date, contractor_flag, created_at, profile_image_url, profile_image_thumb_url, profile_image, signed_url, signed_url_expires_at, ' +
  'profile_image_pending_thumb_url, profile_image_pending_submitted_at, ' +
  'date_of_birth, nationality, government_id, probation_end_date, employee_grade, work_schedule, cost_center, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relationship';

interface EmpRow { id: string; full_name: string | null; department_id: string | null; site_id: string | null; supervisor_id: string | null; status: string; employment_status: string | null; role: string; employment_type: string | null; [k: string]: unknown }

async function loadEmployee(id: string): Promise<EmpRow | null> {
  const { data, error } = await sb.from('app_users').select(HR_COLS).eq('id', id).maybeSingle<EmpRow>();
  if (error) throw new Error(`Employee read failed: ${error.message}`);
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

interface EmployeeReadiness {
  percent: number;
  assignmentComplete: boolean;
  payrollStatus: 'pending' | 'ready' | 'blocked';
  trainingStatus: 'current' | 'due_soon' | 'expired' | 'none';
  blockers: ('assignment' | 'payroll' | 'training')[];
}

/** One readiness contract for register rows and employee detail. */
function employeeReadiness(
  employee: Pick<EmpRow, 'supervisor_id' | 'department_id'> & Record<string, unknown>,
  payrollStatus: EmployeeReadiness['payrollStatus'],
  trainingStatus: EmployeeReadiness['trainingStatus'],
): EmployeeReadiness {
  const assignmentComplete = !!employee.supervisor_id && !!employee.department_id && !!employee.site_id;
  const blockers: EmployeeReadiness['blockers'] = [];
  if (!assignmentComplete) blockers.push('assignment');
  if (payrollStatus !== 'ready') blockers.push('payroll');
  if (trainingStatus !== 'current') blockers.push('training');
  const passed = Number(assignmentComplete) + Number(payrollStatus === 'ready') + Number(trainingStatus === 'current');
  return { percent: Math.round((passed / 3) * 100), assignmentComplete, payrollStatus, trainingStatus, blockers };
}

// ── Employee Master ────────────────────────────────────────────────────────────

const EMPLOYEE_SORT_COLS = ['full_name', 'employee_number', 'status', 'employment_type', 'start_date', 'department_id'] as const;
const TRAINING_STATUSES = ['current', 'due_soon', 'expired', 'none'] as const;

/** Escape Postgres ILIKE wildcards in user-supplied search text before interpolating into `.or(...)`. */
function escapeLike(s: string): string {
  return s.replace(/[%_,]/g, ch => '\\' + ch);
}

// POST /api/hr/employees/list
const MISSING_COLUMN = { supervisor: 'supervisor_id', department: 'department_id', site: 'site_id' } as const;
router.post('/employees/list', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({
    // Legacy single-value filters (kept for existing picker/dropdown callers).
    status: z.string().optional(), departmentId: z.string().optional(),
    employmentType: z.string().optional(), workerType: z.enum(['employee', 'contractor']).optional(),
    search: z.string().optional(), limit: z.number().int().positive().max(500).optional(),
    // Server-backed register filters (multi-select) + sort + pagination.
    statuses: z.array(z.string()).optional(),
    departmentIds: z.array(z.string()).optional(),
    employmentTypes: z.array(z.string()).optional(),
    trainingStatuses: z.array(z.enum(TRAINING_STATUSES)).optional(),
    // Records MISSING a required assignment field. Backs the Exceptions KPI drill-down, which
    // otherwise had no corresponding register filter and could only scroll the page.
    missing: z.array(z.enum(['supervisor', 'department', 'site'])).optional(),
    sortBy: z.enum(EMPLOYEE_SORT_COLS).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(200).optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const paginated = v.data.page != null && v.data.pageSize != null;
  const sortCol = v.data.sortBy ?? 'full_name';
  const sortDbCol = sortCol === 'status' ? 'employment_status' : sortCol;
  const sortAsc = (v.data.sortDir ?? 'asc') !== 'desc';
  const searchLike = v.data.search ? escapeLike(v.data.search) : null;
  const today = todayISO();

  // Training status is a computed rollup (joins hse_worker_certificates), so it
  // can't be pushed into the app_users WHERE clause. When it's filtered on, resolve
  // the full matching id set (real filters only) first, roll up training per id,
  // narrow to the requested statuses, THEN page/sort/select over that exact id list —
  // this keeps pagination + totals honest instead of filtering only the current page.
  let restrictToIds: string[] | null = null;
  if (v.data.trainingStatuses?.length) {
    let idQ = sb.from('app_users').select('id').neq('role', 'superadmin').neq('role', 'admin').not('employee_number', 'is', null);
    if (v.data.status)                 idQ = idQ.eq('employment_status', v.data.status);
    if (v.data.statuses?.length)       idQ = idQ.in('employment_status', v.data.statuses);
    if (v.data.departmentId)           idQ = idQ.eq('department_id', v.data.departmentId);
    if (v.data.departmentIds?.length)  idQ = idQ.in('department_id', v.data.departmentIds);
    if (v.data.employmentType)         idQ = idQ.eq('employment_type', v.data.employmentType);
    if (v.data.employmentTypes?.length) idQ = idQ.in('employment_type', v.data.employmentTypes);
    if (v.data.workerType)             idQ = idQ.eq('contractor_flag', v.data.workerType === 'contractor');
    if (v.data.missing?.length)        idQ = idQ.or(v.data.missing.map(m => `${MISSING_COLUMN[m]}.is.null`).join(','));
    if (searchLike)                    idQ = idQ.or(`full_name.ilike.%${searchLike}%,employee_number.ilike.%${searchLike}%,email.ilike.%${searchLike}%,position.ilike.%${searchLike}%`);
    const { data: idRows, error: idErr } = await idQ;
    if (idErr) return c.json({ success: false, message: idErr.message }, 500 as 200);
    const allIds = (idRows as { id: string }[]).map(r => r.id);
    const { data: certRows } = allIds.length
      ? await sb.from('hse_worker_certificates').select('worker_id, status, expires_at').in('worker_id', allIds)
      : { data: [] as { worker_id: string; status: string; expires_at: string | null }[] };
    const certByWorker = new Map<string, { status: string; expires_at: string | null }[]>();
    for (const cr of (certRows ?? []) as { worker_id: string; status: string; expires_at: string | null }[]) {
      const list = certByWorker.get(cr.worker_id) ?? [];
      list.push({ status: cr.status, expires_at: cr.expires_at });
      certByWorker.set(cr.worker_id, list);
    }
    const wanted = new Set(v.data.trainingStatuses);
    restrictToIds = allIds.filter(id => wanted.has(rollupTrainingStatus(certByWorker.get(id) ?? [], today)));
    if (!restrictToIds.length) {
      return c.json({ success: true, data: [], meta: { total: 0, page: v.data.page ?? 1, pageSize: v.data.pageSize ?? 0, departments: [], statuses: HR_STATUSES, employmentTypes: EMPLOYMENT_TYPES, trainingStatuses: TRAINING_STATUSES } });
    }
  }

  let q = sb.from('app_users').select(HR_COLS, paginated ? { count: 'exact' } : {}).neq('role', 'superadmin').neq('role', 'admin').not('employee_number', 'is', null);
  if (v.data.status)                 q = q.eq('employment_status', v.data.status);
  if (v.data.statuses?.length)       q = q.in('employment_status', v.data.statuses);
  if (v.data.departmentId)           q = q.eq('department_id', v.data.departmentId);
  if (v.data.departmentIds?.length)  q = q.in('department_id', v.data.departmentIds);
  if (v.data.employmentType)         q = q.eq('employment_type', v.data.employmentType);
  if (v.data.employmentTypes?.length) q = q.in('employment_type', v.data.employmentTypes);
  if (v.data.workerType)             q = q.eq('contractor_flag', v.data.workerType === 'contractor');
  if (searchLike)                    q = q.or(`full_name.ilike.%${searchLike}%,employee_number.ilike.%${searchLike}%,email.ilike.%${searchLike}%,position.ilike.%${searchLike}%`);
  if (v.data.missing?.length) {
    // OR across the requested fields: "missing supervisor OR department OR site".
    q = q.or(v.data.missing.map(m => `${MISSING_COLUMN[m]}.is.null`).join(','));
  }
  if (restrictToIds)                 q = q.in('id', restrictToIds);
  q = q.order(sortDbCol, { ascending: sortAsc });
  q = paginated
    ? q.range((v.data.page! - 1) * v.data.pageSize!, v.data.page! * v.data.pageSize! - 1)
    : q.limit(v.data.limit ?? 300);

  const [{ data: rows, error, count }, { data: depts }, { data: sites }] = await Promise.all([
    q,
    sb.from('departments').select('id, name'),
    sb.from('project_sites').select('id, name'),
  ]);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const deptMap = Object.fromEntries(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
  const siteMap = Object.fromEntries(((sites ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]));
  const data = rows as unknown as EmpRow[];

  // Bulk side-reads over the page: training certificates (rolled up per worker) and
  // supervisor names. Supervisors are resolved over their actual ids — a supervisor
  // can sit outside this page — so the contract carries the resolved name, not a raw id.
  const ids = data.map(r => r.id);
  const supIds = Array.from(new Set(data.map(r => r.supervisor_id).filter((x): x is string => !!x)));
  const [canStatutory, canReadiness] = await Promise.all([
    userCan(actor, 'hr.employees.statutory.view'),
    userCan(actor, 'hr.employees.payroll_readiness.view'),
  ]);
  const mayViewReadiness = canStatutory || canReadiness;
  const [certsRes, supsRes, readinessRes, offboardingRes] = await Promise.all([
    ids.length
      ? sb.from('hse_worker_certificates').select('worker_id, status, expires_at').in('worker_id', ids)
      : Promise.resolve({ data: [] as { worker_id: string; status: string; expires_at: string | null }[], error: null }),
    supIds.length
      ? sb.from('app_users').select('id, full_name').in('id', supIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null }),
    mayViewReadiness && ids.length
      ? sb.from('hr_employee_statutory_profiles').select('employee_id, payroll_ready_status').eq('jurisdiction', 'TT').in('employee_id', ids)
      : Promise.resolve({ data: [] as { employee_id: string; payroll_ready_status: string }[], error: null }),
    // Whether an offboarding case is already running, so the register can hide "Start
    // Offboarding" on employees who are already leaving. A boolean only — no case detail —
    // and it rides the hr_offboarding_cases(employee_id, status) index.
    ids.length
      ? sb.from('hr_offboarding_cases').select('employee_id').in('employee_id', ids).not('status', 'in', '("completed","cancelled")')
      : Promise.resolve({ data: [] as { employee_id: string | null }[], error: null }),
  ]);
  if (certsRes.error) return c.json({ success: false, message: certsRes.error.message }, 500 as 200);
  if (supsRes.error) return c.json({ success: false, message: supsRes.error.message }, 500 as 200);
  if (readinessRes.error) return c.json({ success: false, message: readinessRes.error.message }, 500 as 200);
  if (offboardingRes.error) return c.json({ success: false, message: offboardingRes.error.message }, 500 as 200);
  const offboardingActiveIds = new Set((offboardingRes.data as { employee_id: string | null }[])
    .map(row => row.employee_id).filter((id): id is string => !!id));
  const certByWorker = new Map<string, { status: string; expires_at: string | null }[]>();
  for (const cr of certsRes.data as { worker_id: string; status: string; expires_at: string | null }[]) {
    const list = certByWorker.get(cr.worker_id) ?? [];
    list.push({ status: cr.status, expires_at: cr.expires_at });
    certByWorker.set(cr.worker_id, list);
  }
  const supMap = Object.fromEntries((supsRes.data as { id: string; full_name: string | null }[]).map(s => [s.id, s.full_name]));
  const readinessMap = new Map((readinessRes.data as { employee_id: string; payroll_ready_status: string }[])
    .map(row => [row.employee_id, row.payroll_ready_status]));

  const mapped = data.map(r => {
    const payrollStatus = (readinessMap.get(r.id) ?? 'pending') as 'pending' | 'ready' | 'blocked';
    const trainingStatus = rollupTrainingStatus(certByWorker.get(r.id) ?? [], today);
    return {
      ...r,
      accountStatus: r.status,
      status: r.employment_status ?? 'active',
      profile_image_url: resolveProfileImageUrl(r as Parameters<typeof resolveProfileImageUrl>[0]),
      departmentName: deptMap[r.department_id ?? ''] ?? null,
      siteName: siteMap[r.site_id ?? ''] ?? null,
      supervisorName: r.supervisor_id ? supMap[r.supervisor_id] ?? null : null,
      workerType: r.contractor_flag ? 'contractor' : 'employee',
      trainingStatus,
      readiness: mayViewReadiness ? employeeReadiness(r, payrollStatus, trainingStatus) : null,
      offboardingActive: offboardingActiveIds.has(r.id),
    };
  });

  return c.json({
    success: true,
    data: mapped,
    meta: {
      total: restrictToIds ? restrictToIds.length : (paginated ? (count ?? mapped.length) : mapped.length),
      page: v.data.page ?? 1,
      pageSize: v.data.pageSize ?? mapped.length,
      departments: (depts ?? []),
      statuses: HR_STATUSES,
      employmentTypes: EMPLOYMENT_TYPES,
      trainingStatuses: TRAINING_STATUSES,
    },
  });
});

// POST /api/hr/employees/get
router.post('/employees/get', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const [supervisorResult, departmentResult, siteResult, statusHistoryResult, assignmentsResult, statutoryResult, certificates, payGroupAssignmentResult] = await Promise.all([
    emp.supervisor_id ? sb.from('app_users').select('id, full_name').eq('id', emp.supervisor_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    emp.department_id ? sb.from('departments').select('id, name').eq('id', emp.department_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    emp.site_id ? sb.from('project_sites').select('id, name').eq('id', emp.site_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sb.from('hr_employee_status_history').select('*').eq('employee_id', emp.id).order('changed_at', { ascending: false }).limit(20),
    sb.from('hr_employee_assignments').select('*').eq('employee_id', emp.id).order('effective_from', { ascending: false }),
    // Read statutory from the canonical profiles table; map nis_reg_status → nis_status for the FE contract.
    sb.from('hr_employee_statutory_profiles').select('*').eq('employee_id', emp.id).eq('jurisdiction', 'TT').maybeSingle<Record<string, unknown>>(),
    sb.from('hse_worker_certificates').select('status, expires_at').eq('worker_id', emp.id),
    sb.from('finance_employee_pay_group_assignments')
      .select('pay_group_id, effective_from, effective_to')
      .eq('employee_id', emp.id)
      .lte('effective_from', todayISO())
      .or(`effective_to.is.null,effective_to.gte.${todayISO()}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle<{ pay_group_id: string; effective_from: string; effective_to: string | null }>(),
  ]);

  const readErrors = [
    supervisorResult.error, departmentResult.error, siteResult.error, statusHistoryResult.error,
    assignmentsResult.error, statutoryResult.error, certificates.error, payGroupAssignmentResult.error,
  ].filter((error): error is NonNullable<typeof error> => !!error);
  if (readErrors.length) {
    return c.json({ success: false, message: `Employee profile read failed: ${readErrors[0].message}` }, 500 as 200);
  }
  const supervisor = supervisorResult.data;
  const dept = departmentResult.data;
  const site = siteResult.data;
  const statusHistory = statusHistoryResult.data;
  const assignmentRows = (assignmentsResult.data ?? []) as Record<string, unknown>[];
  const statutory = statutoryResult.data;

  const idsFor = (field: string) => Array.from(new Set(
    assignmentRows.map(row => row[field]).filter((id): id is string => typeof id === 'string'),
  ));
  const [assignmentDepartmentsResult, assignmentSitesResult, assignmentSupervisorsResult, assignmentPositionsResult] = await Promise.all([
    idsFor('department_id').length ? sb.from('departments').select('id, name').in('id', idsFor('department_id')) : Promise.resolve({ data: [], error: null }),
    idsFor('site_id').length ? sb.from('project_sites').select('id, name').in('id', idsFor('site_id')) : Promise.resolve({ data: [], error: null }),
    idsFor('supervisor_id').length ? sb.from('app_users').select('id, full_name').in('id', idsFor('supervisor_id')) : Promise.resolve({ data: [], error: null }),
    idsFor('position_id').length ? sb.from('hr_positions').select('id, title').in('id', idsFor('position_id')) : Promise.resolve({ data: [], error: null }),
  ]);
  const enrichmentErrors = [
    assignmentDepartmentsResult.error, assignmentSitesResult.error,
    assignmentSupervisorsResult.error, assignmentPositionsResult.error,
  ].filter((error): error is NonNullable<typeof error> => !!error);
  if (enrichmentErrors.length) {
    return c.json({ success: false, message: `Employee assignment history read failed: ${enrichmentErrors[0].message}` }, 500 as 200);
  }
  const lookup = (rows: unknown[], field: 'name' | 'full_name' | 'title') =>
    new Map((rows as Record<string, unknown>[]).map(row => [row.id as string, (row[field] as string | null) ?? null]));
  const departmentNames = lookup(assignmentDepartmentsResult.data ?? [], 'name');
  const siteNames = lookup(assignmentSitesResult.data ?? [], 'name');
  const supervisorNames = lookup(assignmentSupervisorsResult.data ?? [], 'full_name');
  const positionNames = lookup(assignmentPositionsResult.data ?? [], 'title');
  const assignmentHistory = assignmentRows.map(row => ({
    ...row,
    departmentName: typeof row.department_id === 'string' ? departmentNames.get(row.department_id) ?? null : null,
    siteName: typeof row.site_id === 'string' ? siteNames.get(row.site_id) ?? null : null,
    supervisorName: typeof row.supervisor_id === 'string' ? supervisorNames.get(row.supervisor_id) ?? null : null,
    positionTitle: typeof row.position_id === 'string' ? positionNames.get(row.position_id) ?? null : null,
  }));

  let payGroup: { id: string; code: string; name: string; frequency: string; effectiveFrom: string; effectiveTo: string | null } | null = null;
  const payGroupAssignment = payGroupAssignmentResult.data;
  if (payGroupAssignment) {
    const { data: group, error } = await sb.from('finance_pay_groups')
      .select('id, code, name, frequency').eq('id', payGroupAssignment.pay_group_id)
      .maybeSingle<{ id: string; code: string; name: string; frequency: string }>();
    if (error) return c.json({ success: false, message: `Employee pay group read failed: ${error.message}` }, 500 as 200);
    if (group) payGroup = { ...group, effectiveFrom: payGroupAssignment.effective_from, effectiveTo: payGroupAssignment.effective_to };
  }

  let accessProfile: { id: string; code: string; label: string; description: string | null; requiresMfa: boolean } | null = null;
  if (await userCan(actor, 'auth.security.view')) {
    const { data: profiles, error } = await sb.from('hr_access_profiles')
      .select('id, code, label, description, requires_mfa')
      .eq('system_role', emp.role)
      .eq('is_active', true)
      .order('sort_order')
      .limit(2);
    if (error) return c.json({ success: false, message: `Employee access profile read failed: ${error.message}` }, 500 as 200);
    // app_users currently stores the resolved system role, not the wizard profile id.
    // A role may map to more than one profile (for example employee/no-login), so
    // only expose a profile when the mapping is unambiguous. Never invent one.
    const typedProfiles = profiles as {
      id: string; code: string; label: string; description: string | null; requires_mfa: boolean;
    }[];
    const profile = typedProfiles.length === 1 ? typedProfiles[0] : null;
    if (profile) {
      accessProfile = {
        id: profile.id, code: profile.code, label: profile.label,
        description: profile.description, requiresMfa: profile.requires_mfa,
      };
    }
  }

  // Statutory is sensitive — full detail needs statutory.view; readiness-only needs payroll_readiness.view.
  const [canStatutory, canReadiness] = await Promise.all([
    userCan(actor, 'hr.employees.statutory.view'),
    userCan(actor, 'hr.employees.payroll_readiness.view'),
  ]);
  // Map the profiles-table row to the legacy StatutoryRow shape (nis_reg_status → nis_status)
  // so the existing frontend contract is unchanged.
  const statutoryMapped = statutory ? profileRowToStatutoryRow(statutory) : null;
  const payrollReadiness = statutory ? {
    status: (statutory.payroll_ready_status ?? 'pending') as string,
    blockers: (statutory.missing_blockers ?? []) as string[],
    financeHandoffEligible: (statutory.finance_handoff_eligible ?? false) as boolean,
  } : { status: 'pending', blockers: [] as string[], financeHandoffEligible: false };
  const trainingStatus = rollupTrainingStatus(
    certificates.data ?? [],
    todayISO(),
  );
  const readiness = (canStatutory || canReadiness)
    ? employeeReadiness(emp, payrollReadiness.status as EmployeeReadiness['payrollStatus'], trainingStatus)
    : null;

  return c.json({ success: true, data: {
    employee: { ...emp,
      accountStatus: emp.status,
      status: emp.employment_status ?? 'active',
      profile_image_url: resolveProfileImageUrl(emp as Parameters<typeof resolveProfileImageUrl>[0]),
      supervisorName: (supervisor as { full_name?: string } | null)?.full_name ?? null,
      departmentName: (dept as { name?: string } | null)?.name ?? null,
      siteName: (site as { name?: string } | null)?.name ?? null,
      workerType: emp.contractor_flag ? 'contractor' : 'employee',
      trainingStatus,
      readiness,
    },
    statusHistory: statusHistory ?? [],
    currentAssignment: assignmentHistory.find(row => (row as Record<string, unknown>).is_current === true) ?? null,
    assignmentHistory,
    payGroup,
    accessProfile,
    statutory: canStatutory ? (statutoryMapped ?? null) : null,
    payrollReadiness: (canStatutory || canReadiness) ? payrollReadiness : null,
  } });
});

/**
 * Resolve the capability set once per request.
 *
 * The shell and attention contracts filter on capability rather than issuing a
 * separate `userCan` per item, so a profile with many attention items still costs
 * one role lookup.
 */
async function grantedProfileCapabilities(actor: { id: string; role?: string | null }): Promise<Set<string>> {
  const keys = [
    'hr.employees.statutory.view', 'hr.employees.payroll_readiness.view',
    'hr.employee_documents.view', 'hr.audit.view',
    'hr.onboarding.view', 'hr.offboarding.view', 'auth.security.view',
  ];
  const results = await Promise.all(keys.map(k => userCan(actor, k)));
  return new Set(keys.filter((_, i) => results[i]));
}

/**
 * Read the shared context the shell needs on top of the employee row: resolved
 * department/site/supervisor names, pay group, access-profile label, and the
 * payroll/training signals that drive the readiness gauge.
 */
async function loadShellContext(employee: EmpRow): Promise<ShellContext> {
  const [deptRes, siteRes, supRes, statRes, certsRes, payGroupRes, assignmentRes, employerProfile] = await Promise.all([
    employee.department_id ? sb.from('departments').select('name').eq('id', employee.department_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null, error: null }),
    employee.site_id ? sb.from('project_sites').select('name').eq('id', employee.site_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null, error: null }),
    employee.supervisor_id ? sb.from('app_users').select('full_name').eq('id', employee.supervisor_id).maybeSingle<{ full_name: string | null }>() : Promise.resolve({ data: null, error: null }),
    sb.from('hr_employee_statutory_profiles').select('payroll_ready_status').eq('employee_id', employee.id).eq('jurisdiction', 'TT').maybeSingle<{ payroll_ready_status: string | null }>(),
    sb.from('hse_worker_certificates').select('status, expires_at').eq('worker_id', employee.id),
    sb.from('finance_employee_pay_group_assignments')
      .select('pay_group_id').eq('employee_id', employee.id)
      .lte('effective_from', todayISO())
      .or(`effective_to.is.null,effective_to.gte.${todayISO()}`)
      .order('effective_from', { ascending: false }).limit(1)
      .maybeSingle<{ pay_group_id: string }>(),
    // Working time lives on the CURRENT effective-dated assignment period.
    sb.from('hr_employee_assignments')
      .select('weekly_hours, fte').eq('employee_id', employee.id).eq('is_current', true)
      .order('effective_from', { ascending: false }).limit(1)
      .maybeSingle<{ weekly_hours: number | null; fte: number | null }>(),
    // Canonical single-tenant employer record — the same one TD4/NI184/NI187 and
    // the payslip employer block read. Never a profile-local copy.
    getEmployerProfile(),
  ]);
  const errors = [deptRes.error, siteRes.error, supRes.error, statRes.error, certsRes.error, payGroupRes.error, assignmentRes.error]
    .filter((e): e is NonNullable<typeof e> => !!e);
  if (errors.length) throw new Error(`Employee profile context read failed: ${errors[0].message}`);

  let payGroupName: string | null = null;
  if (payGroupRes.data) {
    const { data: group, error } = await sb.from('finance_pay_groups')
      .select('name').eq('id', payGroupRes.data.pay_group_id).maybeSingle<{ name: string }>();
    if (error) throw new Error(`Employee pay group read failed: ${error.message}`);
    payGroupName = group?.name ?? null;
  }

  // Only expose an access-profile label when the role maps to exactly one active
  // profile — an ambiguous mapping must not be guessed (same rule as employees/get).
  let accessProfileLabel: string | null = null;
  const { data: profiles, error: profilesError } = await sb.from('hr_access_profiles')
    .select('label').eq('system_role', employee.role).eq('is_active', true).limit(2);
  if (profilesError) throw new Error(`Employee access profile read failed: ${profilesError.message}`);
  const typedProfiles = profiles as { label: string }[];
  if (typedProfiles.length === 1) accessProfileLabel = typedProfiles[0].label;

  return {
    departmentName: deptRes.data?.name ?? null,
    siteName: siteRes.data?.name ?? null,
    supervisorName: supRes.data?.full_name ?? null,
    payGroupName,
    accessProfileLabel,
    payrollStatus: (statRes.data?.payroll_ready_status ?? 'pending') as ShellContext['payrollStatus'],
    trainingStatus: rollupTrainingStatus(certsRes.data ?? [], todayISO()),
    // An unconfigured employer profile yields an empty legalName; surface null so
    // the UI shows its empty state rather than an empty-looking value.
    legalEmployer: employerProfile.legalName.trim() || null,
    weeklyHours: assignmentRes.data?.weekly_hours ?? null,
    fte: assignmentRes.data?.fte ?? null,
  };
}

/**
 * POST /api/hr/employees/profile-shell — the ONE contract the Employee Profile
 * drawer and the full employee page open with.
 *
 * Permission-filtered server-side: statutory/readiness, documents, audit,
 * onboarding and offboarding blocks are omitted (not blanked) for actors without
 * the capability, and attention items of those domains never leave the server.
 */
router.post('/employees/profile-shell', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const [granted, ctx] = await Promise.all([
    grantedProfileCapabilities(actor),
    loadShellContext(emp),
  ]);
  const shell = await buildProfileShell(emp, ctx, granted);
  return c.json({ success: true, data: shell });
});

/**
 * POST /api/hr/employees/attention — the full unresolved-work list behind the
 * Needs Attention panel's view-all behaviour.
 *
 * Same aggregation and the same capability filter as the shell, so the panel and
 * the tab indicators can never disagree.
 */
router.post('/employees/attention', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const granted = await grantedProfileCapabilities(actor);
  const input = await loadAttentionInput(emp, todayISO());
  const items = filterAttentionByCapability(buildAttentionItems(input), granted);
  return c.json({ success: true, data: { items, total: items.length, tabIndicators: buildTabIndicators(items) } });
});

/**
 * POST /api/hr/employees/document-health — per-employee document health.
 *
 * TAB-SCOPED on purpose: the grouped tree is the Documents surface's dataset and
 * must not be pulled just to open the drawer, so it is NOT part of the profile
 * shell. Gated on the documents capability, and the sensitive-tier filter is
 * applied server-side before anything is counted — so a restricted document
 * cannot leak through a count or a percentage either.
 */
router.post('/employees/document-health', async c => {
  const actor = await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const canSeeSensitive = await userCan(actor, 'hr.employee_documents.sensitive_view');
  try {
    const health = await getDocumentHealth(v.data.employeeId, canSeeSensitive, todayISO());
    return c.json({ success: true, data: health });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return c.json({ success: false, message: err.message ?? 'Document health read failed.' },
      (err.status ?? 500) as 200);
  }
});

/**
 * POST /api/hr/employees/access-assignments — an employee's access assignments
 * with their recorded scopes.
 *
 * Every id is resolved to a label server-side, so no raw uuid or department id
 * reaches the UI. Scope is read from the stored scope rows — it is never
 * re-derived from the employee's role.
 */
router.post('/employees/access-assignments', async c => {
  await requirePermission(c, 'hr.employees.access_assignments.view');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    activeOnly: z.boolean().optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  try {
    const rows = await listAccessAssignments(v.data.employeeId, v.data.activeOnly ?? false);
    return c.json({ success: true, data: rows });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return c.json({ success: false, message: err.message ?? 'Access assignment read failed.' },
      (err.status ?? 500) as 200);
  }
});

/**
 * POST /api/hr/employees/access-assignments/grant
 *
 * Elevated: granting access is a different authority from seeing it, so this
 * requires `manage` rather than `view`. At least one scope is required — the
 * command fails closed on an empty scope list rather than recording an
 * unbounded grant.
 */
router.post('/employees/access-assignments/grant', async c => {
  const actor = await requirePermission(c, 'hr.employees.access_assignments.manage');
  const v = zv(c, z.object({
    employeeId:      z.string().min(1),
    accessProfileId: z.uuid(),
    assignmentType:  z.enum(['profile', 'mandatory', 'delegated']).optional(),
    effectiveFrom:   z.iso.date().nullable().optional(),
    scopes: z.array(z.object({
      scopeType: z.enum(['organisation', 'department', 'site']),
      scopeId:   z.string().min(1).nullable().optional(),
    })).min(1, 'At least one scope is required.'),
    reason: z.string().max(500).optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  // A department/site scope without a target would be meaningless; the database
  // enforces this too, but failing here gives the caller a field-level message.
  const unscoped = v.data.scopes.find(s => s.scopeType !== 'organisation' && !s.scopeId);
  if (unscoped) {
    return c.json({ success: false, message: `A ${unscoped.scopeType} scope requires a target.` }, 422 as 200);
  }

  try {
    const result = await grantAccessAssignment({
      actorId: actor.id,
      employeeId: v.data.employeeId,
      accessProfileId: v.data.accessProfileId,
      assignmentType: v.data.assignmentType,
      effectiveFrom: v.data.effectiveFrom ?? null,
      scopes: v.data.scopes,
      correlationId: crypto.randomUUID(),
    });
    return c.json({ success: true, data: result });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return c.json({ success: false, message: err.message ?? 'Access assignment grant failed.' },
      (err.status ?? 500) as 200);
  }
});

/** POST /api/hr/employees/access-assignments/revoke — elevated, same reasoning. */
router.post('/employees/access-assignments/revoke', async c => {
  const actor = await requirePermission(c, 'hr.employees.access_assignments.manage');
  const v = zv(c, z.object({
    assignmentId: z.uuid(),
    reason: z.string().trim().min(1, 'A reason is required to revoke access.').max(500),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  try {
    const result = await revokeAccessAssignment({
      actorId: actor.id,
      assignmentId: v.data.assignmentId,
      reason: v.data.reason,
      correlationId: crypto.randomUUID(),
    });
    return c.json({ success: true, data: result });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return c.json({ success: false, message: err.message ?? 'Access assignment revoke failed.' },
      (err.status ?? 500) as 200);
  }
});

// POST /api/hr/employees/photo/decide — approve or reject a pending profile
// photo submitted via the self-service Change Profile Photo dialog. Approve
// promotes the pending image to live; reject discards it. Either way the
// pending columns are cleared so the drawer's banner disappears.
router.post('/employees/photo/decide', async c => {
  const actor = await requirePermission(c, 'hr.employees.photo_approve');
  const v = zv(c, z.object({ employeeId: z.string().min(1), approve: z.boolean(), reason: z.string().max(500).optional() }),
    (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const { data: row, error: fetchErr } = await sb.from('app_users')
    .select('profile_image_pending_url, profile_image_pending_path, profile_image_pending_thumb_url, profile_image_pending_thumb_path, profile_image_pending_version, profile_image_pending_submitted_at')
    .eq('id', v.data.employeeId).maybeSingle<{
      profile_image_pending_url: string | null; profile_image_pending_path: string | null;
      profile_image_pending_thumb_url: string | null; profile_image_pending_thumb_path: string | null;
      profile_image_pending_version: number | null; profile_image_pending_submitted_at: string | null;
    }>();
  if (fetchErr) return c.json({ success: false, message: fetchErr.message }, 500 as 200);
  if (!row?.profile_image_pending_submitted_at) return c.json({ success: false, message: 'No pending photo for this employee.' }, 400 as 200);

  const clearPending = {
    profile_image_pending_url: null, profile_image_pending_path: null,
    profile_image_pending_thumb_url: null, profile_image_pending_thumb_path: null,
    profile_image_pending_version: null, profile_image_pending_submitted_at: null,
  };

  const patch = v.data.approve ? {
    ...clearPending,
    profile_image_url:        row.profile_image_pending_url,
    profile_image_path:       row.profile_image_pending_path,
    profile_image_thumb_url:  row.profile_image_pending_thumb_url,
    profile_image_thumb_path: row.profile_image_pending_thumb_path,
    profile_image_version:    row.profile_image_pending_version,
    profile_image_updated_at: new Date().toISOString(),
    profile_image_removed_at: null,
    profile_image:            row.profile_image_pending_url,
    signed_url: null, signed_url_expires_at: null,
  } : clearPending;

  const { error } = await sb.from('app_users').update(patch).eq('id', v.data.employeeId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  await writeHrAudit({ employeeId: v.data.employeeId, submoduleKey: 'employees', recordId: v.data.employeeId, actorId: actor.id,
    action: v.data.approve ? 'hr.employee.photo_approved' : 'hr.employee.photo_rejected',
    previousState: { pendingVersion: row.profile_image_pending_version }, newState: { approved: v.data.approve, reason: v.data.reason ?? null } });
  await emitAppEvent({
    eventType: v.data.approve ? 'auth.profile_photo.approved' : 'auth.profile_photo.rejected',
    sourceModule: 'hr', sourceEntityType: 'app_user', sourceEntityId: v.data.employeeId, actorUserId: actor.id,
    severity: 'info', payload: { reason: v.data.reason ?? null },
  });

  return c.json({ success: true });
});

// POST /api/hr/employees/create — Production Employee Creation Wizard endpoint.
//
// BREAKING from the old contract:
//   • identity.password REMOVED — HR never sets passwords. account provisioning
//     is handled post-create via the three approved account modes.
//   • access.role REMOVED — replaced by access.accessProfileId (resolved server-side
//     to a system role from hr_access_profiles). Raw role exposure eliminated.
//   • access.permissionProfile / selfServiceProfile / requireMfa / onboardingRequirements
//     REMOVED — not yet backed by enforced governance. Accept-and-drop is a band-aid.
//   • statutory writes → hr_employee_statutory_profiles (canonical). Legacy table
//     hr_employee_statutory receives NO new writes from this path.
//   • onboarding preflight: if createOnboardingCase is requested, the package is
//     validated BEFORE the employee is created. A package that doesn't exist fails
//     the whole request (no silent skip, no post-create best-effort ignore).
const employeeCreateDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date in YYYY-MM-DD format.');

router.post('/employees/create', async c => {
  const actor = await requirePermission(c, 'hr.employees.create');
  const v = zv(c, z.object({
    requestKey: z.uuid(),
    identity: z.object({
      username:       zUsername,
      firstName:      z.string().trim().min(1).max(120),
      lastName:       z.string().trim().min(1).max(120),
      email:          z.email().max(160).optional().or(z.literal('')).optional(),
      personalEmail:  z.email().max(160).optional().or(z.literal('')).optional(),
      phone:          z.string().max(60).optional(),
      employeeNumber: z.string().max(40).optional(),
      dateOfBirth:    employeeCreateDate.optional().or(z.literal('')).optional(),
      nationality:    z.string().max(80).optional(),
      preferredName:  z.string().max(160).optional(),
      governmentId:   z.string().max(80).optional(),
    }),
    employment: z.object({
      employmentType:   z.enum(EMPLOYMENT_TYPES),
      startDate:        employeeCreateDate,
      position:         z.string().max(160).optional(),
      probationEndDate: employeeCreateDate.optional().or(z.literal('')).optional(),
      employeeGrade:    z.string().max(60).optional(),
      workSchedule:     z.string().max(60).optional(),
    }),
    assignment: z.object({
      departmentId:  z.string().max(100).nullable().optional(),
      siteId:        z.string().max(100).nullable().optional(),
      supervisorId:  z.string().nullable().optional(),
      effectiveDate: employeeCreateDate.optional().or(z.literal('')).optional(),
    }).optional(),
    access: z.object({
      accessProfileId: z.uuid(),
      accountMode:     z.literal('no_login'),
    }),
    recordStatus: z.enum(['draft', 'pending_onboarding', 'active', 'probation']).default('active'),
    statutory: z.object({
      nisNumber:              z.string().max(20).nullable().optional(),
      nisStatus:              z.enum(NIS_STATUSES).optional(),
      nisApplicable:          z.boolean().optional(),
      nisEffectiveDate:       employeeCreateDate.optional().or(z.literal('')).optional(),
      birFileNumber:          z.string().max(40).nullable().optional(),
      payeApplicable:         z.boolean().optional(),
      td1Received:            z.boolean().optional(),
      td1EffectiveYear:       z.number().int().min(2000).max(2100).nullable().optional(),
      hsApplicable:           z.boolean().optional(),
      hsExemptionReason:      z.string().max(200).nullable().optional(),
      hsEffectiveDate:        employeeCreateDate.optional().or(z.literal('')).optional(),
      hsVerificationRequired: z.boolean().optional(),
    }).optional(),
    onboarding: z.object({
      prepareOnboarding: z.boolean().optional(),
      packageKey:           z.string().max(100).optional(),
    }).optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const { identity, employment, assignment, access, statutory } = v.data;

  if (identity.dateOfBirth && identity.dateOfBirth >= todayISO()) {
    return c.json({ success: false, message: 'Date of birth must be before today.' }, 400 as 200);
  }
  if (employment.probationEndDate && employment.probationEndDate < employment.startDate) {
    return c.json({ success: false, message: 'Probation end date cannot be before the employment start date.' }, 400 as 200);
  }
  if (assignment?.effectiveDate && assignment.effectiveDate < employment.startDate) {
    return c.json({ success: false, message: 'Assignment effective date cannot be before the employment start date.' }, 400 as 200);
  }
  if (statutory?.nisStatus === 'registered' && !statutory.nisNumber?.trim()) {
    return c.json({ success: false, message: 'A NIS number is required when NIS status is Registered.' }, 400 as 200);
  }
  if (statutory?.nisStatus === 'not_applicable' && statutory.nisApplicable !== false) {
    return c.json({ success: false, message: 'NIS applicable must be No when NIS status is Not Applicable.' }, 400 as 200);
  }

  const fullName = [identity.firstName.trim(), identity.lastName.trim()].join(' ');
  const idempotencyKey = `hr.employee.create:${actor.id}:${v.data.requestKey}`;
  // Zod emits keys in schema order. Bind the request UUID to the validated
  // command so accidental key reuse cannot return another employee's receipt.
  const payloadHash = createHash('sha256').update(JSON.stringify(v.data)).digest('hex');
  const { reqId } = getReqContext();
  const { data: priorRun, error: priorRunError } = await sb.from('module_mutation_runs')
    .select('status, request_payload, result_payload')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle<{
      status: string;
      request_payload: Record<string, unknown> | null;
      result_payload: Record<string, unknown> | null;
    }>();
  if (priorRunError) {
    throw Object.assign(new Error(`Could not verify request idempotency: ${priorRunError.message}`), { status: 500 });
  }
  if (priorRun?.status === 'completed' && priorRun.result_payload) {
    if (priorRun.request_payload?.payloadHash !== payloadHash) {
      return c.json({ success: false, message: 'This request key was already used with different employee data.' }, 409 as 200);
    }
    return c.json({ success: true, data: {
      ...priorRun.result_payload,
      account_status: 'not_requested',
      onboarding_status: priorRun.result_payload.onboarding_case_id ? 'draft_prepared' : 'not_requested',
    } });
  }

  // ── Pre-flight: uniqueness checks ────────────────────────────────────────────
  const [dupUserRes, dupNumRes] = await Promise.all([
    sb.from('app_users').select('id').eq('username', identity.username).maybeSingle(),
    identity.employeeNumber?.trim()
      ? sb.from('app_users').select('id').eq('employee_number', identity.employeeNumber.trim().toUpperCase()).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (dupUserRes.error) throw Object.assign(new Error(`Could not validate username availability: ${dupUserRes.error.message}`), { status: 500 });
  if (dupNumRes.error) throw Object.assign(new Error(`Could not validate employee number availability: ${dupNumRes.error.message}`), { status: 500 });
  if (dupUserRes.data) return c.json({ success: false, message: `Username "${identity.username}" is already taken.` }, 400 as 200);
  if (dupNumRes.data) return c.json({ success: false, message: `Employee ID "${identity.employeeNumber!.trim().toUpperCase()}" is already in use.` }, 400 as 200);

  // ── Pre-flight: access profile resolution ────────────────────────────────────
  const { data: profile, error: profErr } = await sb.from('hr_access_profiles')
    .select('system_role, is_active, label')
    .eq('id', access.accessProfileId)
    .maybeSingle<{ system_role: string; is_active: boolean; label: string }>();
  if (profErr) throw Object.assign(new Error(`Could not resolve the access profile: ${profErr.message}`), { status: 500 });
  if (!profile) return c.json({ success: false, message: 'Access profile not found.' }, 400 as 200);
  if (!profile.is_active) return c.json({ success: false, message: `Access profile "${profile.label}" is inactive.` }, 400 as 200);

  // ── Pre-flight: onboarding package ──────────────────────────────────────────
  // Validated BEFORE the employee is created. If the package doesn't exist the
  // whole request is rejected — no "employee created, onboarding silently skipped".
  let resolvedPackageKey: string | null = null;
  if (v.data.onboarding?.prepareOnboarding) {
    const pkgKey = v.data.onboarding.packageKey?.trim();
    if (!pkgKey) return c.json({ success: false, message: 'Select an onboarding package before preparing onboarding.' }, 400 as 200);
    const { data: pkg, error: pkgErr } = await sb.from('hr_onboarding_packages')
      .select('package_key, package_name, status, worker_types')
      .eq('package_key', pkgKey)
      .maybeSingle<{ package_key: string; package_name: string; status: string; worker_types: unknown }>();
    if (pkgErr) throw Object.assign(new Error(`Could not validate the onboarding package: ${pkgErr.message}`), { status: 500 });
    if (!pkg) return c.json({ success: false, message: `Onboarding package "${pkgKey}" does not exist.` }, 400 as 200);
    if (pkg.status !== 'active') return c.json({ success: false, message: `Onboarding package "${pkg.package_name}" is not active.` }, 400 as 200);
    const eligibleTypes = Array.isArray(pkg.worker_types) ? pkg.worker_types.map(String) : [];
    if (eligibleTypes.length && !eligibleTypes.includes(employment.employmentType)) {
      return c.json({ success: false, message: `Onboarding package "${pkg.package_name}" does not support ${employment.employmentType} workers.` }, 400 as 200);
    }
    resolvedPackageKey = pkgKey;
  }

  // ── Provisioning ─────────────────────────────────────────────────────────────
  // provisionEmployee() writes app_users, hr_employee_assignments,
  // hr_employee_statutory_profiles, hr_employee_status_history, hr_audit_log with
  // compensating rollback. Auth account is NOT created here (createLogin: false).
  const createRes = await sb.rpc('hr_employee_create_tx', {
    p_actor_id: actor.id,
    p_identity: { ...identity, fullName },
    p_employment: {
      ...employment,
      contractorFlag: employment.employmentType === 'contractor',
    },
    p_assignment: assignment ?? {},
    p_access: { resolvedRole: profile.system_role },
    p_statutory: statutory ?? {},
    p_record_status: v.data.recordStatus,
    p_onboarding: {
      prepareOnboarding: v.data.onboarding?.prepareOnboarding === true,
      packageKey: resolvedPackageKey,
    },
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_request_id: reqId ?? null,
  });
  const createErr = createRes.error;
  if (createErr) {
    const duplicate = createErr.code === '23505';
    const requestConflict = createErr.code === '22023'
      && createErr.message.includes('already used with different');
    const message = duplicate
      ? (createErr.message.includes('employee_number')
          ? `Employee ID "${identity.employeeNumber?.trim().toUpperCase() ?? ''}" is already in use.`
          : `Username "${identity.username}" is already taken.`)
      : createErr.message;
    throw Object.assign(new Error(message), { status: requestConflict ? 409 : duplicate ? 400 : 500 });
  }

  const receipt = createRes.data as {
    employee_id: string;
    employee_no: string;
    status: 'draft' | 'pending_onboarding' | 'active' | 'probation';
    payroll_readiness: 'pending' | 'ready' | 'blocked';
    onboarding_case_id: string | null;
    onboarding_case_no: string | null;
    event_id: string;
  };

  // ── Account provisioning (invite_on_create) ───────────────────────────────────
  // Called AFTER the employee record is committed. Failure is SURFACED, not swallowed.
  // The employee record is valid and usable; the missing account can be provisioned later.
  // ── Onboarding case (post-create, surfaced on failure) ──────────────────────
  return c.json({ success: true, data: {
    ...receipt,
    account_status: 'not_requested',
    onboarding_status: receipt.onboarding_case_id ? 'draft_prepared' : 'not_requested',
  } });
});

// POST /api/hr/employees/dashboard-stats — the Employee Master workspace contract.
// Every number is computed from authorised live data. Realtime may invalidate this query,
// but never supplies or authorises any of these records.
router.post('/employees/dashboard-stats', async c => {
  await requirePermission(c, 'hr.employees.view');
  const v = zv(c, z.object({
    siteId: z.string().optional(),
    departmentId: z.string().optional(),
    // Drives the lifecycle buckets only (see lifecycleWindows). Defaults to the historical
    // behaviour so existing callers are unaffected.
    granularity: z.enum(['day', 'week', 'month']).default('month'),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const today = todayISO();

  const [workforceResult, statutoryResult, openChangesResult, lifecycleChangesResult, departmentsResult, sitesResult] = await Promise.all([
    sb.from('app_users').select('id, employment_status, contractor_flag, supervisor_id, department_id, site_id, start_date, end_date, updated_at').neq('role', 'superadmin').neq('role', 'admin').not('employee_number', 'is', null),
    sb.from('hr_employee_statutory_profiles').select('employee_id, payroll_ready_status').eq('jurisdiction', 'TT'),
    sb.from('hr_employee_change_requests').select('employee_id, change_type, status, requested_at').in('status', ['submitted', 'in_review', 'returned']),
    sb.from('hr_employee_change_requests').select('employee_id, change_type, requested_value, applied_at').eq('status', 'applied').not('applied_at', 'is', null),
    sb.from('departments').select('id, name'),
    sb.from('project_sites').select('id, name'),
  ]);
  for (const [label, result] of [
    ['workforce', workforceResult], ['statutory readiness', statutoryResult],
    ['open change requests', openChangesResult], ['lifecycle changes', lifecycleChangesResult],
    ['departments', departmentsResult], ['sites', sitesResult],
  ] as const) {
    if (result.error) throw new Error(`Employee Master ${label} read failed: ${result.error.message}`);
  }
  const workforceRaw = workforceResult.data;
  const statRows = statutoryResult.data;
  const changeRows = openChangesResult.data;
  let workforce = (workforceRaw ?? []) as { id: string; employment_status: string | null; contractor_flag: boolean | null; supervisor_id: string | null; department_id: string | null; site_id: string | null; start_date: string | null; end_date: string | null; updated_at: string | null }[];
  if (v.data.siteId)       workforce = workforce.filter(w => w.site_id === v.data.siteId);
  if (v.data.departmentId) workforce = workforce.filter(w => w.department_id === v.data.departmentId);
  const active = workforce.filter(w => (w.employment_status ?? 'active') === 'active');
  const activeIds = active.map(w => w.id);

  // Active workforce + 6-month headcount trend (by hire / termination dates).
  const now = new Date();
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthWindows = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 0); // last day of that month
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = d.toISOString().slice(0, 10);
    return { period: MONTHS[d.getMonth()] ?? '', start, end: monthEnd };
  });

  // Lifecycle buckets honour the requested granularity so the Workforce Activity chart's
  // Day / Week / Month controls read REAL data rather than re-slicing one monthly series.
  // The headcount `trend` above stays monthly on purpose — it is a different question
  // ("how did headcount move over the year"), and a 14-day headcount line says nothing.
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const DAY_BUCKETS = 14, WEEK_BUCKETS = 8;
  const lifecycleWindows = ((): { period: string; start: string; end: string }[] => {
    if (v.data.granularity === 'day') {
      return Array.from({ length: DAY_BUCKETS }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAY_BUCKETS - 1 - i));
        return { period: `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`, start: iso(d), end: iso(d) };
      });
    }
    if (v.data.granularity === 'week') {
      return Array.from({ length: WEEK_BUCKETS }, (_, i) => {
        // Week ENDS on the current weekday, so the last bucket always includes today.
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (WEEK_BUCKETS - 1 - i) * 7);
        const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
        return { period: `${start.getDate()} ${MONTHS[start.getMonth()] ?? ''}`, start: iso(start), end: iso(end) };
      });
    }
    return monthWindows;
  })();
  const trend = monthWindows.map(month => {
    const monthEnd = month.end;
    const count = workforce.filter(w => (w.start_date ?? '') <= monthEnd && (!w.end_date || w.end_date > monthEnd)).length;
    return { period: month.period, count };
  });

  // Statutory readiness (active workers only).
  const activeSet = new Set(activeIds);
  const activeStat = ((statRows ?? []) as { employee_id: string; payroll_ready_status: string }[]).filter(s => activeSet.has(s.employee_id));
  const payrollReady   = activeStat.filter(s => s.payroll_ready_status === 'ready').length;
  const payrollBlocked = activeStat.filter(s => s.payroll_ready_status === 'blocked').length;

  // Training rollup over active workers.
  const certByWorker = new Map<string, { status: string; expires_at: string | null }[]>();
  if (activeIds.length) {
    const { data: certs, error: certError } = await sb.from('hse_worker_certificates').select('worker_id, status, expires_at').in('worker_id', activeIds);
    if (certError) throw new Error(`Employee Master training read failed: ${certError.message}`);
    for (const cr of certs as { worker_id: string; status: string; expires_at: string | null }[]) {
      const list = certByWorker.get(cr.worker_id) ?? []; list.push({ status: cr.status, expires_at: cr.expires_at }); certByWorker.set(cr.worker_id, list);
    }
  }
  const trainingCurrent = activeIds.filter(id => rollupTrainingStatus(certByWorker.get(id) ?? [], today) === 'current').length;
  const trainingExpired = activeIds.filter(id => rollupTrainingStatus(certByWorker.get(id) ?? [], today) === 'expired').length;

  // HR work queue (open change-requests).
  const workforceSet = new Set(workforce.map(w => w.id));
  const chg = ((changeRows ?? []) as { employee_id: string; change_type: string; status: string; requested_at: string | null }[])
    .filter(r => workforceSet.has(r.employee_id));
  const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const mixMap = new Map<string, number>();
  for (const r of chg) mixMap.set(r.change_type, (mixMap.get(r.change_type) ?? 0) + 1);
  const urgent = chg.filter(r => r.status === 'in_review' || (r.requested_at ?? '') < threeDaysAgo).length;
  const oldestDays = chg.reduce((max, r) => {
    if (!r.requested_at) return max;
    return Math.max(max, Math.floor((now.getTime() - new Date(r.requested_at).getTime()) / 86_400_000));
  }, 0);

  // Distribution labels are hydrated server-side; widgets never receive raw lookup ids.
  const departmentNames = new Map(((departmentsResult.data ?? []) as { id: string; name: string | null }[]).map(row => [row.id, row.name ?? 'Unnamed department']));
  const siteNames = new Map(((sitesResult.data ?? []) as { id: string; name: string | null }[]).map(row => [row.id, row.name ?? 'Unnamed site']));
  const distribution = (key: 'department_id' | 'site_id', names: Map<string, string>) => {
    const counts = new Map<string, number>();
    for (const worker of active) {
      const id = worker[key] ?? '__unassigned__';
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => ({
      id,
      label: id === '__unassigned__' ? 'Unassigned' : (names.get(id) ?? 'Unknown'),
      count,
      percent: active.length ? Math.round((count / active.length) * 100) : 0,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  // Lifecycle movement is based on effective workforce dates and applied maker-checker changes.
  const appliedChanges = ((lifecycleChangesResult.data ?? []) as {
    employee_id: string; change_type: string; requested_value: Record<string, unknown> | null; applied_at: string | null;
  }[]).filter(row => workforceSet.has(row.employee_id));
  const lifecyclePeriods = lifecycleWindows.map(month => {
    const inMonth = (value: string | null): boolean => !!value && value.slice(0, 10) >= month.start && value.slice(0, 10) <= month.end;
    const applied = appliedChanges.filter(row => inMonth(row.applied_at));
    const transfers = applied.filter(row => row.change_type === 'department_transfer' || row.change_type === 'site_transfer' ||
      (row.change_type === 'transfer_promotion' && [row.requested_value?.departmentId, row.requested_value?.siteId, row.requested_value?.supervisorId].some(Boolean))).length;
    const promotions = applied.filter(row => row.change_type === 'role_change' ||
      (row.change_type === 'transfer_promotion' && [row.requested_value?.positionId, row.requested_value?.role, row.requested_value?.monthlySalary, row.requested_value?.hourlyRate].some(Boolean))).length;
    return {
      period: month.period,
      hires: workforce.filter(worker => inMonth(worker.start_date)).length,
      exits: workforce.filter(worker => inMonth(worker.end_date)).length,
      transfers,
      promotions,
      records_updated: workforce.filter(worker => inMonth(worker.updated_at)).length,
    };
  });
  const lifecycleTotals = lifecyclePeriods.reduce((totals, period) => ({
    hires: totals.hires + period.hires,
    exits: totals.exits + period.exits,
    transfers: totals.transfers + period.transfers,
    promotions: totals.promotions + period.promotions,
    records_updated: totals.records_updated + period.records_updated,
  }), { hires: 0, exits: 0, transfers: 0, promotions: 0, records_updated: 0 });

  // Exceptions.
  const exceptionItems = [
    { type: 'Supervisor', count: active.filter(w => !w.supervisor_id).length },
    { type: 'Department', count: active.filter(w => !w.department_id).length },
    { type: 'Site',       count: active.filter(w => !w.site_id).length },
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
    hr_work_queue: { total: chg.length, urgent, oldest_days: oldestDays, mix: [...mixMap.entries()].map(([type, count]) => ({ type, count })) },
    readiness: {
      percent: active.length ? Math.round(((active.filter(w => !!w.supervisor_id && !!w.department_id && !!w.site_id).length + payrollReady + trainingCurrent) / (active.length * 3)) * 100) : 0,
      assignment_complete: active.filter(w => !!w.supervisor_id && !!w.department_id && !!w.site_id).length,
      payroll_ready: payrollReady, training_current: trainingCurrent,
      blocked: new Set([
        ...activeStat.filter(s => s.payroll_ready_status === 'blocked').map(s => s.employee_id),
        ...activeIds.filter(id => rollupTrainingStatus(certByWorker.get(id) ?? [], today) === 'expired'),
      ]).size,
    },
    exceptions: { total: exceptionItems.reduce((s, x) => s + x.count, 0), items: exceptionItems },
    distribution: { departments: distribution('department_id', departmentNames), sites: distribution('site_id', siteNames) },
    lifecycle: { periods: lifecyclePeriods, totals: lifecycleTotals },
  } } });
});

// POST /api/hr/employees/workflow-summary — open engine workflows about this employee (v36 §5.2).
// Reads the central engine (workflow_instances) — the single source of truth for workflows.
router.post('/employees/workflow-summary', async c => {
  await requirePermission(c, 'hr.employees.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const { data: instances, error: instancesError } = await sb.from('workflow_instances')
    .select('id, workflow_no, workflow_type, status, current_step_key, priority')
    .eq('source_record_id', v.data.employeeId).in('status', ['in_progress', 'returned'])
    .order('created_at', { ascending: false });
  if (instancesError) return c.json({ success: false, message: instancesError.message }, 500 as 200);
  const rows = instances as { id: string; workflow_no: string | null; workflow_type: string; status: string; current_step_key: string | null; priority: string | null }[];

  // Current open task per workflow → step name + due date.
  const taskByWf = new Map<string, { step_name: string | null; due_at: string | null }>();
  if (rows.length) {
    const { data: tasks, error: tasksError } = await sb.from('workflow_tasks')
      .select('workflow_id, step_name, due_at, status').in('workflow_id', rows.map(r => r.id)).eq('status', 'pending')
      .order('due_at', { ascending: true });
    if (tasksError) return c.json({ success: false, message: tasksError.message }, 500 as 200);
    for (const t of tasks as { workflow_id: string; step_name: string | null; due_at: string | null }[]) {
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
// Reads from hr_employee_statutory_profiles (canonical) and maps nis_reg_status
// back to nis_status in the response so the existing FE contract is unchanged.
router.post('/employees/statutory/get', async c => {
  await requirePermission(c, 'hr.employees.statutory.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hr_employee_statutory_profiles')
    .select('*').eq('employee_id', v.data.employeeId).eq('jurisdiction', 'TT')
    .maybeSingle<Record<string, unknown>>();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const mapped = data ? profileRowToStatutoryRow(data) : null;
  const readiness = mapped ? computePayrollReadiness(mapped) : { status: 'pending' as const, blockers: [] as string[], financeEligible: false };
  return c.json({ success: true, data: { statutory: mapped ?? null, readiness } });
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
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const { data: existingRaw, error: fetchErr } = await sb.from('hr_employee_statutory_profiles')
    .select('*').eq('employee_id', v.data.employeeId).eq('jurisdiction', 'TT')
    .maybeSingle<Record<string, unknown>>();
  if (fetchErr) return c.json({ success: false, message: fetchErr.message }, 500 as 200);
  const existing = existingRaw ? profileRowToStatutoryRow(existingRaw) : null;
  // statutoryProfilePatch maps nisStatus → nis_reg_status for the profiles table.
  const patch = statutoryProfilePatch(v.data);
  const wasReady = existingRaw?.payroll_ready_status === 'ready';
  // Build a merged StatutoryRow (using nis_status = nis_reg_status) for readiness computation.
  // Build a merged StatutoryRow (using nis_reg_status mapped to nis_status) for readiness.
  // existing already has nis_status set by profileRowToStatutoryRow(); spread it first,
  // then override with the fresh patch (which also uses nis_status via the legacy path).
  const mergedForReadiness = statutoryWithDefaults({
    ...(existing ?? {}),
    ...statutoryPatch(v.data),   // legacy patch maps nisStatus → nis_status
  });
  const readiness = computePayrollReadiness(mergedForReadiness);

  const upd: Record<string, unknown> = {
    ...patch,
    payroll_ready_status:     readiness.status,
    missing_blockers:         readiness.blockers,  // native array for jsonb; no stringify
    finance_handoff_eligible: readiness.financeEligible,
    updated_by: actor.id,
  };
  if (v.data.markVerified) { upd.verified_by = actor.id; upd.verified_at = new Date().toISOString(); }

  if (existingRaw) {
    const { error } = await sb.from('hr_employee_statutory_profiles').update(upd)
      .eq('employee_id', v.data.employeeId).eq('jurisdiction', 'TT');
    if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  } else {
    const { error } = await sb.from('hr_employee_statutory_profiles').insert({
      employee_id: v.data.employeeId, jurisdiction: 'TT', currency: 'TTD',
      nis_status: 'pending_verification', ...upd,
    });
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
    work:       z.object({
      email: z.string().max(160).nullable().optional(),
      phone: z.string().max(60).nullable().optional(),
      mobilePhone: z.string().max(60).nullable().optional(),
    }).optional(),
    personal:   z.object({ personalEmail: z.string().max(160).nullable().optional() }).optional(),
    emergency:  z.object({
      name:         z.string().max(160).nullable().optional(),
      phone:        z.string().max(60).nullable().optional(),
      relationship: z.string().max(80).nullable().optional(),
    }).optional(),
    reason: z.string().max(500).optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const patch: Record<string, unknown> = {};
  if (v.data.work?.email             !== undefined) patch.email                          = v.data.work.email;
  if (v.data.work?.phone             !== undefined) patch.phone                          = v.data.work.phone;
  if (v.data.work?.mobilePhone       !== undefined) patch.mobile_phone                   = v.data.work.mobilePhone;
  if (v.data.personal?.personalEmail !== undefined) patch.personal_email                = v.data.personal.personalEmail;
  if (v.data.emergency?.name         !== undefined) patch.emergency_contact_name         = v.data.emergency.name;
  if (v.data.emergency?.phone        !== undefined) patch.emergency_contact_phone        = v.data.emergency.phone;
  if (v.data.emergency?.relationship !== undefined) patch.emergency_contact_relationship = v.data.emergency.relationship;
  if (!Object.keys(patch).length) return c.json({ success: false, message: 'No contact fields provided.' }, 400 as 200);

  const touchesRestricted = [v.data.personal, v.data.emergency].some(Boolean);

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

  patch.updated_at = new Date().toISOString();
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
    mobilePhone:    z.string().max(60).nullable().optional(),
    position:       z.string().max(160).nullable().optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    startDate:      z.string().nullable().optional(),
    endDate:        z.string().nullable().optional(),
    contractorFlag: z.boolean().optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const prev = await loadEmployee(v.data.employeeId);
  if (!prev) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.firstName      !== undefined) patch.first_name      = v.data.firstName;
  if (v.data.lastName       !== undefined) patch.last_name       = v.data.lastName;
  if (v.data.displayName    !== undefined) patch.display_name    = v.data.displayName;
  if (v.data.personalEmail  !== undefined) patch.personal_email  = v.data.personalEmail;
  if (v.data.phone          !== undefined) patch.phone           = v.data.phone;
  if (v.data.mobilePhone    !== undefined) patch.mobile_phone    = v.data.mobilePhone;
  if (v.data.position       !== undefined) patch.position        = v.data.position;
  if (v.data.employmentType !== undefined) patch.employment_type = v.data.employmentType;
  if (v.data.startDate      !== undefined) patch.start_date      = v.data.startDate;
  if (v.data.endDate        !== undefined) patch.end_date        = v.data.endDate;
  if (v.data.contractorFlag !== undefined) patch.contractor_flag = v.data.contractorFlag;

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
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);
  const prevHr = await sb.from('hr_employee_status_history').select('new_status').eq('employee_id', emp.id)
    .order('changed_at', { ascending: false }).limit(1).maybeSingle<{ new_status: string }>();
  const previousStatus = prevHr.data?.new_status ?? emp.employment_status ?? 'active';

  await sb.from('hr_employee_status_history').insert({
    employee_id: emp.id, previous_status: previousStatus, new_status: v.data.newStatus,
    reason: v.data.reason ?? null, effective_date: v.data.effectiveDate ?? todayISO(), changed_by: actor.id,
  });

  // Sync the coarse auth status so blocking states stop login (hr.termination_blocks_login).
  const authStatus = BLOCKING_STATUSES.has(v.data.newStatus) ? 'inactive' : 'active';
  const { error: statusUpdateError } = await sb.from('app_users').update({
    status: authStatus,
    employment_status: v.data.newStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', emp.id);
  if (statusUpdateError) throw Object.assign(new Error(statusUpdateError.message), { status: 500 });

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
    positionId:   z.uuid().nullable().optional(),
    reason:       z.string().max(500).optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.departmentId !== undefined) patch.department_id = v.data.departmentId;
  if (v.data.siteId       !== undefined) patch.site_id       = v.data.siteId;
  const { error } = await sb.from('app_users').update(patch).eq('id', emp.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  // Close current assignment, open a new one.
  await sb.from('hr_employee_assignments').update({ is_current: false, effective_to: todayISO() })
    .eq('employee_id', emp.id).eq('is_current', true);
  await sb.from('hr_employee_assignments').insert({
    employee_id: emp.id, position_id: v.data.positionId ?? null,
    department_id: v.data.departmentId ?? emp.department_id, site_id: v.data.siteId ?? emp.site_id,
    supervisor_id: emp.supervisor_id, assignment_type: 'primary', effective_from: todayISO(), is_current: true, created_by: actor.id,
  });

  await writeHrAudit({ employeeId: emp.id, submoduleKey: 'employees', recordId: emp.id, actorId: actor.id,
    action: 'hr.employee.department_transferred', previousState: { department_id: emp.department_id, site_id: emp.site_id }, newState: patch, reason: v.data.reason ?? null });
  void emitAppEvent({ eventType: 'hr.employee.department_transferred', sourceModule: 'hr', sourceEntityType: 'employee',
    sourceEntityId: emp.id, actorUserId: actor.id, severity: 'info', payload: patch });

  return c.json({ success: true, data: await loadEmployee(emp.id) });
});

// POST /api/hr/employees/supervisor-change
router.post('/employees/supervisor-change', async c => {
  const actor = await requirePermission(c, 'hr.employees.supervisor_change');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), supervisorId: z.string().nullable(), reason: z.string().max(500).optional(),
  }), (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const today = todayISO();
  const { data: certs, error: certsError } = await sb.from('hse_worker_certificates')
    .select('status, expires_at, course_name').eq('worker_id', v.data.employeeId);
  if (certsError) return c.json({ success: false, message: certsError.message }, 500 as 200);
  const list = certs as { status: string; expires_at: string | null; course_name: string }[];
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
    (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hr_audit_log').select('*').eq('employee_id', v.data.employeeId)
    .order('created_at', { ascending: false }).limit(v.data.limit ?? 100);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const rows = data as { actor_id: string | null; [k: string]: unknown }[];
  // Resolve actor display names server-side (an actor may be any app_user, not just
  // someone on the employee page) — the audit row carries the name, never a raw id.
  const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter((x): x is string => !!x)));
  const { data: actors, error: actorsError } = actorIds.length
    ? await sb.from('app_users').select('id, full_name').in('id', actorIds)
    : { data: [] as { id: string; full_name: string | null }[], error: null };
  if (actorsError) return c.json({ success: false, message: actorsError.message }, 500 as 200);
  const actorMap = Object.fromEntries((actors as { id: string; full_name: string | null }[]).map(a => [a.id, a.full_name]));
  return c.json({ success: true, data: rows.map(r => ({ ...r, actorName: r.actor_id ? actorMap[r.actor_id] ?? null : null })) });
});

// ── Organization Structure (Phase A) ────────────────────────────────────────────
// Org-unit tree + positions + cost centres. Reads via lib/hr/organizationQueries;
// writes (event + audit + guards + concurrency) via lib/hr/organizationMutations.

const orgBody = (c: Context<{ Variables: HonoVariables }>) => (c.get('body')).args ?? {};
function orgErr(c: Context<{ Variables: HonoVariables }>, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200);
}
const ORG_UNIT_TYPES = ['company', 'division', 'department', 'team', 'crew', 'site_department'] as const;
// Optional fields on every gated mutation: a reason + an effective date (Phase B).
const GATED = { reason: z.string().max(500).nullable().optional(), effectiveFrom: z.string().nullable().optional(), idempotencyKey: z.string().min(1).max(200).optional() };

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
    costCenterId: z.uuid().nullable().optional(), description: z.string().max(500).nullable().optional(),
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
    managerId: z.string().nullable().optional(), costCenterId: z.uuid().nullable().optional(),
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
  const v = zv(c, z.object({ positionId: z.uuid() }), orgBody(c));
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
    defaultSupervisorId: z.string().nullable().optional(), reportsToPositionId: z.uuid().nullable().optional(),
    isSafetyCritical: z.boolean().optional(), headcountBudget: z.number().int().nullable().optional(),
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createPosition(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/positions/update', async c => {
  const actor = await requirePermission(c, 'hr.positions.manage');
  const v = zv(c, z.object({
    positionId: z.uuid(), expectedUpdatedAt: z.string().nullable().optional(),
    title: z.string().max(160).optional(), grade: z.string().max(60).nullable().optional(),
    departmentId: z.string().nullable().optional(), siteId: z.string().nullable().optional(),
    defaultSupervisorId: z.string().nullable().optional(), reportsToPositionId: z.uuid().nullable().optional(),
    isSafetyCritical: z.boolean().optional(), headcountBudget: z.number().int().nullable().optional(), isActive: z.boolean().optional(),
    ...GATED,
  }), orgBody(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await updatePosition(actor, v.data) }); }
  catch (e) { return orgErr(c, e); }
});

router.post('/positions/retire', async c => {
  const actor = await requirePermission(c, 'hr.positions.manage');
  const v = zv(c, z.object({ positionId: z.uuid(), ...GATED }), orgBody(c));
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
    costCenterId: z.uuid(), expectedUpdatedAt: z.string().nullable().optional(),
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
  const v = zv(c, z.object({ costCenterId: z.uuid(), ...GATED }), orgBody(c));
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
  const v = zv(c, z.object({ changeRequestId: z.uuid() }), orgBody(c));
  if (!v.ok) return v.response;
  try {
    const cr = await getOrgChangeRequest(v.data.changeRequestId);
    if (!cr) return c.json({ success: false, message: 'Change request not found.' }, 404 as 200);
    return c.json({ success: true, data: cr });
  } catch (e) { return orgErr(c, e); }
});

router.post('/organization/change/cancel', async c => {
  const actor = await requirePermission(c, 'hr.organization.manage');
  const v = zv(c, z.object({ changeRequestId: z.uuid(), reason: z.string().max(500).nullable().optional() }), orgBody(c));
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
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('employment_status', 'active').neq('role', 'superadmin'),
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
    case 'site_transfer':          return { site_id: emp.site_id };
    case 'supervisor_change':      return { supervisor_id: emp.supervisor_id };
    case 'role_change':            return { role: emp.role };
    case 'employment_type_change': return { employment_type: emp.employment_type };
    case 'contact_update':         return Object.fromEntries(CONTACT_COLS.map(k => [k, emp[k] ?? null]));
    case 'transfer_promotion':     return {
      department_id:  emp.department_id,
      site_id:        emp.site_id ?? null,
      position_id:    emp.position_id ?? null,
      supervisor_id:  emp.supervisor_id,
      role:           emp.role,
      monthly_salary: emp.monthly_salary ?? null,
      hourly_rate:    emp.hourly_rate ?? null,
      pay_basis:      emp.pay_basis ?? null,
    };
  }
}
/**
 * Create a maker-checker change request. ATOMIC (finding #3, Shape B): when an
 * active hr_change_approval binding exists for the change type, the envelope INSERT +
 * workflow start + workflow_id link + app_event + hr_audit_log all commit in ONE
 * transaction via workflow_create_and_start_tx (hr_employee_change_requests branch),
 * with content-hash idempotency. No binding → plain runModuleMutation create-only
 * path (submitted status, no workflow started). Shared by /employees/change-request
 * and /employees/contact/update (request mode) and /transfers/request.
 */
async function createChangeRequest(actor: { id: string }, p: {
  employeeId: string; changeType: ChangeType;
  previousValue: Record<string, unknown>; requestedValue: Record<string, unknown>; reason?: string | null;
}): Promise<{ id: string; changeNo: string }> {
  // Content-derived so an accidental double-submit of the SAME change dedupes.
  const idempotencyKey = `hr.change_request:${actor.id}:${p.employeeId}:${p.changeType}:${JSON.stringify(p.requestedValue)}`;

  const binding = await selectWorkflowBinding(sb, {
    moduleKey: 'hr_employee_master', workflowType: 'hr_change_approval',
    triggerEvent: `hr.employee.${p.changeType}`,
    sourceRecordId: '', requestedBy: actor.id, recordData: {},
  });

  if (binding) {
    // ATOMIC path: INSERT + workflow start + link + event + audit in one commit.
    const startRes = await sb.rpc('workflow_create_and_start_tx', {
      p_source_table: 'hr_employee_change_requests',
      p_actor_id:     actor.id,
      p_binding_id:   binding.id,
      p_request_key:  idempotencyKey,
      p_business: {
        employeeId:     p.employeeId,
        changeType:     p.changeType,
        previousValue:  p.previousValue,
        requestedValue: p.requestedValue,
        reason:         p.reason ?? null,
      },
    });
    if (startRes.error) throw rpcHttpError(startRes.error);
    const rpc = (startRes.data ?? {}) as { recordId?: string; ref?: string; workflowId?: string };
    // First workflow step is assigned to hr_manager — notify them post-commit.
    void notifyUsersByRole('hr_manager', {
      type:            'hr.employee.change_requested',
      title:           `Change request ${rpc.ref ?? ''} awaiting your approval`.trim(),
      body:            `A ${p.changeType} change request for employee has been submitted for approval.`,
      module:          'hr',
      severity:        'warning',
      sourceType:      'employee_change',
      sourceId:        rpc.recordId ?? '',
      actionRequired:  true,
      dedupeKey:       `hr.employee.change_requested.${rpc.recordId}`,
    });
    return { id: rpc.recordId ?? '', changeNo: rpc.ref ?? '' };
  }

  // No approval binding → create-only (record stays 'submitted', no workflow).
  const result = await runModuleMutation<{ id: string; changeNo: string }>({
    context: { actorUserId: actor.id },
    options: {
      module: 'hr', operation: 'create', entityType: 'employee_change',
      idempotencyKey,
      eventType: 'hr.employee.change_requested', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.changeNo }),
      buildEventPayload: () => ({ employeeId: p.employeeId, changeType: p.changeType }),
    },
    writeRecord: async () => {
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
// NOTE: transfer_promotion is intentionally excluded from this route — it bundles
// role + salary and must only be submitted through /transfers/request
// (gated by hr.transfers.request, not the lower hr.view gate). See brief §3.5.
const GENERIC_CHANGE_TYPES = CHANGE_TYPES.filter(t => t !== 'transfer_promotion') as readonly Exclude<ChangeType, 'transfer_promotion'>[];
router.post('/employees/change-request', async c => {
  const actor = await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), changeType: z.enum(GENERIC_CHANGE_TYPES as unknown as [string, ...string[]]),
    requestedValue: z.record(z.string(), z.unknown()), reason: z.string().max(500).optional(),
  }), (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ status: z.string().optional(), employeeId: z.string().optional() }), (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ requestId: z.uuid(), decision: z.enum(['approve','reject','return']), comment: z.string().max(500).optional() }),
    (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ requestId: z.uuid() }), (c.get('body')).args ?? {});
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
    positionId:    z.uuid().nullable().optional(),
    supervisorId:  z.string().nullable().optional(),
    role:          z.string().nullable().optional(),
    monthlySalary: z.number().positive().nullable().optional(),
    hourlyRate:    z.number().positive().nullable().optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveDate must be YYYY-MM-DD'),
    reason:        z.string().max(500).optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  // At least one changing field (excluding effectiveDate/reason) is required.
  const { employeeId, effectiveDate, reason, ...changedFields } = v.data;
  const hasChange = Object.values(changedFields).some(val => val !== null);
  if (!hasChange) return c.json({ success: false, message: 'At least one field to change is required (department, site, position, supervisor, role, or salary).' }, 400 as 200);

  const emp = await loadEmployee(employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const requestedValue: Record<string, unknown> = { effectiveDate, reason: reason ?? null };
  if (v.data.departmentId !== undefined)  requestedValue.departmentId  = v.data.departmentId;
  if (v.data.siteId       !== undefined)  requestedValue.siteId        = v.data.siteId;
  if (v.data.positionId   !== undefined)  requestedValue.positionId    = v.data.positionId;
  if (v.data.supervisorId !== undefined)  requestedValue.supervisorId  = v.data.supervisorId;
  if (v.data.role         !== undefined)  requestedValue.role          = v.data.role;
  if (v.data.monthlySalary !== undefined) requestedValue.monthlySalary = v.data.monthlySalary;
  if (v.data.hourlyRate    !== undefined) requestedValue.hourlyRate    = v.data.hourlyRate;

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
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  let q = sb.from('hr_employee_change_requests')
    .select('id, change_no, employee_id, requested_value, previous_value, status, requested_by, requested_at, decided_at, applied_at, metadata, workflow_id')
    .eq('change_type', 'transfer_promotion')
    .order('requested_at', { ascending: false })
    .limit(v.data.limit ?? 200);
  if (v.data.status)     q = q.eq('status', v.data.status);
  if (v.data.employeeId) q = q.eq('employee_id', v.data.employeeId);
  const { data } = await q;
  const rows = (data ?? []) as Record<string, unknown>[];

  // Enrich with employee and requester names from app_users.
  const allIds = new Set<string>();
  for (const r of rows) {
    if (r.employee_id)  allIds.add(r.employee_id  as string);
    if (r.requested_by) allIds.add(r.requested_by as string);
  }
  const { data: users } = await sb.from('app_users').select('id, full_name').in('id', [...allIds]);
  const nameMap = new Map((users ?? []).map((u: { id: string; full_name: string | null }) => [u.id, u.full_name]));

  const enriched = rows.map(r => ({
    id:            r.id,
    changeNo:      r.change_no,
    employeeId:    r.employee_id,
    employeeName:  nameMap.get(r.employee_id as string) ?? null,
    requestedBy:   r.requested_by,
    requestedByName: nameMap.get(r.requested_by as string) ?? null,
    status:        r.status,
    requestedValue: r.requested_value,
    previousValue:  r.previous_value,
    effectiveDate: (r.requested_value as Record<string, unknown> | null)?.effectiveDate ?? null,
    reason:        (r.metadata as Record<string, unknown> | null)?.reason ?? null,
    requestedAt:   r.requested_at,
    decidedAt:     r.decided_at,
    appliedAt:     r.applied_at,
    workflowId:    r.workflow_id,
  }));

  return c.json({ success: true, data: enriched });
});

// ── Employee Documents (private bucket; verify/reject/archive; audited download) ─

// POST /api/hr/employees/documents/list
router.post('/employees/documents/list', async c => {
  const user = await requirePermission(c, 'hr.employee_documents.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('hr_employee_documents').select('*').eq('employee_id', v.data.employeeId)
    .neq('status', 'archived').order('uploaded_at', { ascending: false });
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const rawRows = data as { confidentiality: string }[];
  // Restricted tiers require the sensitive-view permission (via filterVisibleDocs).
  const canSeeSensitive = await userCan(user, 'hr.employee_documents.sensitive_view');
  const rows = filterVisibleDocs(rawRows, canSeeSensitive);
  return c.json({ success: true, data: rows });
});

// POST /api/hr/employees/documents/upload-url
router.post('/employees/documents/upload-url', async c => {
  await requirePermission(c, 'hr.employee_documents.upload');
  const v = zv(c, z.object({ fileName: z.string().min(1), mimeType: z.string().min(1) }), (c.get('body')).args ?? {});
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
    // Bucket file_size_limit (migration 20260804000000) is authoritative; this is a friendly early reject.
    fileSize: z.number().int().max(HR_DOC_MAX_BYTES, `File exceeds the ${Math.round(HR_DOC_MAX_BYTES / 1048576)} MB limit.`).nullable().optional(),
    confidentiality: z.enum(['internal', 'confidential', 'restricted_hr', 'legal', 'medical']).default('internal'),
    expiryDate: z.string().nullable().optional(),
  }), (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ documentId: z.uuid(), decision: z.enum(['approve', 'reject']), reason: z.string().max(500).optional() }),
    (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ documentId: z.uuid() }), (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ documentId: z.uuid() }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  const { data: doc } = await sb.from('hr_employee_documents').select('employee_id, file_path, confidentiality')
    .eq('id', v.data.documentId).maybeSingle<{ employee_id: string; file_path: string; confidentiality: string }>();
  if (!doc) return c.json({ success: false, message: 'Document not found.' }, 404 as 200);
  if (RESTRICTED_TIERS.has(doc.confidentiality) && !(await userCan(actor, 'hr.employee_documents.sensitive_view'))) {
    return c.json({ success: false, message: 'You do not have permission to access this restricted document.' }, 403 as 200);
  }
  let url: string;
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
  }), (c.get('body')).args ?? {});
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
    (c.get('body')).args ?? {});
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
  }), (c.get('body')).args ?? {});
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
    (c.get('body')).args ?? {});
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
  }), (c.get('body')).args ?? {});
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
    requirementId: z.uuid(), label: z.string().min(1).max(200).optional(),
    requiresExpiry: z.boolean().optional(), reminderDays: z.array(z.number().int()).optional(),
    minConfidentiality: z.enum(['internal','confidential','restricted_hr','legal','medical']).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }), (c.get('body')).args ?? {});
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
  const v = zv(c, z.object({ requirementId: z.uuid() }),
    (c.get('body')).args ?? {});
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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return c.json({ success: false, message: 'Service-role authentication required.' }, 403 as 200);
  }

  const v = zv(c, z.object({ windows: z.array(z.number().int()).optional() }),
    (c.get('body')).args ?? {});
  if (!v.ok) return v.response;

  // Read reminder windows from settings (fall back to [30,7,0]).
  let windows = v.data.windows;
  if (!windows) {
    const raw = await resolveSettingValue(sb, 'hr_documents.expiry_reminder_days', { moduleKey: 'hr_documents' }, '30,7,0');
    windows = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
  }
  if (!windows.length) windows = [30, 7, 0];

  try {
    const result = await runExpirySweep(null, { windows });
    return c.json({ success: true, data: result });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Sweep failed' }, 500 as 200);
  }
});

// ── Access Profiles ────────────────────────────────────────────────────────────
// Used by the employee creation wizard to resolve a system role server-side without
// exposing raw role strings to the API surface.

// POST /api/hr/access-profiles/list
router.post('/access-profiles/list', async c => {
  await requirePermission(c, 'hr.access_profiles.view');
  const { data, error } = await sb.from('hr_access_profiles')
    .select('id, code, label, description, requires_mfa, is_active, sort_order')
    .order('sort_order', { ascending: true });
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data });
});

// ── Wizard Drafts ──────────────────────────────────────────────────────────────
// One draft per actor (upsert by actor_id). Drafts are ephemeral guidance; they
// are never the authoritative record — the create route is the single commit path.

// POST /api/hr/employees/wizard/draft/save
router.post('/employees/wizard/draft/save', async c => {
  const actor = await requirePermission(c, 'hr.employees.wizard.draft');
  const v = zv(c, z.object({
    draftData: z.record(z.string(), z.unknown()),
    stepIndex: z.number().int().min(0).max(5),
    label: z.string().trim().min(1).max(160).optional(),
  }), (c.get('body')).args ?? {});
  if (!v.ok) return v.response;
  if (JSON.stringify(v.data.draftData).length > 128_000) {
    return c.json({ success: false, message: 'The employee draft is too large.' }, 413 as 200);
  }
  if (Object.hasOwn(v.data.draftData, 'password') || Object.hasOwn(v.data.draftData, 'role')) {
    return c.json({ success: false, message: 'Drafts cannot contain password or raw-role fields.' }, 400 as 200);
  }
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb.from('hr_employee_wizard_drafts')
    .upsert({
      actor_id:   actor.id,
      draft_data: v.data.draftData,
      step_index: v.data.stepIndex,
      label:      v.data.label ?? null,
      expires_at: expiresAt,
    }, { onConflict: 'actor_id' })
    .select('id, actor_id, step_index, label, expires_at, updated_at')
    .single<{ id: string; actor_id: string; step_index: number; label: string | null; expires_at: string; updated_at: string | null }>();

  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data });
});

// POST /api/hr/employees/wizard/draft/get
router.post('/employees/wizard/draft/get', async c => {
  const actor = await requirePermission(c, 'hr.employees.wizard.draft');
  const { data, error } = await sb.from('hr_employee_wizard_drafts')
    .select('id, actor_id, draft_data, step_index, label, expires_at, updated_at')
    .eq('actor_id', actor.id)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle<{ id: string; actor_id: string; draft_data: unknown; step_index: number; label: string | null; expires_at: string; updated_at: string | null }>();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? null });
});

// POST /api/hr/employees/wizard/draft/delete
router.post('/employees/wizard/draft/delete', async c => {
  const actor = await requirePermission(c, 'hr.employees.wizard.draft');
  const { error } = await sb.from('hr_employee_wizard_drafts')
    .delete()
    .eq('actor_id', actor.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true });
});

export default router;
