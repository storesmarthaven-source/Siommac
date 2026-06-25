// ============================================================================
// Settings & Preferences — catalog/values API (Spec §17–§20)
// ============================================================================
// POST-only, mounted at /api/settings. The catalog is synced from the code
// manifests; values are scoped overrides resolved most-specific-wins. Writes go
// through validateSettingValue + assertCanUpdateSetting (the real security gate)
// and are audited.
// ============================================================================

import { Hono }       from 'hono';
import { sb }         from '../lib/db';
import { requireUser, requirePermission, userCan } from '../lib/auth';
import { z, zv }      from '../lib/validate';
import { resolveSetting }          from '../lib/settings/resolveSetting';
import { validateSettingValue }    from '../lib/settings/validateSettingValue';
import { assertCanUpdateSetting }  from '../lib/settings/assertCanUpdateSetting';
import { seedSettingsFromManifests } from '../lib/settings/seedSettingsFromManifests';
import { SettingsError }           from '../lib/settings/errors';
import type { AppUser }            from '../../../types/db';
import type { HonoVariables }      from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

interface ScopeUser { id: string; role: string; department_id?: string | null; site_id?: string | null }
function scopeOf(actor: AppUser, moduleKey: string) {
  const a = actor as unknown as ScopeUser;
  return { moduleKey, userId: a.id, roleIds: [a.role], departmentId: a.department_id ?? null, siteId: a.site_id ?? null };
}
const isSuper = (actor: AppUser) => (actor as unknown as ScopeUser).role === 'superadmin';
const body = (c: { get: (k: 'body') => Record<string, unknown> }) => (c.get('body') as Record<string, unknown>).args ?? {};

/** Run a write handler, translating SettingsError into a JSON error response. */
async function guarded(c: any, fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (err) {
    if (err instanceof SettingsError) {
      return c.json({ success: false, message: err.message, fieldErrors: err.fieldErrors }, err.statusCode as 200);
    }
    throw err;
  }
}

async function canViewModule(actor: AppUser, moduleKey: string): Promise<boolean> {
  if (isSuper(actor)) return true;
  return (await userCan(actor, 'settings.view')) || (await userCan(actor, `settings.${moduleKey}.view`));
}

// POST /api/settings/catalog/sync — rebuild the catalog from code manifests
router.post('/catalog/sync', async c => {
  await requirePermission(c, 'settings.manage');
  try {
    const summary = await seedSettingsFromManifests(sb);
    return c.json({ success: true, data: summary });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Sync failed' }, 500 as 200);
  }
});

