import type { WidgetDef, WidgetGovernancePolicy } from './types';
const policies = new Map<string, WidgetGovernancePolicy>();
export function setWidgetGovernancePolicies(next: WidgetGovernancePolicy[]): void { policies.clear(); for (const policy of next) policies.set(policy.widgetId, { ...policy }); }
export function getWidgetGovernancePolicy(widgetId: string): WidgetGovernancePolicy | undefined { return policies.get(widgetId); }
export function listWidgetGovernancePolicies(): WidgetGovernancePolicy[] { return [...policies.values()]; }
export function effectiveWidgetPolicy(def: WidgetDef): WidgetGovernancePolicy {
  return policies.get(def.id) ?? { widgetId: def.id, state: 'enabled', discoverable: true, ...def.governance };
}
// A board's page key carries two things governance does NOT care about: a LAYOUT VERSION
// suffix (`.v2`, `.v3`, … — bumped to retire layouts saved under an old grid) and a
// SUB-BOARD segment (`.kpis` — the KPI strip is its own grid on the same page). Governance
// is authored against the PAGE, so both are normalised away before matching.
//
// This is version-GENERIC on purpose. The previous implementation hardcoded `.v2`, so
// bumping a board to `.v3` silently rendered every widget on it as "Not approved for this
// page" — the version bump and the approval list had to be edited in lockstep or the board
// broke. Normalising both sides removes that coupling entirely.
export function normalizePageKey(pageKey: string): string {
  return pageKey.replace(/\.v\d+$/, '').replace(/\.kpis$/, '');
}
export function policyAllowsPage(allowedPages: string[] | undefined, pageKey: string): boolean {
  if (!allowedPages?.length) return true;
  if (allowedPages.includes('*')) return true;
  const target = normalizePageKey(pageKey);
  return allowedPages.some(allowed => normalizePageKey(allowed) === target);
}
export function isWidgetDiscoverable(def: WidgetDef, pageKey: string, has: (key: string) => boolean): boolean {
  const policy = effectiveWidgetPolicy(def);
  if (!policy.discoverable || policy.hidden) return false;
  if (!policyAllowsPage(policy.allowedPages, pageKey)) return false;
  return (policy.requiredCapabilities ?? []).every(has);
}
