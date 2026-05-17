import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, log_ } from '../lib/auth';
import { zv, AddSiteSchema, UpdateSiteSchema, DeleteSiteSchema, AssignSiteEmployeesSchema } from '../lib/validate';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

interface SiteRow {
  id: string; name: string; address: string | null;
  latitude: number | string; longitude: number | string; radius: number | null;
  description: string | null;
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

async function _listProjectSites() {
  const [{ data, error }, { data: assignments }] = await Promise.all([
    sb.from('project_sites').select('*').order('name'),
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
    description: s.description ?? '',
    assignedEmployees: siteEmpMap[s.id] ?? [],
  }));
}

router.post('/listProjectSites', async c => {
  await requireUser(c);
  const [sites, activeEmpRes, { data: allEmps }] = await Promise.all([
    _listProjectSites(),
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('status', 'active').neq('role', 'admin'),
    sb.from('app_users').select('id, full_name, signed_url, signed_url_expires_at, profile_image').eq('status', 'active').neq('role', 'admin').order('full_name'),
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
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, AddSiteSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { name, address, latitude, longitude, radius, status } = v.data;
  const { data, error } = await sb.from('project_sites')
    .insert({ name, address: address ?? '', latitude, longitude, radius: radius ?? 200, status: status ?? 'active' })
    .select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'create', 'site', data.id, name);
  return c.json({ success: true, id: data.id });
});

router.post('/updateProjectSite', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, UpdateSiteSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { id, ...fields } = v.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.name      !== undefined) patch.name      = fields.name;
  if (fields.address   !== undefined) patch.address   = fields.address ?? '';
  if (fields.latitude  !== undefined) patch.latitude  = fields.latitude;
  if (fields.longitude !== undefined) patch.longitude = fields.longitude;
  if (fields.radius    !== undefined) patch.radius    = fields.radius;
  if (fields.status    !== undefined) patch.status    = fields.status;
  const { error } = await sb.from('project_sites').update(patch).eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'site', id, fields.name ?? id);
  return c.json({ success: true });
});

router.post('/deleteProjectSite', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, DeleteSiteSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { error } = await sb.from('project_sites').delete().eq('id', v.data.id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'delete', 'site', v.data.id, '');
  return c.json({ success: true });
});

router.post('/assignSiteEmployees', async c => {
  await requireRole(c, ['admin']);
  const v = zv(c, AssignSiteEmployeesSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { siteId, employeeIds } = v.data;

  await sb.from('project_site_employees').delete().eq('site_id', siteId);
  if (employeeIds.length) {
    const { error } = await sb.from('project_site_employees')
      .insert(employeeIds.map(uid => ({ site_id: siteId, user_id: uid })));
    if (error) return c.json({ success: false, message: error.message });
  }
  return c.json({ success: true });
});

export default router;
