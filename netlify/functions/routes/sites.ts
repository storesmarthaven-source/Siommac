import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, log_ } from '../lib/auth';
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
  const { name, address, latitude, longitude, radius, description } = (c.get('body').args ?? {}) as Record<string, unknown>;
  const { data, error } = await sb.from('project_sites')
    .insert({ name, address: address ?? '', latitude, longitude, radius, description: description ?? '' })
    .select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'create', 'site', data.id, String(name));
  return c.json({ success: true, id: data.id });
});

router.post('/updateProjectSite', async c => {
  const actor = await requireRole(c, ['admin']);
  const { id, name, address, latitude, longitude, radius, description } = (c.get('body').args ?? {}) as Record<string, unknown>;
  const { error } = await sb.from('project_sites')
    .update({ name, address: address ?? '', latitude, longitude, radius, description: description ?? '', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'site', String(id), String(name));
  return c.json({ success: true });
});

router.post('/deleteProjectSite', async c => {
  const actor = await requireRole(c, ['admin']);
  const { id } = (c.get('body').args ?? {}) as Record<string, string>;
  const { error } = await sb.from('project_sites').delete().eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'delete', 'site', id, '');
  return c.json({ success: true });
});

router.post('/assignSiteEmployees', async c => {
  await requireRole(c, ['admin']);
  const { siteId, userIds } = (c.get('body').args ?? {}) as { siteId?: string; userIds?: unknown[] };
  if (!siteId) return c.json({ success: false, message: 'Missing siteId' });
  const ids = Array.isArray(userIds) ? userIds.map(String) : [];

  await sb.from('project_site_employees').delete().eq('site_id', siteId);
  if (ids.length) {
    const { error } = await sb.from('project_site_employees')
      .insert(ids.map(uid => ({ site_id: siteId, user_id: uid })));
    if (error) return c.json({ success: false, message: error.message });
  }
  return c.json({ success: true });
});

export default router;
