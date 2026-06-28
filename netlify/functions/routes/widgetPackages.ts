/**
 * netlify/functions/routes/widgetPackages.ts
 *
 * Installable DECLARATIVE widget packages (no-code). Backed by ui_widget_packages.
 *   POST /api/widgets/packages/list      — installed packages   (perm: ui.widgets.packages.view)
 *   POST /api/widgets/packages/install   — install a package    (perm: ui.widgets.packages.manage)
 *   POST /api/widgets/packages/uninstall — remove a package     (perm: ui.widgets.packages.manage)
 *
 * The .zip is unpacked CLIENT-side; this endpoint receives the parsed manifest as JSON, then
 * re-validates it (never trust the client) before storing. Install/uninstall are ORG-WIDE mutations,
 * so they go on the event/audit backbone (emitAppEvent → app_events + audit_logs) and are atomic via
 * a compensating rollback: if the audit/event fails, the package mutation is undone.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { sb } from '../lib/db';
import { requireUser, requirePermission } from '../lib/auth';
import { emitAppEvent } from '../lib/appEvents';
import type { HonoVariables } from '../../../types/api';

type Ctx = Context<{ Variables: HonoVariables }>;
const router = new Hono<{ Variables: HonoVariables }>();

function getArgs(c: Ctx): Record<string, unknown> {
  return ((c.get('body') as { args?: Record<string, unknown> } | undefined)?.args ?? {}) as Record<string, unknown>;
}

const VIEW_KINDS = new Set(['metric', 'donut', 'trend', 'bars', 'list', 'html']);
const SIZE_KEYS = new Set(['compact', 'standard', 'wide', 'large', 'tall', 'hero']);
const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.slice(0, max) : fallback);

// HTML widgets carry arbitrary markup/CSS/JS — cap their size; other kinds store their view as-is.
// (HTML cards are fluid: they fill the cell and reflow, so there is no stored design size. The JS
// runs in a sandboxed, network-blocked iframe on render — the cap is a storage/abuse guard.)
function cleanView(view: Record<string, unknown>): Record<string, unknown> {
  if (String(view.kind) !== 'html') return view;
  return {
    kind: 'html',
    html: str(view.html, 200_000),
    ...(typeof view.css === 'string' ? { css: str(view.css, 100_000) } : {}),
    ...(typeof view.js === 'string' ? { js: str(view.js, 100_000) } : {}),
  };
}

/** Validate + normalize the declarative widget specs (never trust the uploaded manifest). */
function cleanWidgets(v: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<Record<string, unknown>> = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const w = it as Record<string, unknown>;
    const view = w.view;
    if (typeof w.id !== 'string' || typeof w.title !== 'string') continue;
    if (!view || typeof view !== 'object' || Array.isArray(view) || !VIEW_KINDS.has(String((view as Record<string, unknown>).kind))) continue;
    const allowed = Array.isArray(w.allowedSizes) ? w.allowedSizes.filter(s => typeof s === 'string' && SIZE_KEYS.has(s)).slice(0, 6) : undefined;
    out.push({
      id: str(w.id, 80),
      title: str(w.title, 80),
      description: str(w.description, 240),
      icon: str(w.icon, 40, 'fa-puzzle-piece'),
      category: str(w.category, 40, 'Custom'),
      tags: Array.isArray(w.tags) ? w.tags.filter(t => typeof t === 'string').slice(0, 12) : [],
      ...(typeof w.defaultSize === 'string' && SIZE_KEYS.has(w.defaultSize) ? { defaultSize: w.defaultSize } : {}),
      ...(allowed && allowed.length ? { allowedSizes: allowed } : {}),
      view: cleanView(view as Record<string, unknown>),
    });
    if (out.length >= 50) break;
  }
  return out;
}

