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
import { requirePermission } from '../lib/auth';
import { emitAppEvent }      from '../lib/appEvents';
import { z, zv }      from '../lib/validate';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

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

export default router;
