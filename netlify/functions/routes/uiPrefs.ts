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
import { requireUser, requireRole, log_ } from '../lib/auth';
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

// Widget-board geometry: [{ id, x, y, w, h }] — bounds-checked + capped. Stored in
// the SAME ui_layout.card_order jsonb column as the string-order pages (they coexist:
// a board page's value is an object array instead of a string array).
function cleanBoard(v: unknown): Array<{ id: string; x: number; y: number; w: number; h: number }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  for (const o of v) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    if (typeof r.id !== 'string') continue;
    out.push({
      id: r.id.slice(0, 80),
      x: Math.max(0, Math.min(11, Number(r.x) | 0)),
      y: Math.max(0, Number(r.y) | 0),
      w: Math.max(1, Math.min(12, Number(r.w) | 0)),
      h: Math.max(1, Math.min(40, Number(r.h) | 0)),
    });
    if (out.length >= 60) break;
  }
  return out;
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

// ── Widget board geometry (gridstack) — see docs/WIDGET_BOARD_SPEC.md ─────────────
router.post('/layout/saveBoardDefault', async c => {
  const actor = await requireRole(c, ['admin']);
  const a = getArgs(c);
  const pageKey = String(a.pageKey ?? '');
  const board = cleanBoard(a.board);
  if (!pageKey || board === null) return c.json({ success: false, message: 'pageKey and board required' }, 400 as 200);

  const { data: existing } = await sb.from('ui_layout').select('id').eq('page_key', pageKey).is('user_id', null).maybeSingle();
  const err = existing
    ? (await sb.from('ui_layout').update({ card_order: board, updated_by: actor.id, updated_at: new Date().toISOString() }).eq('id', existing.id)).error
    : (await sb.from('ui_layout').insert({ page_key: pageKey, user_id: null, card_order: board, updated_by: actor.id })).error;
  if (err) return c.json({ success: false, message: err.message }, 500 as 200);

  await log_(actor, 'update', 'ui_layout_board_default', pageKey, `${board.length} widgets`);
  return c.json({ success: true });
});

router.post('/layout/saveBoardOverride', async c => {
  const user = await requireUser(c);
  const a = getArgs(c);
  const pageKey = String(a.pageKey ?? '');
  const board = cleanBoard(a.board);
  if (!pageKey || board === null) return c.json({ success: false, message: 'pageKey and board required' }, 400 as 200);

  const { data: existing } = await sb.from('ui_layout').select('id').eq('page_key', pageKey).eq('user_id', user.id).maybeSingle();
  const err = existing
    ? (await sb.from('ui_layout').update({ card_order: board, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', existing.id)).error
    : (await sb.from('ui_layout').insert({ page_key: pageKey, user_id: user.id, card_order: board, updated_by: user.id })).error;
  if (err) return c.json({ success: false, message: err.message }, 500 as 200);
  return c.json({ success: true });
});

export default router;
