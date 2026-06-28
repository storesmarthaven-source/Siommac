/**
 * netlify/functions/routes/uiPrefs.ts
 *
 * UI personalisation endpoints:
 *   POST /api/theme/get            — read the global design-system token overrides (public)
 *   POST /api/theme/save           — write them (admin/superadmin); audited + event
 *   POST /api/layout/get           — read a page's card order (org default + this user's override)
 *   POST /api/layout/saveDefault   — set the org-wide default order (admin)
 *   POST /api/layout/saveOverride  — set the calling user's personal order
 *   POST /api/layout/resetOverride — clear the calling user's personal order
 *
 * Backed by app_theme / ui_layout (see 20260623000000_ui_theme_layout.sql).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { sb } from '../lib/db';
import { requireUser, requireRole, requirePermission, log_ } from '../lib/auth';
import { emitAppEvent } from '../lib/appEvents';
import type { HonoVariables } from '../../../types/api';

type Ctx = Context<{ Variables: HonoVariables }>;

const router = new Hono<{ Variables: HonoVariables }>();

function getArgs(c: Ctx): Record<string, unknown> {
  return ((c.get('body') as { args?: Record<string, unknown> } | undefined)?.args ?? {}) as Record<string, unknown>;
}

function cleanTokens(v: unknown): Record<string, string> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k === 'string' && k.startsWith('--') && k.length <= 64 && typeof val === 'string') {
      out[k] = val.slice(0, 120);
    }
  }
  return out;
}

function cleanOrder(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(x => typeof x === 'string').map(x => (x as string).slice(0, 80)).slice(0, 24);
}

// ── Theme ───────────────────────────────────────────────────────────────────────

router.post('/theme/get', async c => {
  const { data } = await sb.from('app_theme').select('tokens').eq('scope', 'global').maybeSingle();
  return c.json({ success: true, data: { tokens: (data?.tokens ?? {}) } });
});

router.post('/theme/save', async c => {
  const actor = await requireRole(c, ['admin']);
  const tokens = cleanTokens(getArgs(c).tokens);
  if (tokens === null) return c.json({ success: false, message: 'tokens must be an object' }, 400 as 200);

  const { error } = await sb.from('app_theme').upsert(
    { scope: 'global', tokens, updated_by: actor.id, updated_at: new Date().toISOString() },
    { onConflict: 'scope' },
  );
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  await log_(actor, 'update', 'app_theme', 'global', `${Object.keys(tokens).length} token overrides`);
  await emitAppEvent({
    eventType: 'platform.theme.updated', sourceModule: 'platform',
    sourceEntityType: 'app_theme', sourceEntityId: 'global',
    actorUserId: actor.id, payload: { tokenCount: Object.keys(tokens).length },
  });
  return c.json({ success: true });
});

// ── Layout ──────────────────────────────────────────────────────────────────────

router.post('/layout/get', async c => {
  const user = await requireUser(c);
  const pageKey = String(getArgs(c).pageKey ?? '');
  if (!pageKey) return c.json({ success: false, message: 'pageKey required' }, 400 as 200);

  const { data } = await sb.from('ui_layout').select('user_id, card_order').eq('page_key', pageKey);
  let orgDefault: string[] | null = null;
  let override:   string[] | null = null;
  for (const row of (data ?? []) as Array<{ user_id: string | null; card_order: string[] }>) {
    if (row.user_id === null) orgDefault = row.card_order;
    else if (row.user_id === user.id) override = row.card_order;
  }
  return c.json({ success: true, data: { default: orgDefault, override } });
});

router.post('/layout/saveDefault', async c => {
  const actor = await requireRole(c, ['admin']);
  const a = getArgs(c);
  const pageKey = String(a.pageKey ?? '');
  const order = cleanOrder(a.order);
  if (!pageKey || order === null) return c.json({ success: false, message: 'pageKey and order required' }, 400 as 200);

  const { data: existing } = await sb.from('ui_layout').select('id').eq('page_key', pageKey).is('user_id', null).maybeSingle();
  const err = existing
    ? (await sb.from('ui_layout').update({ card_order: order, updated_by: actor.id, updated_at: new Date().toISOString() }).eq('id', existing.id)).error
    : (await sb.from('ui_layout').insert({ page_key: pageKey, user_id: null, card_order: order, updated_by: actor.id })).error;
  if (err) return c.json({ success: false, message: err.message }, 500 as 200);

  await log_(actor, 'update', 'ui_layout_default', pageKey, order.join(','));
  return c.json({ success: true });
});

router.post('/layout/saveOverride', async c => {
  const user = await requireUser(c);
  const a = getArgs(c);
  const pageKey = String(a.pageKey ?? '');
  const order = cleanOrder(a.order);
  if (!pageKey || order === null) return c.json({ success: false, message: 'pageKey and order required' }, 400 as 200);

  const { data: existing } = await sb.from('ui_layout').select('id').eq('page_key', pageKey).eq('user_id', user.id).maybeSingle();
  const err = existing
    ? (await sb.from('ui_layout').update({ card_order: order, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', existing.id)).error
    : (await sb.from('ui_layout').insert({ page_key: pageKey, user_id: user.id, card_order: order, updated_by: user.id })).error;
  if (err) return c.json({ success: false, message: err.message }, 500 as 200);
  return c.json({ success: true });
});

router.post('/layout/resetOverride', async c => {
  const user = await requireUser(c);
  const pageKey = String(getArgs(c).pageKey ?? '');
  if (!pageKey) return c.json({ success: false, message: 'pageKey required' }, 400 as 200);
  await sb.from('ui_layout').delete().eq('page_key', pageKey).eq('user_id', user.id);
  return c.json({ success: true });
});

// ── Widget-library board layout (instance/zone model) — src/ui/widgets ────────────
// Stored in ui_layout.layout (jsonb), distinct from the legacy card_order geometry.
const clampInt = (v: unknown, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.trunc(Number(v) || 0)));
// Cap every stored string so an authenticated user can't persist oversized layout JSON.
const capStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
// Per-widget config is opaque (widget-defined) but must be bounded — drop it if it serializes too large.
function safeConfig(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  try { return JSON.stringify(v).length <= 4_000 ? (v as Record<string, unknown>) : {}; }
  catch { return {}; }
}

function cleanInstanceLayout(v: unknown): { pageKey?: string; zones: Record<string, unknown[]> } | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  const zones = obj.zones;
  if (typeof zones !== 'object' || zones === null || Array.isArray(zones)) return null;
  const pageKey = capStr(obj.pageKey, 120);
  const outZones: Record<string, unknown[]> = {};
  let total = 0, zoneCount = 0;
  for (const [zoneId, arr] of Object.entries(zones as Record<string, unknown>)) {
    if (!Array.isArray(arr) || ++zoneCount > 20) break;       // cap zones
    const zId = capStr(zoneId, 80);
    const items: unknown[] = [];
    for (const it of arr) {
      if (typeof it !== 'object' || it === null) continue;
      const w = it as Record<string, unknown>;
      const instanceId = capStr(w.instanceId, 80), widgetId = capStr(w.widgetId, 120);
      if (!instanceId || !widgetId) continue;                 // both required, non-empty after cap
      items.push({
        instanceId, widgetId,
        pageKey: capStr(w.pageKey, 120) || pageKey,
        zoneId: capStr(w.zoneId, 80) || zId,
        x: clampInt(w.x, 0, 11), y: clampInt(w.y, 0, 9999), w: clampInt(w.w, 1, 12), h: clampInt(w.h, 1, 40),
        sizeKey: capStr(w.sizeKey, 24) || 'standard',
        config: safeConfig(w.config),
        ...(typeof w.titleOverride === 'string' ? { titleOverride: capStr(w.titleOverride, 200) } : {}),
      });
      if (++total > 300) break;                               // cap total widgets
    }
    outZones[zId] = items;
    if (total > 300) break;
  }
  return { pageKey: pageKey || undefined, zones: outZones };
}

router.post('/layout/getInstanceLayout', async c => {
  const user = await requireUser(c);
  const a = getArgs(c);
  const pageKey = String(a.pageKey ?? '');
  if (!pageKey) return c.json({ success: false, message: 'pageKey required' }, 400 as 200);
  const [{ data: override, error: e1 }, { data: def, error: e2 }] = await Promise.all([
    sb.from('ui_layout').select('layout').eq('page_key', pageKey).eq('user_id', user.id).maybeSingle<{ layout: unknown }>(),
    sb.from('ui_layout').select('layout').eq('page_key', pageKey).is('user_id', null).maybeSingle<{ layout: unknown }>(),
  ]);
  // Surface real DB errors (e.g. layout column missing = migration not applied) — never
  // mask them as an empty board.
  if (e1 || e2) return c.json({ success: false, message: (e1 ?? e2)!.message }, 500 as 200);
  return c.json({ success: true, data: { layout: override?.layout ?? def?.layout ?? null } });
});

router.post('/layout/saveInstanceLayout', async c => {
  const user = await requirePermission(c, 'ui.layout.manage');
  const a = getArgs(c);
  const pageKey = String(a.pageKey ?? '');
  const layout = cleanInstanceLayout(a.layout);
  if (!pageKey || layout === null) return c.json({ success: false, message: 'pageKey and layout required' }, 400 as 200);
  const { data: existing } = await sb.from('ui_layout').select('id').eq('page_key', pageKey).eq('user_id', user.id).maybeSingle();
  const err = existing
    ? (await sb.from('ui_layout').update({ layout, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', existing.id)).error
    : (await sb.from('ui_layout').insert({ page_key: pageKey, user_id: user.id, layout, updated_by: user.id })).error;
  if (err) return c.json({ success: false, message: err.message }, 500 as 200);
  return c.json({ success: true });
});

// Admin-only: save the current layout as the org-wide default (user_id = null).
router.post('/layout/saveInstanceLayoutDefault', async c => {
  const actor = await requirePermission(c, 'ui.layout.default.manage');
  const a = getArgs(c);
  const pageKey = String(a.pageKey ?? '');
  const layout = cleanInstanceLayout(a.layout);
  if (!pageKey || layout === null) return c.json({ success: false, message: 'pageKey and layout required' }, 400 as 200);
  const { data: existing } = await sb.from('ui_layout').select('id').eq('page_key', pageKey).is('user_id', null).maybeSingle();
  const err = existing
    ? (await sb.from('ui_layout').update({ layout, updated_by: actor.id, updated_at: new Date().toISOString() }).eq('id', existing.id)).error
    : (await sb.from('ui_layout').insert({ page_key: pageKey, user_id: null, layout, updated_by: actor.id })).error;
  if (err) return c.json({ success: false, message: err.message }, 500 as 200);
  const count = Object.values(layout.zones).reduce((n, z) => n + z.length, 0);
  await log_(actor, 'update', 'ui_layout_instance_default', pageKey, `${count} widgets`);
  return c.json({ success: true });
});

// Clear ONLY this user's layout override (revert to org/page default). Keeps card_order.
router.post('/layout/resetInstanceLayout', async c => {
  const user = await requirePermission(c, 'ui.layout.manage');
  const pageKey = String(getArgs(c).pageKey ?? '');
  if (!pageKey) return c.json({ success: false, message: 'pageKey required' }, 400 as 200);
  const { data: existing } = await sb.from('ui_layout').select('id').eq('page_key', pageKey).eq('user_id', user.id).maybeSingle();
  if (existing) {
    const { error } = await sb.from('ui_layout').update({ layout: null, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  }
  return c.json({ success: true });
});

export default router;
