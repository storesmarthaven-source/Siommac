// src/ui/widgets/defineWidget.ts — authoring helper: fills in the default adaptive-
// content contract (contentPriorityRules/densityRules) when a widget doesn't declare
// its own, and validates the result. Use for NEW widgets — existing registry.*.tsx
// files keep working unchanged (validation runs on them too, but only warns).
import type { WidgetDef } from './types';
import { DEFAULT_CONTENT_PRIORITY_RULES, DEFAULT_DENSITY_RULES } from './responsive';
import { validateWidgetDef } from './validation';

export function defineWidget<TConfig>(def: WidgetDef<TConfig>): WidgetDef<TConfig> {
  const normalized: WidgetDef<TConfig> = {
    ...def,
    chrome: def.chrome ?? 'standard',
    contentPriorityRules: def.contentPriorityRules ?? DEFAULT_CONTENT_PRIORITY_RULES,
    densityRules: def.densityRules ?? DEFAULT_DENSITY_RULES,
  };
  const result = validateWidgetDef(normalized as WidgetDef);
  const errors = result.issues.filter(i => i.level === 'error');
  if (errors.length) {
    throw new Error(`defineWidget(${def.id}): ${errors.map(e => `${e.code}: ${e.message}`).join('; ')}`);
  }
  return normalized;
}
