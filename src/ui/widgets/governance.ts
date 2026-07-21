import type { WidgetDef, WidgetGovernancePolicy } from './types';
const policies = new Map<string, WidgetGovernancePolicy>();
export function setWidgetGovernancePolicies(next: WidgetGovernancePolicy[]): void { policies.clear(); for (const policy of next) policies.set(policy.widgetId, { ...policy }); }
export function getWidgetGovernancePolicy(widgetId: string): WidgetGovernancePolicy | undefined { return policies.get(widgetId); }
export function listWidgetGovernancePolicies(): WidgetGovernancePolicy[] { return [...policies.values()]; }
export function effectiveWidgetPolicy(def: WidgetDef): WidgetGovernancePolicy { return policies.get(def.id) ?? { widgetId: def.id, state: 'enabled', discoverable: true }; }
export function isWidgetDiscoverable(def: WidgetDef, pageKey: string, has: (key: string) => boolean): boolean {
  const policy = effectiveWidgetPolicy(def);
  if (!policy.discoverable || policy.hidden) return false;
  if (policy.allowedPages?.length && !policy.allowedPages.includes(pageKey)) return false;
  return (policy.requiredCapabilities ?? []).every(has);
}
