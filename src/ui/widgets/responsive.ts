// src/ui/widgets/responsive.ts — derives a WidgetResponsiveContext from a widget's
// (optional) contentPriorityRules/densityRules for the current sizeKey. A widget MAY
// read `responsive` off its render props to adapt content density; widgets that don't
// declare these rules simply don't get adaptive behavior (no regression, purely additive).
import type {
  WidgetContentPriorityRule, WidgetDensityRules, WidgetResponsiveContext, WidgetSizeKey,
} from './types';
import { isSizeAtLeast } from './size';

export const DEFAULT_CONTENT_PRIORITY_RULES: WidgetContentPriorityRule[] = [
  { slot: 'icon', minSize: 'compact' },
  { slot: 'value', minSize: 'compact' },
  { slot: 'title', minSize: 'compact' },
  { slot: 'subtext', minSize: 'standard' },
  { slot: 'sparkline', minSize: 'standard' },
  { slot: 'chart', minSize: 'large', collapseTo: 'sparkline' },
  { slot: 'list', minSize: 'standard' },
  { slot: 'table', minSize: 'large' },
  { slot: 'actions', minSize: 'standard', collapseTo: 'actionMenu' },
];

export const DEFAULT_DENSITY_RULES: WidgetDensityRules = {
  chart: { simplifyBelow: 'large', hideBelow: 'compact' },
  labels: { truncateBelow: 'large' },
  actions: { menuBelow: 'large', hideBelow: 'compact' },
  numbers: { abbreviateBelow: 'standard' },
};

export function resolveVisibleSlots(size: WidgetSizeKey, rules: WidgetContentPriorityRule[]): Set<string> {
  const visible = new Set<string>();
  for (const rule of rules) {
    if (isSizeAtLeast(size, rule.minSize)) visible.add(rule.slot);
    else if (rule.collapseTo) visible.add(rule.collapseTo);
  }
  return visible;
}

export function createResponsiveContext(args: {
  sizeKey: WidgetSizeKey;
  contentPriorityRules?: WidgetContentPriorityRule[];
  densityRules?: WidgetDensityRules;
}): WidgetResponsiveContext {
  const { sizeKey } = args;
  const rules = args.contentPriorityRules ?? DEFAULT_CONTENT_PRIORITY_RULES;
  const density = args.densityRules ?? DEFAULT_DENSITY_RULES;

  const chartMode: WidgetResponsiveContext['chartMode'] =
    density.chart?.hideBelow && !isSizeAtLeast(sizeKey, density.chart.hideBelow) ? 'none'
    : density.chart?.simplifyBelow && !isSizeAtLeast(sizeKey, density.chart.simplifyBelow) ? 'sparkline'
    : isSizeAtLeast(sizeKey, 'large') ? 'full' : 'compact';

  const labelMode: WidgetResponsiveContext['labelMode'] =
    density.labels?.hideBelow && !isSizeAtLeast(sizeKey, density.labels.hideBelow) ? 'hidden'
    : density.labels?.truncateBelow && !isSizeAtLeast(sizeKey, density.labels.truncateBelow) ? 'truncated'
    : 'full';

  const actionMode: WidgetResponsiveContext['actionMode'] =
    density.actions?.hideBelow && !isSizeAtLeast(sizeKey, density.actions.hideBelow) ? 'hidden'
    : density.actions?.menuBelow && !isSizeAtLeast(sizeKey, density.actions.menuBelow) ? 'menu'
    : 'inline';

  const numberMode: WidgetResponsiveContext['numberMode'] =
    density.numbers?.abbreviateBelow && !isSizeAtLeast(sizeKey, density.numbers.abbreviateBelow) ? 'abbreviated' : 'full';

  return { sizeKey, visibleSlots: resolveVisibleSlots(sizeKey, rules), chartMode, labelMode, actionMode, numberMode };
}
