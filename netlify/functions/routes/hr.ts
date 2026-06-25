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

// ── Employee Master ────────────────────────────────────────────────────────────

// POST /api/hr/employees/list
router.post('/employees/list', async c => {
  await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({
    status: z.string().optional(), departmentId: z.string().optional(),
    employmentType: z.string().optional(), search: z.string().optional(), limit: z.number().int().positive().max(500).optional(),
  }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  let q = sb.from('app_users').select(HR_COLS).neq('role', 'superadmin').order('full_name').limit(v.data.limit ?? 300);
  if (v.data.status)         q = q.eq('status', v.data.status);
  if (v.data.departmentId)   q = q.eq('department_id', v.data.departmentId);
  if (v.data.employmentType) q = q.eq('employment_type', v.data.employmentType);
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
  return c.json({ success: true, data: data.map(r => ({ ...r, departmentName: deptMap[r.department_id ?? ''] ?? null })) });
});

// POST /api/hr/employees/get
router.post('/employees/get', async c => {
  await requirePermission(c, 'hr.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  const emp = await loadEmployee(v.data.employeeId);
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);

  const [{ data: supervisor }, { data: dept }, { data: statusHistory }, { data: assignment }] = await Promise.all([
    emp.supervisor_id ? sb.from('app_users').select('id, full_name').eq('id', emp.supervisor_id).maybeSingle() : Promise.resolve({ data: null }),
    emp.department_id ? sb.from('departments').select('id, name').eq('id', emp.department_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('hr_employee_status_history').select('*').eq('employee_id', emp.id).order('changed_at', { ascending: false }).limit(20),
    sb.from('hr_employee_assignments').select('*').eq('employee_id', emp.id).eq('is_current', true).maybeSingle(),
  ]);

  return c.json({ success: true, data: {
    employee: { ...emp,
      supervisorName: (supervisor as { full_name?: string } | null)?.full_name ?? null,
      departmentName: (dept as { name?: string } | null)?.name ?? null,
    },
    statusHistory: statusHistory ?? [],
    currentAssignment: assignment ?? null,
  } });
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
    employmentType: z.string().optional(),
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

const CHANGE_TYPES = ['status_change','department_transfer','site_transfer','supervisor_change','role_change','employment_type_change'] as const;
type ChangeType = typeof CHANGE_TYPES[number];
const CHANGE_PERM: Record<ChangeType, string> = {
  status_change:          'hr.employees.status_change',
  department_transfer:    'hr.employees.transfer',
  site_transfer:          'hr.employees.transfer',
  supervisor_change:      'hr.employees.supervisor_change',
  role_change:            'hr.employees.role_change',
  employment_type_change: 'hr.employees.role_change',
};
function snapshotForChange(t: ChangeType, emp: EmpRow): Record<string, unknown> {
  switch (t) {
    case 'status_change':          return { status: emp.status };
    case 'department_transfer':    return { department_id: emp.department_id };
    case 'site_transfer':          return { site_id: emp['site_id'] };
    case 'supervisor_change':      return { supervisor_id: emp.supervisor_id };
    case 'role_change':            return { role: emp['role'] };
    case 'employment_type_change': return { employment_type: emp['employment_type'] };
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
  }
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

  const changeNo = await nextRef('HRC');
  const { data, error } = await sb.from('hr_employee_change_requests').insert({
    change_no: changeNo, employee_id: v.data.employeeId, change_type: v.data.changeType, requested_by: actor.id,
    previous_value: snapshotForChange(v.data.changeType, emp), requested_value: v.data.requestedValue,
    status: 'submitted', metadata: { reason: v.data.reason ?? null },
  }).select('id, change_no').single<{ id: string; change_no: string }>();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  await writeHrAudit({ employeeId: v.data.employeeId, submoduleKey: 'employees', recordId: data.id, actorId: actor.id,
    action: 'hr.employee.change_requested', newState: { changeType: v.data.changeType, requestedValue: v.data.requestedValue }, reason: v.data.reason ?? null });
  void emitAppEvent({ eventType: 'hr.employee.change_requested', sourceModule: 'hr', sourceEntityType: 'employee_change',
    sourceEntityId: data.id, actorUserId: actor.id, severity: 'info', payload: { employeeId: v.data.employeeId, changeType: v.data.changeType } });
  return c.json({ success: true, data });
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
