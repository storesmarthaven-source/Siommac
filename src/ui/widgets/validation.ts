// src/ui/widgets/validation.ts — pre-catalogue sanity checks for a WidgetDef.
//
// Two severities:
//   error   — the widget cannot function (missing render/id/sizes) → EXCLUDED from the
//             registry (same posture as the existing duplicate-id handling in registry.ts).
//   warning — the widget works but doesn't yet declare the newer adaptive/permission
//             contract (contentPriorityRules/densityRules/dataSource.permissions) →
//             included, but logged in dev so authors can migrate incrementally. Treating
//             these as hard errors would delete every widget shipped before this contract
//             existed, which is the opposite of what "harden, don't replace" means.
import type { WidgetDef } from './types';

export interface WidgetValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface WidgetValidationResult {
  ok: boolean;
  issues: WidgetValidationIssue[];
}

// Dotted, module-prefixed, camelCase segments (matches the existing convention, e.g.
// "hr.employees.activeWorkforce" / "hr.onboarding.readinessGates").
const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9_]*)+$/;

export function validateWidgetDef(def: WidgetDef): WidgetValidationResult {
  const issues: WidgetValidationIssue[] = [];
  const err = (code: string, message: string): void => { issues.push({ level: 'error', code, message }); };
  const warn = (code: string, message: string): void => { issues.push({ level: 'warning', code, message }); };

  if (!def.id || !ID_PATTERN.test(def.id)) err('INVALID_ID', `Widget id "${def.id}" must be dotted and module-prefixed (e.g. "hr.employees.readiness").`);
  // render is a required WidgetDef field (type-guaranteed) — no runtime presence check.
  if (!def.allowedSizes.length) err('NO_SIZES', 'Widget must declare allowedSizes.');
  else if (!def.allowedSizes.some(s => s.key === def.defaultSize)) err('DEFAULT_SIZE_NOT_ALLOWED', `defaultSize "${def.defaultSize}" is not in allowedSizes.`);
  if (def.resizable === false && def.allowedSizes.length !== 1)
    err('FIXED_WIDGET_MULTIPLE_SIZES', 'A non-resizable widget must declare exactly one code-owned size.');
  if (def.resizable === false && def.allowedSizes[0]) {
    const { min, max, grid } = def.allowedSizes[0];
    // min/max are optional on a size; a missing one is itself "not pinned".
    if (!min || !max || min.w !== grid.w || min.h !== grid.h || max.w !== grid.w || max.h !== grid.h)
      err('FIXED_WIDGET_UNPINNED_SIZE', 'A non-resizable widget must pin min and max to its single grid size.');
  }
  if (!def.supportedPages.length) err('NO_PAGES', 'Widget must declare supportedPages.');

  if (!def.dataSource.permissions.length) warn('NO_PERMISSIONS', 'dataSource.permissions is empty — the widget is visible to every user.');
  if (!def.renderPreview) warn('NO_PREVIEW', 'No renderPreview — the library shows only an icon tile instead of a true-aspect thumbnail.');
  if (!def.contentPriorityRules?.length) warn('NO_CONTENT_PRIORITY_RULES', 'No contentPriorityRules — widget will not adapt content at smaller sizes.');
  if (!def.densityRules) warn('NO_DENSITY_RULES', 'No densityRules — widget will not adapt chart/label/action density.');

  return { ok: issues.every(i => i.level !== 'error'), issues };
}
