import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requirePermission, log_ } from '../lib/auth';
import { zv, AddDepartmentSchema, UpdateDepartmentSchema, DeleteDepartmentSchema } from '../lib/validate';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

interface DeptRow {
  id: string;
  name: string;
  description: string | null;
  manager_id: string | null;
  updated_at?: string | null;
}

interface UserRow {
  id: string;
  full_name: string;
  department_id: string | null;
  role: string;
}

async function _listDepartments() {
  const [{ data: depts, error: dErr }, { data: users, error: uErr }] = await Promise.all([
    sb.from('departments').select('*').order('name'),
    sb.from('app_users').select('id, full_name, department_id, role'),
  ]);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);
  if (uErr) throw new Error('Failed to load users for departments: ' + uErr.message);

  const managerMap     = Object.fromEntries(((users ?? []) as UserRow[]).map(u => [u.id, u.full_name]));
  const deptUserCounts: Record<string, number> = {};
  ((users ?? []) as UserRow[]).forEach(u => {
    if (u.department_id) deptUserCounts[u.department_id] = (deptUserCounts[u.department_id] ?? 0) + 1;
  });

  return ((depts ?? []) as DeptRow[]).map(d => ({
    id: d.id, name: d.name, description: d.description ?? '',
    managerId:     d.manager_id ?? '',
    manager:       d.manager_id ? (managerMap[d.manager_id] ?? '—') : '—',
    employeeCount: deptUserCounts[d.id] ?? 0,
  }));
}

router.post('/listDepartments', async c => {
  await requireUser(c);
  return c.json({ success: true, data: await _listDepartments() });
});

router.post('/addDepartment', async c => {
  const actor = await requirePermission(c, 'departments.add');
  const v = zv(c, AddDepartmentSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { name, managerId } = v.data;
  const { data, error } = await sb.from('departments')
    .insert({ name, manager_id: managerId ?? null })
    .select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'create', 'department', data.id, name);
  return c.json({ success: true, id: data.id });
});

router.post('/updateDepartment', async c => {
  const actor = await requirePermission(c, 'departments.edit');
  const v = zv(c, UpdateDepartmentSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { id, name, managerId } = v.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name      !== undefined) patch.name       = name;
  if (managerId !== undefined) patch.manager_id = managerId ?? null;
  const { error } = await sb.from('departments').update(patch).eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'department', id, name ?? id);
  return c.json({ success: true });
});

router.post('/deleteDepartment', async c => {
  const actor = await requirePermission(c, 'departments.delete');
  const v = zv(c, DeleteDepartmentSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  // Guarded delete — a department/org-unit may not be hard-deleted while it still
  // has child units, assigned employees, or linked positions (orphaning them, or
  // leaving app_users.department_id dangling). This mirrors the guard on the canonical
  // HR ▸ Organization editor (/api/hr/organization/unit/delete). Deactivate instead.
  // NOTE: the HR Organization Structure page is now the canonical org-unit editor;
  // this legacy Employees ▸ Departments route is retained read/edit-only pending removal.
  const [{ count: children }, { count: employees }, { count: positions }] = await Promise.all([
    sb.from('departments').select('id', { count: 'exact', head: true }).eq('parent_id', v.data.id),
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('department_id', v.data.id),
    sb.from('hr_positions').select('id', { count: 'exact', head: true }).eq('department_id', v.data.id),
  ]);
  if ((children ?? 0) > 0)  return c.json({ success: false, message: `Cannot delete: ${children} child unit(s) exist. Move or delete them first, or deactivate this unit instead.` }, 409 as 200);
  if ((employees ?? 0) > 0) return c.json({ success: false, message: `Cannot delete: ${employees} employee(s) are assigned. Reassign them first, or deactivate this unit instead.` }, 409 as 200);
  if ((positions ?? 0) > 0) return c.json({ success: false, message: `Cannot delete: ${positions} position(s) are linked. Reassign them first, or deactivate this unit instead.` }, 409 as 200);
  const { error } = await sb.from('departments').delete().eq('id', v.data.id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'delete', 'department', v.data.id, '');
  return c.json({ success: true });
});

export default router;
