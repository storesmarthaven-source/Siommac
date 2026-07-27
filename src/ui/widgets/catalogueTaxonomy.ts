import type { ModuleKey, WidgetDef } from './types';
import type { LucideName } from '../LucideIcon';

export interface WidgetModuleMeta {
  key: ModuleKey;
  label: string;
  icon: LucideName;
}

export const WIDGET_MODULE_META: readonly WidgetModuleMeta[] = [
  { key: 'hr', label: 'Human Resources', icon: 'Users' },
  { key: 'hse', label: 'Health, Safety & Environment', icon: 'ShieldCheck' },
  { key: 'finance', label: 'Finance & Payroll', icon: 'Landmark' },
  { key: 'operations', label: 'Operations', icon: 'Factory' },
  { key: 'enterprise', label: 'Enterprise', icon: 'LayoutDashboard' },
] as const;

export function widgetModuleMeta(module: ModuleKey): WidgetModuleMeta {
  return WIDGET_MODULE_META.find(candidate => candidate.key === module)
    ?? { key: module, label: module.toUpperCase(), icon: 'LayoutDashboard' };
}

export function availableWidgetModules(widgets: WidgetDef[]): WidgetModuleMeta[] {
  const available = new Set(widgets.map(widget => widget.module));
  return WIDGET_MODULE_META.filter(module => available.has(module.key));
}

export function widgetAreas(widgets: WidgetDef[], module: ModuleKey): { area: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const widget of widgets) {
    if (widget.module !== module) continue;
    counts.set(widget.area, (counts.get(widget.area) ?? 0) + 1);
  }
  return [...counts].map(([area, count]) => ({ area, count })).sort((a, b) => a.area.localeCompare(b.area));
}
