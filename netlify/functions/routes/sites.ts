import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requirePermission, log_ } from '../lib/auth';
import { deptScopeFilter, assertInScope, type DeptScope } from '../lib/permissions';
import { zv, AddSiteSchema, UpdateSiteSchema, DeleteSiteSchema, AssignSiteEmployeesSchema } from '../lib/validate';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

interface SiteRow {
  id: string; name: string; address: string | null;
  latitude: number | string; longitude: number | string; radius: number | null;
  description: string | null; department_id: string | null;
}

interface AssignmentRow {
  site_id: string; user_id: string;
  app_users?: {
    id: string; full_name: string; profile_image: string | null;
    signed_url: string | null; signed_url_expires_at: string | null;
  } | null;
}

interface PickerUser {
  id: string; full_name: string; signed_url: string | null;
  signed_url_expires_at: string | null; profile_image: string | null;
}

async function _listProjectSites(scope: DeptScope) {
  // Scoped users see sites in their department PLUS unassigned (NULL) sites.
  let sitesQ = sb.from('project_sites').select('*').order('name');
  if (!scope.all) sitesQ = sitesQ.or(`department_id.eq.${scope.departmentId},department_id.is.null`);
  const [{ data, error }, { data: assignments }] = await Promise.all([
    sitesQ,
    sb.from('project_site_employees')
      .select('site_id, user_id, app_users(id, full_name, profile_image, signed_url, signed_url_expires_at)'),
  ]);
  if (error) throw new Error('Failed to load project sites: ' + error.message);

  const now = Date.now();
  const siteEmpMap: Record<string, { id: string; name: string; photoUrl: string }[]> = {};
  for (const a of (assignments ?? []) as unknown as AssignmentRow[]) {
    if (!siteEmpMap[a.site_id]) siteEmpMap[a.site_id] = [];
    const u       = a.app_users ?? { id: '', full_name: '', signed_url: null, signed_url_expires_at: null };
    const expires = u.signed_url_expires_at ? new Date(u.signed_url_expires_at).getTime() : 0;
    const photoUrl = (u.signed_url && expires > now + 3600 * 1000) ? u.signed_url : '';
    siteEmpMap[a.site_id].push({ id: u.id, name: u.full_name ?? '', photoUrl });
  }

  return ((data ?? []) as SiteRow[]).map(s => ({
    id: s.id, name: s.name, address: s.address ?? '',
    latitude: Number(s.latitude), longitude: Number(s.longitude), radius: Number(s.radius ?? 200),
    description: s.description ?? '', departmentId: s.department_id ?? '',
    assignedEmployees: siteEmpMap[s.id] ?? [],
  }));
}

router.post('/listProjectSites', async c => {
  const actor = await requireUser(c);
  const scope = await deptScopeFilter(actor);
  let countQ  = sb.from('app_users').select('id', { count: 'exact', head: true }).eq('status', 'active').neq('role', 'admin');
  let pickerQ = sb.from('app_users').select('id, full_name, signed_url, signed_url_expires_at, profile_image').eq('status', 'active').neq('role', 'admin').order('full_name');
  if (!scope.all) {
    countQ  = countQ.eq('department_id', scope.departmentId);
    pickerQ = pickerQ.eq('department_id', scope.departmentId);
  }
  const [sites, activeEmpRes, { data: allEmps }] = await Promise.all([
    _listProjectSites(scope),
    countQ,
    pickerQ,
  ]);
  const now = Date.now();
  const pickerEmployees = ((allEmps ?? []) as PickerUser[]).map(u => {
    const expires  = u.signed_url_expires_at ? new Date(u.signed_url_expires_at).getTime() : 0;
    const photoUrl = (u.signed_url && expires > now + 3600 * 1000) ? u.signed_url : '';
    return { id: u.id, name: u.full_name ?? '', photoUrl };
  });
  return c.json({ success: true, data: sites, totalActiveEmployees: (activeEmpRes as { count: number | null }).count ?? 0, employees: pickerEmployees });
});

