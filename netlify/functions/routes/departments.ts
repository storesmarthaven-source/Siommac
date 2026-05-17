import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, log_ } from '../lib/auth';
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
  const actor = await requireRole(c, ['admin']);
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
  const actor = await requireRole(c, ['admin']);
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
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, DeleteDepartmentSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { error } = await sb.from('departments').delete().eq('id', v.data.id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'delete', 'department', v.data.id, '');
  return c.json({ success: true });
});

export default router;
