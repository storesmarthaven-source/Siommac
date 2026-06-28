// src/ui/widgets/declarative/parsePackageFile.ts — read a widget-package file the user picked.
// Accepts:
//   • .html  — each [data-widget-id] section → an html widget; shared <style> = CSS, shared <script> = JS.
//   • .json  — a manifest { name, version, widgets:[…] } (inline `view`, or kind + html/css/js files).
//   • .zip / .siowidget — a manifest.json + referenced html/css/js files, OR a single .html inside.
//     (.siowidget is just a renamed .zip — a branded extension; see the guide on what it does/doesn't protect.)
// Returns the parsed manifest; the backend re-validates every spec before storing.
import { unzipSync, strFromU8 } from 'fflate';
import type { WidgetSizeKey } from '../types';
import type { DeclarativePackageManifest, DeclarativeView, DeclarativeWidgetSpec } from './types';

const SIZE_KEYS = new Set<WidgetSizeKey>(['compact', 'standard', 'wide', 'large', 'tall', 'hero']);
const isSize = (s: string | undefined): s is WidgetSizeKey => !!s && SIZE_KEYS.has(s as WidgetSizeKey);

export async function parseWidgetPackageFile(file: File): Promise<DeclarativePackageManifest> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.html') || name.endsWith('.htm')) return parseHtml(await file.text(), baseName(file.name));
  if (name.endsWith('.json')) return manifestFromJson(JSON.parse(await file.text()), {}, baseName(file.name));

  // .zip / .siowidget (both are zip archives)
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const text: Record<string, string> = {};
  for (const k of Object.keys(entries)) { const d = entries[k]; if (d) text[k] = strFromU8(d); }
  const manKey = Object.keys(text).find(k => k.toLowerCase().endsWith('manifest.json'));
  if (manKey) return manifestFromJson(JSON.parse(text[manKey] ?? '{}'), text, baseName(file.name));
  const htmlKey = Object.keys(text).find(k => /\.html?$/i.test(k));
  if (htmlKey) return parseHtml(text[htmlKey] ?? '', baseName(file.name));
  throw new Error('The .zip has no manifest.json or .html file.');
}

function baseName(n: string): string {
  return n.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Imported Pack';
}

// ── bare HTML → widgets (reads the widget-template.html contract) ───────────────
function parseHtml(html: string, fallbackName: string): DeclarativePackageManifest {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const css = Array.from(doc.querySelectorAll('style')).map(s => s.textContent ?? '').join('\n');
  // Shared <script>s (those NOT inside a widget section) are bundled as the package JS and run in every
  // widget's sandbox. Per-widget scripts live INSIDE the section and ride along in its outerHTML.
  const js = Array.from(doc.querySelectorAll('script'))
    .filter(s => !s.closest('[data-widget-id]')).map(s => s.textContent ?? '').join('\n');
  const nodes = Array.from(doc.querySelectorAll<HTMLElement>('[data-widget-id]'));
  if (!nodes.length) throw new Error('No [data-widget-id] elements found in the HTML.');
  const widgets = nodes.map(el => htmlNodeToSpec(el, css, js));
  const meta = (n: string): string | undefined => doc.querySelector(`meta[name="${n}"]`)?.getAttribute('content') ?? undefined;
  return { name: meta('widget-package-name') ?? fallbackName, version: meta('widget-package-version') ?? '1.0.0', widgets };
}

function htmlNodeToSpec(el: HTMLElement, css: string, js: string): DeclarativeWidgetSpec {
  const a = (n: string): string | undefined => el.getAttribute(n) ?? undefined;
  const id = a('data-widget-id') ?? '';
  const size = a('data-widget-size');
  const view: DeclarativeView = { kind: 'html', html: el.outerHTML, css, ...(js.trim() ? { js } : {}) };
  return {
    id,
    title: a('data-widget-title') ?? el.querySelector('.title,h1,h2,h3')?.textContent?.trim() ?? id,
    description: a('data-widget-description') ?? el.querySelector('.sub')?.textContent?.trim() ?? '',
    icon: a('data-widget-icon') ?? 'fa-table-cells-large',
    category: a('data-widget-category') ?? 'Custom',
    tags: (a('data-widget-tags') ?? '').split(',').map(t => t.trim()).filter(Boolean),
    defaultSize: isSize(size) ? size : 'large',
    allowedSizes: parseSizes(a('data-widget-sizes')),
    view,
  };
}

// ── manifest JSON → widgets (inline view, kind+html files, or kind+data) ────────
function manifestFromJson(parsed: unknown, text: Record<string, string>, fallbackName: string): DeclarativePackageManifest {
  const m = parsed as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || !Array.isArray(m.widgets)) throw new Error('Invalid manifest: needs { name, widgets: [ … ] }.');
  const widgets = (m.widgets as Array<Record<string, unknown>>).map(e => entryToSpec(e, text)).filter((w): w is DeclarativeWidgetSpec => !!w);
  if (!widgets.length) throw new Error('The manifest has no valid widgets.');
  return { name: typeof m.name === 'string' ? m.name : fallbackName, version: typeof m.version === 'string' ? m.version : '1.0.0', widgets };
}

function entryToSpec(e: Record<string, unknown>, text: Record<string, string>): DeclarativeWidgetSpec | null {
  if (typeof e.id !== 'string') return null;
  let view: DeclarativeView | null = null;
  if (e.view && typeof e.view === 'object') {
    view = e.view as DeclarativeView;
  } else if (e.kind === 'html') {
    const html = resolveText(e.html, text);
    if (!html) return null;
    const js = resolveText(e.js, text);
    view = { kind: 'html', html, css: resolveText(e.css, text), ...(js ? { js } : {}) };
  } else if (typeof e.kind === 'string') {
    view = { kind: e.kind, ...(resolveJson(e.data, text) ?? {}) } as DeclarativeView;
  }
  if (!view) return null;
  const sizeStr = typeof e.size === 'string' ? e.size : undefined;
  return {
    id: e.id,
    title: typeof e.title === 'string' ? e.title : e.id,
    description: typeof e.description === 'string' ? e.description : '',
    icon: typeof e.icon === 'string' ? e.icon : 'fa-table-cells-large',
    category: typeof e.category === 'string' ? e.category : 'Custom',
    tags: Array.isArray(e.tags) ? (e.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : typeof e.tags === 'string' ? e.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    defaultSize: isSize(sizeStr) ? sizeStr : undefined,
    allowedSizes: parseSizes(typeof e.sizes === 'string' ? e.sizes : Array.isArray(e.sizes) ? (e.sizes as string[]).join(',') : undefined),
    view,
  };
}

function parseSizes(v: string | undefined): WidgetSizeKey[] | undefined {
  if (!v) return undefined;
  const out = v.split(',').map(s => s.trim()).filter(isSize);
  return out.length ? out : undefined;
}

// A string ref that matches a file in the zip → that file's text; otherwise treat it as inline.
function resolveText(ref: unknown, text: Record<string, string>): string | undefined {
  if (typeof ref !== 'string') return undefined;
  const key = Object.keys(text).find(k => k.toLowerCase().endsWith(ref.toLowerCase()));
  return key ? text[key] : ref;
}
function resolveJson(ref: unknown, text: Record<string, string>): Record<string, unknown> | undefined {
  if (ref && typeof ref === 'object') return ref as Record<string, unknown>;
  const t = resolveText(ref, text);
  if (!t) return undefined;
  try { return JSON.parse(t) as Record<string, unknown>; } catch { return undefined; }
}
