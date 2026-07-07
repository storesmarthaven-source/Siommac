/**
 * src/ui/widgets/registry.ts — cross-module widget catalogue for the v2 widget library.
 *
 * SELF-REGISTERING. Every widget "package" is a file `registry.<name>.tsx` (e.g.
 * registry.hr.tsx, registry.hrEmployees.tsx, future registry.hse.tsx) that does:
 *
 *     export const widgets: WidgetDef[] = [ … ]
 *
 * They are auto-collected here via `import.meta.glob` — drop a new package file and it
 * registers itself; NO edits to this aggregator. Duplicate ids are dropped with a dev
 * warning. Authoring format + scaffold: docs/WIDGET_AUTHORING_GUIDE.md.
 */
import type { WidgetDef } from './types';
import { getRuntimeWidgets } from './runtimeRegistry';
import { validateWidgetDef } from './validation';

// Eager glob → { './registry.hr.tsx': { widgets }, './registry.hrEmployees.tsx': { widgets }, … }.
// Each package file exports `widgets: WidgetDef[]` (multiple widgets in one file).
// Single-segment names (no interior dots) keep the `*` match unambiguous.
const packages = import.meta.glob('./registry.*.tsx', { eager: true }) as Record<string, { widgets?: WidgetDef[] }>;

function collectWidgets(): WidgetDef[] {
  const out: WidgetDef[] = [];
  const seen = new Set<string>();
  for (const path of Object.keys(packages).sort()) {
    const list = packages[path]?.widgets;
    if (!Array.isArray(list)) {
      if (import.meta.env.DEV) console.warn(`[widgets] ${path} exports no \`widgets: WidgetDef[]\` — skipped.`);
      continue;
    }
    for (const w of list) {
      if (seen.has(w.id)) {
        if (import.meta.env.DEV) console.warn(`[widgets] duplicate widget id "${w.id}" (${path}) — ignored.`);
        continue;
      }
      const validation = validateWidgetDef(w);
      if (import.meta.env.DEV) {
        for (const issue of validation.issues) {
          const log = issue.level === 'error' ? console.error : console.warn;
          log(`[widgets] ${path} "${w.id}": ${issue.code} — ${issue.message}`);
        }
      }
      if (!validation.ok) continue; // hard errors (no render/id/sizes) — excluded, same as a duplicate id
      seen.add(w.id);
      out.push(w);
    }
  }
  return out;
}

/** Code widgets (compiled, from the glob). Installed/declarative widgets are added at runtime. */
export const WIDGET_REGISTRY: WidgetDef[] = collectWidgets();

/** All widgets = code widgets + runtime-installed declarative widgets. */
export function allWidgets(): WidgetDef[] {
  const runtime = getRuntimeWidgets();
  return runtime.length ? [...WIDGET_REGISTRY, ...runtime] : WIDGET_REGISTRY;
}

export function getWidgetDef(widgetId: string): WidgetDef {
  const widget = findWidgetDef(widgetId);
  if (!widget) throw new Error(`Widget not registered: ${widgetId}`);
  return widget;
}

export function findWidgetDef(widgetId: string): WidgetDef | undefined {
  return allWidgets().find(w => w.id === widgetId);
}

export function getWidgetsForPage(pageKey: string): WidgetDef[] {
  return allWidgets().filter(w => w.supportedPages.includes(pageKey));
}

export function getWidgetsByModule(module: string): WidgetDef[] {
  return allWidgets().filter(w => w.module === module);
}