router.post('/addProjectSite', async c => {
  const actor = await requirePermission(c, 'sites.add');
  const v = zv(c, AddSiteSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { name, address, latitude, longitude, radius, status, departmentId } = v.data;
  // A scoped creator may only create sites within their own department.
  const scope = await deptScopeFilter(actor);
  const dept  = scope.all ? (departmentId ?? null) : scope.departmentId;
  const { data, error } = await sb.from('project_sites')
    .insert({ name, address: address ?? '', latitude, longitude, radius: radius ?? 200, status: status ?? 'active', department_id: dept })
    .select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'create', 'site', data.id, name);
  return c.json({ success: true, id: data.id });
});

router.post('/updateProjectSite', async c => {
  const actor = await requirePermission(c, 'sites.edit');
  const v = zv(c, UpdateSiteSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { id, ...fields } = v.data;
  // A scoped editor may only touch sites in their department (or unassigned).
  const { data: cur } = await sb.from('project_sites').select('department_id').eq('id', id).maybeSingle<{ department_id: string | null }>();
  if (!cur) return c.json({ success: false, message: 'Site not found' });
  await assertInScope(actor, cur.department_id);
  const scope = await deptScopeFilter(actor);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.name      !== undefined) patch.name      = fields.name;
  if (fields.address   !== undefined) patch.address   = fields.address ?? '';
  if (fields.latitude  !== undefined) patch.latitude  = fields.latitude;
  if (fields.longitude !== undefined) patch.longitude = fields.longitude;
  if (fields.radius    !== undefined) patch.radius    = fields.radius;
  if (fields.status    !== undefined) patch.status    = fields.status;
  // Only org-wide editors may reassign a site's department; scoped editors can't move sites out of their dept.
  if (fields.departmentId !== undefined && scope.all) patch.department_id = fields.departmentId ?? null;
  const { error } = await sb.from('project_sites').update(patch).eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'site', id, fields.name ?? id);
  return c.json({ success: true });
});

router.post('/deleteProjectSite', async c => {
  const actor = await requirePermission(c, 'sites.delete');
  const v = zv(c, DeleteSiteSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { data: cur } = await sb.from('project_sites').select('department_id').eq('id', v.data.id).maybeSingle<{ department_id: string | null }>();
  if (!cur) return c.json({ success: false, message: 'Site not found' });
  await assertInScope(actor, cur.department_id);
  const { error } = await sb.from('project_sites').delete().eq('id', v.data.id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'delete', 'site', v.data.id, '');
  return c.json({ success: true });
});

router.post('/assignSiteEmployees', async c => {
  const actor = await requirePermission(c, 'sites.assign_employees');
  const v = zv(c, AssignSiteEmployeesSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { siteId, employeeIds } = v.data;

  // Scoped users may only assign to their own department's sites + employees.
  const scope = await deptScopeFilter(actor);
  const { data: site } = await sb.from('project_sites').select('department_id').eq('id', siteId).maybeSingle<{ department_id: string | null }>();
  if (!site) return c.json({ success: false, message: 'Site not found' });
  await assertInScope(actor, site.department_id);
  if (!scope.all && employeeIds.length) {
    const { data: emps } = await sb.from('app_users').select('id').in('id', employeeIds).eq('department_id', scope.departmentId);
    const allowed = new Set(((emps ?? []) as { id: string }[]).map(e => e.id));
    if (employeeIds.some(id => !allowed.has(id)))
      return c.json({ success: false, message: 'One or more employees are outside your department' }, 403);
  }

  await sb.from('project_site_employees').delete().eq('site_id', siteId);
  if (employeeIds.length) {
    const { error } = await sb.from('project_site_employees')
      .insert(employeeIds.map(uid => ({ site_id: siteId, user_id: uid })));
    if (error) return c.json({ success: false, message: error.message });
  }
  return c.json({ success: true });
});

export default router;