// POST /api/settings/catalog/list — catalog entries for a module
router.post('/catalog/list', async c => {
  const actor = await requireUser(c);
  const v = zv(c, z.object({ moduleKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  if (!(await canViewModule(actor, v.data.moduleKey))) return c.json({ success: false, message: 'Forbidden' }, 403 as 200);
  const { data } = await sb.from('app_setting_catalog').select('*').eq('module_key', v.data.moduleKey).eq('is_active', true).order('setting_key');
  return c.json({ success: true, data: data ?? [] });
});

// POST /api/settings/effective — resolved values for a module (Spec §20)
router.post('/effective', async c => {
  const actor = await requireUser(c);
  const v = zv(c, z.object({ moduleKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  const moduleKey = v.data.moduleKey;
  if (!(await canViewModule(actor, moduleKey))) return c.json({ success: false, message: 'Forbidden' }, 403 as 200);

  const { data: rows } = await sb.from('app_setting_catalog').select('*').eq('module_key', moduleKey).eq('is_active', true).order('setting_key');
  const editCache = new Map<string, boolean>();
  const canManage = async (key: string) => {
    if (isSuper(actor)) return true;
    if (!editCache.has(key)) editCache.set(key, await userCan(actor, key));
    return editCache.get(key)!;
  };

  const settings = [];
  for (const row of (rows ?? []) as Record<string, any>[]) {
    const resolved = await resolveSetting(sb, row['setting_key'], scopeOf(actor, moduleKey));
    settings.push({
      settingKey: row['setting_key'], moduleKey: row['module_key'], label: row['label'], description: row['description'],
      dataType: row['data_type'], settingClass: row['setting_class'], defaultValue: row['default_value'],
      effectiveValue: resolved.value, effectiveSource: resolved.source, effectiveScopeId: resolved.scopeId ?? null,
      allowedValues: row['allowed_values'], minValue: row['min_value'], maxValue: row['max_value'],
      isCritical: row['is_critical'], isSensitive: row['is_sensitive'], isAudited: row['is_audited'],
      scope: row['scope'],
      editable: await canManage(row['minimum_manage_permission'] ?? row['requires_permission']),
    });
  }
  return c.json({ success: true, data: { moduleKey, settings } });
});

// POST /api/settings/resolve — single effective value for the actor's scope
router.post('/resolve', async c => {
  const actor = await requireUser(c);
  const v = zv(c, z.object({ settingKey: z.string().min(1), moduleKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  if (!(await canViewModule(actor, v.data.moduleKey))) return c.json({ success: false, message: 'Forbidden' }, 403 as 200);
  try {
    const resolved = await resolveSetting(sb, v.data.settingKey, scopeOf(actor, v.data.moduleKey));
    return c.json({ success: true, data: resolved });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Resolve failed' }, 404 as 200);
  }
});

const SCOPE_TYPES = ['global', 'module', 'site', 'department', 'role', 'user'] as const;

// POST /api/settings/values/set — write a scoped override (Spec §18)
router.post('/values/set', async c => {
  const actor = await requireUser(c);
  const v = zv(c, z.object({
    settingKey: z.string().min(1), scopeType: z.enum(SCOPE_TYPES), scopeId: z.string().nullable().optional(),
    value: z.unknown(), reason: z.string().max(500).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  const scopeId = v.data.scopeId ?? null;

  return guarded(c, async () => {
    const { data: catalog } = await sb.from('app_setting_catalog').select('*').eq('setting_key', v.data.settingKey).eq('is_active', true).maybeSingle<Record<string, any>>();
    if (!catalog) return c.json({ success: false, message: 'Setting not found.' }, 404 as 200);

    validateSettingValue(catalog as any, v.data.value);

    const current = await resolveSetting(sb, v.data.settingKey, {
      moduleKey: catalog['module_key'],
      userId: v.data.scopeType === 'user' ? scopeId : (actor as unknown as ScopeUser).id,
      roleIds: [(actor as unknown as ScopeUser).role],
      departmentId: (actor as unknown as ScopeUser).department_id ?? null,
      siteId: (actor as unknown as ScopeUser).site_id ?? null,
    });

    await assertCanUpdateSetting({
      actorId: (actor as unknown as ScopeUser).id, isSuperAdmin: isSuper(actor),
      can: (k) => userCan(actor, k), catalog: catalog as any,
      request: { settingKey: v.data.settingKey, scopeType: v.data.scopeType, scopeId, value: v.data.value },
      currentEffectiveValue: current.value,
    });

    const { data: existing } = await sb.from('app_setting_values').select('value')
      .eq('setting_key', v.data.settingKey).eq('scope_type', v.data.scopeType)
      .filter('scope_id', scopeId === null ? 'is' : 'eq', scopeId === null ? null : scopeId).maybeSingle<{ value: unknown }>();

    const { error } = await sb.from('app_setting_values').upsert({
      setting_key: v.data.settingKey, scope_type: v.data.scopeType, scope_id: scopeId,
      value: v.data.value, updated_by: (actor as unknown as ScopeUser).id, updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key,scope_type,scope_id' });
    if (error) return c.json({ success: false, message: error.message }, 500 as 200);

    if (catalog['is_audited']) {
      await sb.from('app_setting_audit_log').insert({
        setting_key: v.data.settingKey, module_key: catalog['module_key'], scope_type: v.data.scopeType, scope_id: scopeId,
        previous_value: existing?.value ?? null, new_value: v.data.value, changed_by: (actor as unknown as ScopeUser).id,
        reason: v.data.reason ?? null,
      });
    }
    return c.json({ success: true, data: { settingKey: v.data.settingKey, scopeType: v.data.scopeType, scopeId, value: v.data.value } });
  });
});

// POST /api/settings/values/reset — delete an override, fall back to inherited (Spec §19)
router.post('/values/reset', async c => {
  const actor = await requireUser(c);
  const v = zv(c, z.object({
    settingKey: z.string().min(1), scopeType: z.enum(SCOPE_TYPES), scopeId: z.string().nullable().optional(), reason: z.string().max(500).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  const scopeId = v.data.scopeId ?? null;

  return guarded(c, async () => {
    const { data: catalog } = await sb.from('app_setting_catalog').select('*').eq('setting_key', v.data.settingKey).eq('is_active', true).maybeSingle<Record<string, any>>();
    if (!catalog) return c.json({ success: false, message: 'Setting not found.' }, 404 as 200);

    await assertCanUpdateSetting({
      actorId: (actor as unknown as ScopeUser).id, isSuperAdmin: isSuper(actor),
      can: (k) => userCan(actor, k), catalog: catalog as any,
      request: { settingKey: v.data.settingKey, scopeType: v.data.scopeType, scopeId, value: catalog['default_value'] },
    });

    const { data: existing } = await sb.from('app_setting_values').select('id, value')
      .eq('setting_key', v.data.settingKey).eq('scope_type', v.data.scopeType)
      .filter('scope_id', scopeId === null ? 'is' : 'eq', scopeId === null ? null : scopeId).maybeSingle<{ id: string; value: unknown }>();
    if (!existing) return c.json({ success: true, data: { reset: false, message: 'No override existed.' } });

    await sb.from('app_setting_values').delete().eq('id', existing.id);
    if (catalog['is_audited']) {
      await sb.from('app_setting_audit_log').insert({
        setting_key: v.data.settingKey, module_key: catalog['module_key'], scope_type: v.data.scopeType, scope_id: scopeId,
        previous_value: existing.value, new_value: null, changed_by: (actor as unknown as ScopeUser).id,
        reason: v.data.reason ?? 'Reset to inherited value',
      });
    }
    return c.json({ success: true, data: { reset: true } });
  });
});

// POST /api/settings/audit/list — setting change history
router.post('/audit/list', async c => {
  await requirePermission(c, 'settings.audit_policy.view');
  const v = zv(c, z.object({ settingKey: z.string().optional(), moduleKey: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  let q = sb.from('app_setting_audit_log').select('*').order('changed_at', { ascending: false }).limit(200);
  if (v.data.settingKey) q = q.eq('setting_key', v.data.settingKey);
  if (v.data.moduleKey) q = q.eq('module_key', v.data.moduleKey);
  const { data } = await q;
  return c.json({ success: true, data: data ?? [] });
});

// ── Manifest review (Spec §17 Manifests, §26) ────────────────────────────────
const REVIEWER_ROLES = ['product_owner', 'module_owner', 'engineering', 'super_admin', 'compliance', 'hse', 'security'] as const;
const REVIEW_COL: Record<string, string> = {
  product_owner: 'reviewed_by_product', module_owner: 'reviewed_by_module_owner', engineering: 'reviewed_by_engineering',
  super_admin: 'reviewed_by_super_admin', compliance: 'reviewed_by_compliance', hse: 'reviewed_by_hse', security: 'reviewed_by_security',
};

// POST /api/settings/manifests/list
router.post('/manifests/list', async c => {
  await requirePermission(c, 'settings.manifests.view');
  const v = zv(c, z.object({ reviewStatus: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  let q = sb.from('module_settings_manifests').select('*').order('module_key');
  if (v.data.reviewStatus) q = q.eq('review_status', v.data.reviewStatus);
  const { data } = await q;
  return c.json({ success: true, data: data ?? [] });
});

// POST /api/settings/manifests/get — manifest + sections + approvals
router.post('/manifests/get', async c => {
  await requirePermission(c, 'settings.manifests.view');
  const v = zv(c, z.object({ moduleKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  const { data: manifest } = await sb.from('module_settings_manifests').select('*').eq('module_key', v.data.moduleKey).maybeSingle<{ id: string }>();
  if (!manifest) return c.json({ success: false, message: 'Manifest not found.' }, 404 as 200);
  const [{ data: sections }, { data: approvals }] = await Promise.all([
    sb.from('module_settings_manifest_sections').select('*').eq('manifest_id', manifest.id),
    sb.from('module_settings_review_approvals').select('*').eq('manifest_id', manifest.id).order('reviewed_at', { ascending: false }),
  ]);
  return c.json({ success: true, data: { manifest, sections: sections ?? [], approvals: approvals ?? [] } });
});

async function setManifestStatus(c: any, moduleKey: string, allowedFrom: string[], next: string, patch: Record<string, unknown>) {
  const { data: m } = await sb.from('module_settings_manifests').select('id, review_status').eq('module_key', moduleKey).maybeSingle<{ id: string; review_status: string }>();
  if (!m) return c.json({ success: false, message: 'Manifest not found.' }, 404 as 200);
  if (allowedFrom.length && !allowedFrom.includes(m.review_status))
    return c.json({ success: false, message: `Manifest is ${m.review_status}; expected ${allowedFrom.join('/')}.` }, 400 as 200);
  const { error } = await sb.from('module_settings_manifests').update({ review_status: next, ...patch }).eq('id', m.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: { moduleKey, reviewStatus: next } });
}

// POST /api/settings/manifests/submit  (draft|returned → pending_review)
router.post('/manifests/submit', async c => {
  await requirePermission(c, 'settings.manifests.submit');
  const v = zv(c, z.object({ moduleKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  return setManifestStatus(c, v.data.moduleKey, ['draft', 'returned'], 'pending_review', { returned_reason: null });
});

// POST /api/settings/manifests/review  (record a reviewer's sign-off)
router.post('/manifests/review', async c => {
  const actor = await requirePermission(c, 'settings.manifests.review');
  const v = zv(c, z.object({
    moduleKey: z.string().min(1), reviewerRole: z.enum(REVIEWER_ROLES),
    decision: z.enum(['approved', 'returned', 'not_required']), comment: z.string().max(500).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  const { data: m } = await sb.from('module_settings_manifests').select('id').eq('module_key', v.data.moduleKey).maybeSingle<{ id: string }>();
  if (!m) return c.json({ success: false, message: 'Manifest not found.' }, 404 as 200);
  await sb.from('module_settings_review_approvals').insert({
    manifest_id: m.id, reviewer_role: v.data.reviewerRole, reviewer_id: actor.id, decision: v.data.decision, comment: v.data.comment ?? null,
  });
  const col = REVIEW_COL[v.data.reviewerRole];
  if (col) await sb.from('module_settings_manifests').update({ [col]: v.data.decision === 'approved' }).eq('id', m.id);
  return c.json({ success: true, data: { moduleKey: v.data.moduleKey, reviewerRole: v.data.reviewerRole, decision: v.data.decision } });
});

// POST /api/settings/manifests/approve  (pending_review → approved)
router.post('/manifests/approve', async c => {
  const actor = await requirePermission(c, 'settings.manifests.approve');
  const v = zv(c, z.object({ moduleKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  return setManifestStatus(c, v.data.moduleKey, ['pending_review'], 'approved', { approved_by: actor.id, approved_at: new Date().toISOString(), returned_reason: null });
});

// POST /api/settings/manifests/return  (→ returned)
router.post('/manifests/return', async c => {
  await requirePermission(c, 'settings.manifests.return');
  const v = zv(c, z.object({ moduleKey: z.string().min(1), reason: z.string().min(1).max(500) }), body(c));
  if (!v.ok) return v.response;
  return setManifestStatus(c, v.data.moduleKey, ['pending_review', 'approved'], 'returned', { returned_reason: v.data.reason });
});

// POST /api/settings/manifests/deprecate  (→ deprecated)
router.post('/manifests/deprecate', async c => {
  await requirePermission(c, 'settings.manifests.deprecate');
  const v = zv(c, z.object({ moduleKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  return setManifestStatus(c, v.data.moduleKey, [], 'deprecated', {});
});

export default router;
