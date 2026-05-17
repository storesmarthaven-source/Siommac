import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, log_ } from '../lib/auth';
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
  const { name, description, manager } = (c.get('body').args ?? {}) as Record<string, string>;
  const { data, error } = await sb.from('departments')
    .insert({ name, description: description ?? '', manager_id: manager ?? null })
    .select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'create', 'department', data.id, name);
  return c.json({ success: true, id: data.id });
});

router.post('/updateDepartment', async c => {
  const actor = await requireRole(c, ['admin']);
  const { id, name, description, manager } = (c.get('body').args ?? {}) as Record<string, string>;
  const { error } = await sb.from('departments')
    .update({ name, description: description ?? '', manager_id: manager ?? null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'department', id, name);
  return c.json({ success: true });
});

router.post('/deleteDepartment', async c => {
  const actor = await requireRole(c, ['admin']);
  const { id } = (c.get('body').args ?? {}) as Record<string, string>;
  const { error } = await sb.from('departments').delete().eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'delete', 'department', id, '');
  return c.json({ success: true });
});

export default router;