const widgetIds = (rows: Array<{ widgets?: unknown }>): Set<string> => {
  const ids = new Set<string>();
  for (const r of rows) for (const w of (Array.isArray(r.widgets) ? r.widgets : [])) {
    const id = (w as { id?: unknown }).id;
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
};

router.post('/widgets/packages/list', async c => {
  await requirePermission(c, 'ui.widgets.packages.view');
  const { data, error } = await sb
    .from('ui_widget_packages')
    .select('id, name, version, widgets, installed_by, created_at')
    .order('created_at', { ascending: true });
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const rows = (data ?? []).map(r => ({
    id: r.id, name: r.name, version: r.version, widgets: r.widgets ?? [],
    installedBy: r.installed_by, createdAt: r.created_at,
  }));
  return c.json({ success: true, data: rows });
});

router.post('/widgets/packages/install', async c => {
  const actor = await requirePermission(c, 'ui.widgets.packages.manage');
  const a = getArgs(c);
  const name = str(a.name, 80);
  const version = typeof a.version === 'string' ? a.version.slice(0, 24) : null;
  const widgets = cleanWidgets(a.widgets);
  if (!name || widgets === null) return c.json({ success: false, message: 'name and widgets[] required' }, 400 as 200);
  if (!widgets.length) return c.json({ success: false, message: 'No valid widgets in the package.' }, 400 as 200);

  // Reject widget-id collisions with already-installed packages (resolution is first-match, so a
  // duplicate id would shadow another package / render the wrong widget / break on uninstall).
  const newIds = widgets.map(w => String(w.id));
  if (new Set(newIds).size !== newIds.length) return c.json({ success: false, message: 'Package has duplicate widget ids.' }, 400 as 200);
  const { data: existingPkgs, error: exErr } = await sb.from('ui_widget_packages').select('widgets');
  if (exErr) return c.json({ success: false, message: exErr.message }, 500 as 200);
  const taken = widgetIds(existingPkgs ?? []);
  const clash = newIds.filter(id => taken.has(id));
  if (clash.length) return c.json({ success: false, message: `Widget id(s) already installed: ${clash.slice(0, 5).join(', ')}` }, 409 as 200);

  const { data, error } = await sb
    .from('ui_widget_packages')
    .insert({ name, version, widgets, installed_by: actor.id })
    .select('id')
    .single();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  const id = String(data?.id ?? '');

  // Org-wide mutation → event + audit on the backbone. Treat audit/event failure as a failed
  // mutation: compensate by deleting the just-inserted package (no silent partial state).
  const ev = await emitAppEvent({
    eventType: 'ui.widget_package.installed', sourceModule: 'platform',
    sourceEntityType: 'ui_widget_package', sourceEntityId: id, actorUserId: actor.id,
    payload: { name, version, widgetCount: widgets.length, widgetIds: newIds },
  });
  if (!ev.ok) {
    await sb.from('ui_widget_packages').delete().eq('id', id);
    return c.json({ success: false, message: 'Install rolled back — audit/event write failed.' }, 500 as 200);
  }
  return c.json({ success: true, data: { id } });
});

router.post('/widgets/packages/uninstall', async c => {
  const actor = await requirePermission(c, 'ui.widgets.packages.manage');
  const id = String(getArgs(c).id ?? '');
  if (!id) return c.json({ success: false, message: 'id required' }, 400 as 200);

  // Capture the row first so we can both audit meaningfully and restore it if the audit fails.
  const { data: row, error: rErr } = await sb
    .from('ui_widget_packages').select('id, name, version, widgets, installed_by, created_at').eq('id', id).maybeSingle();
  if (rErr) return c.json({ success: false, message: rErr.message }, 500 as 200);
  if (!row) return c.json({ success: false, message: 'Package not found.' }, 404 as 200);

  const { error } = await sb.from('ui_widget_packages').delete().eq('id', id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const ev = await emitAppEvent({
    eventType: 'ui.widget_package.uninstalled', sourceModule: 'platform',
    sourceEntityType: 'ui_widget_package', sourceEntityId: id, actorUserId: actor.id,
    payload: { name: row.name, version: row.version },
  });
  if (!ev.ok) {
    // Compensating restore — re-insert the captured row so we never leave a deleted-but-unaudited state.
    await sb.from('ui_widget_packages').insert({
      id: row.id, name: row.name, version: row.version, widgets: row.widgets,
      installed_by: row.installed_by, created_at: row.created_at,
    });
    return c.json({ success: false, message: 'Uninstall rolled back — audit/event write failed.' }, 500 as 200);
  }
  return c.json({ success: true });
});

export default router;
